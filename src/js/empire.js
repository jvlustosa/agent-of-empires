import { formatElapsed, isObserver, kindInfo } from './kinds.js';
import { formatResource, resourceIcon } from './overview.js';
import * as S from './sprites.js';
import { makeProjection, project, projectStep, unproject } from './view.js';

// World layout, in world pixels (1 world px = 1 art pixel, upscaled by CSS).
// Each repository is a base standing wherever the user put it on open land, as in Age of Empires
// III. Dirt roads run from each base's gate to the main road on the right, which leads to the
// square, where agents idle for a long time hang out.
const BORDER = 12; // forest around the map
const PLOT_W = 128;
// A compact base: town center, gold mine and forge around one yard.
const PLOT_H = 84;
const ROAD = 10; // also the least gap between two bases, so a road always fits between them
// The land is eight bases wide and grows downward, always keeping two whole free rows below the
// lowest base: room to found more, to move bases around and for recruits to stand.
const LAND_COLS = 8;
const MIN_LAND_ROWS = 6;
const FREE_ROWS = 2;
const MAP_X0 = BORDER;
const MAP_Y0 = BORDER;
const LAND_X1 = MAP_X0 + LAND_COLS * PLOT_W + (LAND_COLS - 1) * ROAD;
const MAIN_X = LAND_X1 + ROAD / 2;
const SQUARE_X = MAIN_X + ROAD / 2;
const SQUARE_W = 120;
const WORLD_W = SQUARE_X + SQUARE_W + BORDER;
// A base dropped this close to "one road away" from a neighbour lines up with it.
const SNAP_PX = 10;
// Fog of war below the land: the repositories in ~/Code no agent has explored yet, as ruins in the
// mist. At most this many ruins are drawn; the label has the count.
const FOG_H = 44;
const FOG_RUINS_MAX = 10;
const MINIMAP_FRAME_MS = 200;
// Arrow keys / WASD pan the zoomed map at this speed (screen px per second), as in the game.
const PAN_SPEED = 700;
const PAN_KEYS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1], a: [-1, 0], d: [1, 0], w: [0, -1], s: [0, 1] };
// The isometric map is wider than the stage: at "fit" it may shrink below 1 screen px per art px.
const MIN_ISO_SCALE = 0.5;
// Path grid: villagers keep to the roads, go around bases rather than through them, and are never
// stuck (a base is only very expensive to cross, not a wall).
const CELL = 4;
const COST_ROAD = 1;
const COST_GRASS = 2.5;
const COST_BLOCKED = 60;
const COST_TURN = 1.5;
const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
// Before the first count of the empire's work, a town center's era comes from its size (tracked files).
const ERA_FILE_STEPS = [150, 500, 1500, 4000];
// Then it is earned: experience = every commit + 5 per hour agents worked there, and an era never
// goes back (Claude Code prunes old transcripts; the highest era reached is kept).
const XP_PER_AGENT_HOUR = 5;
const ERA_XP_STEPS = [25, 150, 600, 1500];
// The castle's size (3D) follows how big and how old the repository is: tracked files and days since
// the first commit give up to 3 points each, and every 2 points is one size up (Pequeno › Colossal).
const SIZE_FILE_STEPS = [250, 1000, 4000];
const SIZE_AGE_DAYS = [90, 180, 365];
const DAY_MS = 24 * 60 * 60 * 1000;
const AGE_UP_MS = 4500;
// Wonders: lasting monuments for milestones of real work.
export const WONDERS = [
  { id: 'obelisk', name: 'Obelisco dos mil commits', isEarned: (stats) => stats.commitsTotal >= 1000 },
  { id: 'beacon', name: 'Farol das 24 horas de agente', isEarned: (stats) => stats.agentMinutesTotal >= 24 * 60 },
];

// Inside a base (from its top-left corner). Villagers cross the base along the yard, in front of
// the town center, and leave by the gate at the bottom.
const TOWN_CENTER = { x: 44, y: 16, w: 40, h: 36 };
const DOOR = { x: 64, y: 53 };
const BANNER = { x: 90, y: 50 };
const BELL = { x: 33, y: 52 }; // left of the widest (imperial) town center
const YARD_Y = 60;
const GATE_X = 64;
const NAMEPLATE_Y = 76;
export const NICKNAME_MAX = 24;
// What each activity looks like on the map: reading mines gold, the terminal works the forge,
// editing hammers at the town center's wall, the web is watched with a spyglass from the yard.
// Everything else happens in front of the town center. Whoever waits for the user (their turn, or
// blocked on them) leaves the workers there and queues apart, under the bell, facing the camera.
const NODE_FOR_KIND = { reading: 'mine', terminal: 'forge', coding: 'build', web: 'tower' };
const NODES = {
  mine: { dir: 'n', tool: 'pickaxe', impact: 'gold', spots: [[10, 41], [22, 41], [16, 47], [28, 47], [6, 47]] },
  forge: { dir: 'n', tool: 'hammer', impact: 'sparks', spots: [[118, 44], [107, 44], [112, 50], [122, 50], [101, 50]] },
  build: { dir: 'e', tool: 'hammer', impact: 'dust', spots: [[38, 36], [38, 46], [34, 41], [34, 51], [30, 46]] },
  tower: { dir: 'e', tool: 'spyglass', impact: null, spots: [[92, 62], [100, 66], [86, 70], [108, 62], [96, 74]] },
  tc: { dir: 's', tool: null, impact: null, spots: [[58, 66], [70, 66], [64, 72], [52, 72], [76, 72], [58, 78], [70, 78], [76, 66], [82, 78]] },
  wait: { dir: 's', tool: null, impact: null, spots: [[44, 66], [37, 66], [30, 66], [23, 66], [16, 66], [40, 73], [33, 73], [26, 73], [19, 73], [12, 73]] },
};
// Where the tool lands, relative to the villager's feet, per facing.
const IMPACT_AT = { n: [2, -19], w: [-8, -9], e: [8, -9], s: [6, -6] };
const BASE_GROUND = {
  yardY: YARD_Y,
  gate: { x: GATE_X },
  patches: [[4, 34, 30, 16], [96, 36, 30, 16], [30, 30, 14, 26], [84, 58, 30, 20], [40, 58, 48, 22], [6, 60, 42, 18]],
};

// The square: wells, a market and a campfire to sit at. It starts beside the main road, right of the
// land, and the user can drag it onto open land (a road apart from the bases, two rows tall) or back.
const SQUARE_H = 2 * PLOT_H + ROAD;
const SQUARE_HOME = { x: SQUARE_X, y: MAP_Y0 };
// The paved market corner: pressing there drags the square.
const PAVING = { x: 6, y: 6, w: SQUARE_W - 12, h: 58 };
// On open land the square's road leaves from the middle of its bottom edge.
const SQUARE_GATE_X = 60;
// Square-local coordinates from here on.
const POIS = [
  { id: 'well', x: 27, y: 50, dir: 'n', pose: 'stand', dwell: [8, 14] },
  { id: 'market1', x: 76, y: 52, dir: 'n', pose: 'stand', dwell: [10, 18] },
  { id: 'market2', x: 94, y: 52, dir: 'n', pose: 'stand', dwell: [10, 18] },
  { id: 'log1', x: 42, y: 98, dir: 's', pose: 'sit', dwell: [20, 40] },
  { id: 'log2', x: 60, y: 94, dir: 's', pose: 'sit', dwell: [20, 40] },
  { id: 'log3', x: 78, y: 98, dir: 's', pose: 'sit', dwell: [20, 40] },
  { id: 'cart', x: 48, y: 166, dir: 'w', pose: 'stand', dwell: [10, 18] },
  { id: 'spot1', x: 100, y: 84, dir: 'w', pose: 'stand', dwell: [6, 12] },
  { id: 'spot2', x: 20, y: 90, dir: 'e', pose: 'stand', dwell: [6, 12] },
  { id: 'spot3', x: 92, y: 150, dir: 's', pose: 'stand', dwell: [6, 12] },
  { id: 'spot4', x: 64, y: 172, dir: 'n', pose: 'stand', dwell: [6, 12] },
];
const CAMPFIRE = { x: 60, y: 118 };
// Recruits (villagers summoned with no session yet) line up below the campfire, in rows of four
// with every other row shifted half a step, until you send them to a base.
const RALLY = { x: 74, y: 142 };
const RALLY_COLS = 4;
const RALLY_GAP = { x: 12, y: 11 };
// Undyed linen: a recruit takes a repository's color only once its session starts there.
export const RECRUIT_CLOTH = { tunic: '#b8ab95', tunicShade: '#8a7d68' };
// What the 3D view needs to know of the world's layout.
const LAYOUT = { PLOT_W, PLOT_H, ROAD, MAP_X0, MAP_Y0, LAND_X1, MAIN_X, SQUARE_X, SQUARE_W, SQUARE_H, PAVING, WORLD_W, BORDER, TOWN_CENTER, DOOR, BANNER, BELL, FOG_H, CELL, POIS, CAMPFIRE, BASE_GROUND };

const WALK_SPEED = 48; // world px / s
const SCOUT_SPEED = 72;
const MAX_FRAME_DT = 0.1;
const FRAME_MS = 1000 / 30;
// Tool calls flip the activity every few seconds; a villager finishes a stint before crossing the
// yard to the next work site, so the base bustles without units ping-ponging.
const NODE_DWELL_MS = 2500;
// Short idle blips between tool calls should not send the villager off to the square.
const IDLE_LEAVE_MS = 6000;
// A session used recently is still "at work": it stays at its base for this long after the last prompt.
const BASE_STAY_AFTER_PROMPT_MS = 30 * 60 * 1000;
const FOUNDING_MS = 1400;
const BOT_EXIT_MS = 1200;
// The scout stops beside each villager for a few seconds, scanning, then rides on.
const INSPECT_SECONDS = [3, 5];
const HIGHLIGHT_MS = 4000;
// Same yellow as the "found it" arrow and the selected card: "this one" everywhere.
const LINK_COLOR = '#facc15';
// How long clicked land stays staked for the agent being deployed (it appears once you hit Enter).
const RESERVATION_MS = 5 * 60 * 1000;
// Rough time a deployed agent takes to show up; drives the training bar, which never fills alone.
const TRAINING_EXPECTED_MS = 20 * 1000;
// Map zoom on top of "fit to the stage" (1 = fit). The UI zoom does not grow the map,
// because the map always refits; this one does.
const VIEW_ZOOM_MAX = 4;
const WHEEL_ZOOM_STEP = 1.15;
// The unit label's "…" stays up this long after the pointer leaves the villager, to be reachable.
const LABEL_MENU_LINGER_MS = 1500;
// Past this many screen pixels a press on a town center is a drag (move the base), not a click.
const DRAG_THRESHOLD_PX = 5;
// Soldiers (subagents) march around their villager at these offsets.
const ESCORT_SLOTS = [[-10, 2], [10, 2], [-15, -3], [15, -3], [-6, 7], [6, 7]];

// Pinned bases used to be saved as a plot index in a two-column grid; this is where they stood.
function legacyPlotOrigin(index) {
  return { x: MAP_X0 + (index % 2) * (PLOT_W + ROAD), y: MAP_Y0 + Math.floor(index / 2) * (112 + ROAD) };
}

function savedSpot(value) {
  if (Number.isInteger(value) && value >= 0) return legacyPlotOrigin(value);
  if (Number.isFinite(value?.x) && Number.isFinite(value?.y)) return { x: value.x, y: value.y };
  return null;
}

// Two bases closer than a road apart collide.
function isOverlapping(a, b) {
  return Math.abs(a.x - b.x) < PLOT_W + ROAD && Math.abs(a.y - b.y) < PLOT_H + ROAD;
}

// A base closer than a road to the square collides with it too.
function isOverlappingSquare(pos, square) {
  return pos.x < square.x + SQUARE_W + ROAD && square.x < pos.x + PLOT_W + ROAD && pos.y < square.y + SQUARE_H + ROAD && square.y < pos.y + PLOT_H + ROAD;
}

function isInsideSpot(pos, x, y) {
  return x >= pos.x && x <= pos.x + PLOT_W && y >= pos.y && y < pos.y + PLOT_H;
}

// The target nearest to value when it is within SNAP_PX, else value itself.
function snapTo(value, targets) {
  const nearest = targets.reduce((best, target) => (Math.abs(target - value) < Math.abs(best - value) ? target : best), Infinity);
  return Math.abs(nearest - value) <= SNAP_PX ? nearest : value;
}

// Where a base's villagers come out to the roads: below its gate.
function gateExit(pos) {
  return { x: pos.x + GATE_X, y: pos.y + PLOT_H + ROAD / 2 };
}

function roundToEven(value) {
  return Math.round(value / 2) * 2;
}

function suggestEra(files) {
  if (!Number.isFinite(files)) return S.DEFAULT_TOWN.era;
  return 1 + ERA_FILE_STEPS.filter((step) => files >= step).length;
}

export function xpOf(stats) {
  return stats ? stats.commitsTotal + Math.round((stats.agentMinutesTotal / 60) * XP_PER_AGENT_HOUR) : 0;
}

function eraForXp(xp) {
  return 1 + ERA_XP_STEPS.filter((step) => xp >= step).length;
}

// With only one of the two known, it counts twice; with neither, the default size.
function suggestSize(files, ageDays) {
  const filePoints = Number.isFinite(files) ? SIZE_FILE_STEPS.filter((step) => files >= step).length : null;
  const agePoints = Number.isFinite(ageDays) ? SIZE_AGE_DAYS.filter((step) => ageDays >= step).length : null;
  if (filePoints === null && agePoints === null) return S.DEFAULT_TOWN.size;
  return 1 + Math.floor(((filePoints ?? agePoints) + (agePoints ?? filePoints)) / 2);
}

// Binary min-heap of (priority, value) for the path search.
class MinHeap {
  constructor() {
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  push(priority, value) {
    const items = this.items;
    items.push([priority, value]);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent][0] <= items[i][0]) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }

  pop() {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length === 0) return top[1];
    items[0] = last;
    for (let i = 0; ; ) {
      const left = 2 * i + 1;
      let min = i;
      if (left < items.length && items[left][0] < items[min][0]) min = left;
      if (left + 1 < items.length && items[left + 1][0] < items[min][0]) min = left + 1;
      if (min === i) break;
      [items[min], items[i]] = [items[i], items[min]];
      i = min;
    }
    return top[1];
  }
}

/**
 * Cheapest 4-way path on the grid from `start` to the first cell `isGoal` accepts. Turning costs
 * extra, so paths run straight. Returns the cells after the start, or null.
 */
function searchGrid(nav, start, isGoal, heuristic) {
  const { cols, rows, cost, best, from, closed } = nav;
  best.fill(Infinity);
  from.fill(-1);
  closed.fill(0);
  const heap = new MinHeap();
  for (let dir = 0; dir < 4; dir++) {
    best[start * 4 + dir] = 0;
    heap.push(heuristic(start), start * 4 + dir);
  }
  while (heap.size > 0) {
    const state = heap.pop();
    if (closed[state]) continue;
    closed[state] = 1;
    const cell = state >> 2;
    if (isGoal(cell)) {
      const cells = [];
      for (let at = state; from[at] !== -1; at = from[at]) cells.push(at >> 2);
      return cells.reverse();
    }
    const cx = cell % cols;
    const cy = (cell - cx) / cols;
    for (let dir = 0; dir < 4; dir++) {
      const nx = cx + STEPS[dir][0];
      const ny = cy + STEPS[dir][1];
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const next = ny * cols + nx;
      const nextState = next * 4 + dir;
      const g = best[state] + cost[next] + (dir === (state & 3) ? 0 : COST_TURN);
      if (g >= best[nextState]) continue;
      best[nextState] = g;
      from[nextState] = state;
      heap.push(g + heuristic(next), nextState);
    }
  }
  return null;
}

// Spot `index` of a group standing around `center`, `count` strong.
function formationSpot(center, index, count = RALLY_COLS) {
  const cols = Math.min(count, RALLY_COLS);
  const col = index % RALLY_COLS;
  const row = Math.floor(index / RALLY_COLS);
  return { x: center.x + (col - (cols - 1) / 2) * RALLY_GAP.x + (row % 2) * (RALLY_GAP.x / 2), y: center.y + row * RALLY_GAP.y };
}

function makeChar(id, agent, project, look, x, y) {
  return { id, agent, project, look, x, y, dir: 's', facing: 'e', frame: 0, walkClock: 0, path: [], goal: null, mode: 'free', node: null, nodeSince: 0, spot: null, poi: null, poiUntil: 0, idleSince: null, hiddenUntil: 0 };
}

function needsUser(agent) {
  if (agent.isRecruit || isObserver(agent)) return false;
  return agent.status !== 'busy' || agent.activity.kind === 'asking';
}

function isBlocked(agent) {
  return agent.status === 'busy' && agent.activity.kind === 'asking';
}

function wantsBase(agent) {
  if (agent.status === 'busy') return true;
  return Number.isFinite(agent.lastPromptAt) && Date.now() - agent.lastPromptAt < BASE_STAY_AFTER_PROMPT_MS;
}

// Where a path lives: the deepest known repository folder that contains it.
function projectOfPath(path, repoPaths) {
  let best = null;
  for (const [project, root] of repoPaths) {
    const isInside = path === root || path.startsWith(`${root}/`);
    if (isInside && (!best || root.length > best.root.length)) best = { project, root };
  }
  return best?.project ?? null;
}

function nodeFor(agent) {
  if (needsUser(agent)) return 'wait';
  if (agent.status !== 'busy') return 'tc';
  return NODE_FOR_KIND[agent.activity.kind] ?? 'tc';
}

// The map's light and clock follow the machine's local time.
export function mapClock(now = Date.now()) {
  const date = new Date(now);
  const hours = date.getHours();
  const minutes = date.getMinutes();
  return { hours, minutes, hour: hours + minutes / 60 };
}

// Waiting villagers wave for ~1.2 s every 6 s, staggered by seed so the map does not wave in sync.
function waveFrame(t, seed, isUrgent) {
  const cycle = (t + (seed % 6)) % (isUrgent ? 2.5 : 6);
  return cycle < 1.2 ? Math.floor(t * 6) % 2 : -1;
}

function taskSentence(agent) {
  return agent.title || agent.lastPrompt || agent.name;
}

function baseSummary(agents) {
  const blocked = agents.filter(isBlocked).length;
  const yours = agents.filter((a) => a.status !== 'busy').length;
  const working = agents.length - blocked - yours;
  const parts = [];
  if (blocked) parts.push(`${blocked} precisa${blocked > 1 ? 'm' : ''} de você`);
  if (yours) parts.push(`${yours} sua vez`);
  if (working) parts.push(`${working} trabalhando`);
  return parts.join(' · ');
}

// A zero-width space after - _ . / and between camelCase words: a long folder name wraps there, not mid-word.
function breakable(name) {
  return name.replace(/([-_./]|[a-z](?=[A-Z]))/g, '$1​');
}

// A base that spent something never reads 0%.
function formatSessionPercent(percent) {
  return percent > 0 && percent < 1 ? '<1%' : `${Math.round(percent)}%`;
}

function randomBetween([min, max]) {
  return min + Math.random() * (max - min);
}

export class Empire {
  /**
   * layout: { pinned: { project: { x, y } }, hidden: [project], paths: { project: path },
   * orders: { sessionId: { project, at } }, designs: { project: { era, style } }, square: { x, y } },
   * saved by the caller through onLayoutChange. Pinned repositories keep their base (and its place)
   * even with no agents; hidden ones stay off the map, villagers included; orders are agents the
   * user sent to work in another repository; designs are how a base's town center looks, when the
   * user changed it; square is where the user put the square (top-left).
   */
  constructor(canvas, overlay, callbacks) {
    const { onHover, onSelect, onMenu, onLandMenu, onBaseMenu, onLink, onProjectClick, layout, onLayoutChange } = callbacks;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.overlay = overlay;
    this.onHover = onHover;
    this.onSelect = onSelect;
    this.onMenu = onMenu;
    this.onProjectClick = onProjectClick;
    this.onLandMenu = onLandMenu;
    this.onBaseMenu = onBaseMenu;
    this.onLink = onLink;
    this.onLayoutChange = onLayoutChange;
    this.onOrder = callbacks.onOrder;
    this.onSelectionChange = callbacks.onSelectionChange;
    this.onFogClick = callbacks.onFogClick;
    this.onPlace = callbacks.onPlace;
    this.onAgeUp = callbacks.onAgeUp;
    this.onEvent = callbacks.onEvent;
    this.placing = null; // { project, path, spot }: a base picked in the build menu, following the pointer
    this.summonTarget = null; // base under a summon token being dragged: it lights up
    this.fogNames = []; // unexplored repositories, under the fog of war
    this.baseHighlight = null; // { project, until }: a base picked in the empire overview
    this.minimap = null; // { canvas, drawnAt } while the map is zoomed in
    // View: from above or isometric (Ragnarok-style), turned in quarter turns. proj maps world
    // pixels to canvas pixels; props are the upright scenery that isometric draws as sprites.
    this.viewMode = callbacks.view?.mode === 'iso' ? 'iso' : 'top';
    this.viewRotation = Number.isInteger(callbacks.view?.rotation) ? callbacks.view.rotation : 0;
    this.proj = makeProjection('top', 0, WORLD_W, 0);
    this.props = [];
    this.panKeys = new Set(); // arrow keys / WASD held down
    this.isPanKeyDown = false; // Space held: left drag pans instead of selecting
    this.pinned = new Map(); // project -> { x, y }: top-left of its base
    this.repoPaths = new Map(Object.entries(layout?.paths ?? {})); // project -> absolute folder
    this.orders = new Map(Object.entries(layout?.orders ?? {})); // session id -> { project, at }
    this.selected = new Set(); // villagers picked on the map (click, Shift+click, drag a box)
    this.recruitCount = 0; // recruits summoned so far: their ids
    this.hidden = new Set(Array.isArray(layout?.hidden) ? layout.hidden : []);
    this.designs = new Map(Object.entries(layout?.designs ?? {}).filter(([, design]) => design && typeof design === 'object'));
    this.repoSizes = new Map(); // project -> files git tracks, for the era before the first count
    this.repoStats = new Map(); // project -> its numbers from get_empire (commits, agent minutes…)
    this.reachedEras = new Map(Object.entries(layout?.eras ?? {}).filter(([, era]) => Number.isInteger(era))); // never goes back
    this.wondersSeen = new Map(Object.entries(layout?.wonders ?? {}).filter(([, ids]) => Array.isArray(ids)));
    this.celebrations = new Map(); // project -> when its age-up beam started
    this.lastAgents = [];
    this.drag = null; // { kind: 'base' | 'box', project, x, y, isDragging, target, toX, toY, grab }
    this.landHover = null; // free land under the pointer: where a base would be founded
    this.suppressClickUntil = 0;
    this.hovered = { id: null, until: 0 }; // pointer on a unit label's "…": keep that label up
    this.linkedId = null; // agent hovered in the panel: its villager lights up here
    this.sceneLinkedId = null; // agent under the pointer here: its card lights up in the panel
    this.bases = new Map(); // project -> { project, pos, team, foundedAt, spots }
    this.reservations = new Map(); // project -> { pos, hint, until }: a base about to be founded
    this.training = new Map(); // project -> { hint, since, until }: a villager on its way to a base
    this.spend = new Map(); // project -> { tokens, percent, sessionPercent, severity }: its part of the plan's session
    this.chars = new Map();
    this.bots = new Map();
    this.poiOwners = new Map();
    this.labels = new Map();
    this.landBottom = MAP_Y0 + MIN_LAND_ROWS * (PLOT_H + ROAD);
    this.nav = null;
    this.layoutKey = '';
    this.scale = 1;
    this.hasSynced = false;
    this.conflicts = new Set(); // agents editing a file another agent also touched
    this.highlight = null;
    this.hitBoxes = [];
    this.lastFrameAt = 0;
    this.staticLayer = document.createElement('canvas');
    // The square goes first: pinned bases make room for it.
    const square = layout?.square;
    const isSquareSaved = Number.isFinite(square?.x) && Number.isFinite(square?.y) && this.isSquareFree(square, false);
    this.setSquare(isSquareSaved ? square : SQUARE_HOME);
    // Pinned bases stand from the first paint, with or without agents.
    for (const [project, saved] of Object.entries(layout?.pinned ?? {})) {
      const spot = savedSpot(saved);
      if (this.hidden.has(project) || !spot) continue;
      const base = this.createBase(project, this.isSpotFree(spot, project, false) ? spot : this.findFreeSpot(spot, project), -Infinity);
      this.pinned.set(project, base.pos);
    }

    this.refreshLayout();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement.parentElement);
    this.bindPointer(canvas);
    window.addEventListener('mousemove', (e) => this.moveDrag(e));
    window.addEventListener('mouseup', () => this.endDrag());
    if (callbacks.view?.mode === '3d') this.setView('3d');
    requestAnimationFrame((now) => this.loop(now));
  }

  // The same pointer handling on the 2D canvas and, once it exists, the 3D one.
  bindPointer(canvas) {
    canvas.addEventListener('mousemove', (e) => this.handlePointer(e, false));
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 1) e.preventDefault(); // middle button pans; no autoscroll or paste
      this.startDrag(e);
    });
    canvas.addEventListener('mouseleave', () => {
      this.landHover = null;
      this.onHover(null);
      this.linkFromScene(null);
    });
    canvas.addEventListener('click', (e) => this.handlePointer(e, true));
    canvas.addEventListener('dblclick', (e) => {
      const id = this.hitAt(e)?.id;
      if (id) this.canvas.dispatchEvent(new CustomEvent('agentdblclick', { detail: id }));
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        if (e.shiftKey) return; // Shift + wheel scrolls the zoomed map sideways
        e.preventDefault(); // the wheel zooms at the pointer, as in the game (and the page never zooms)
        const factor = e.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP;
        this.setViewZoom((this.viewZoom ?? 1) * factor, { x: e.clientX, y: e.clientY });
      },
      { passive: false },
    );
    // The WebView's own menu (reload, back) means nothing over the map, so it never shows here.
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.placing) {
        this.cancelPlacing(); // right-click drops what you were about to build, as in the game
        return;
      }
      const point = { x: e.clientX, y: e.clientY };
      const id = this.agentAt(e);
      if (id) {
        this.onMenu(id, point);
        return;
      }
      // With villagers picked, right-click anywhere on a base is the order: "go work there".
      const world = this.worldAt(e);
      const target = this.baseAt(world.x, world.y)?.project;
      if (this.selected.size > 0 && target) {
        this.onOrder([...this.selected], target, point);
        return;
      }
      // Off the bases, picked recruits move there, as units do in the game.
      const ground = this.selected.size > 0 && this.groundAt(e);
      if (ground && this.moveRecruits(ground) > 0) return;
      const hit = this.hitAt(e);
      if (hit?.freeLand !== undefined) this.onLandMenu(hit.freeLand, point, this.groundAt(e));
      else if (hit?.project) this.onBaseMenu(hit.project, point);
      else if (target) this.onBaseMenu(target, point); // anywhere on the base's land, not only its buildings
    });
  }

  // The canvas the map is on now: the 2D one, or the 3D one.
  get viewCanvas() {
    return this.is3d ? this.world3d.canvas : this.canvas;
  }

  get is3d() {
    return this.viewMode === '3d' && Boolean(this.world3d);
  }

  get worldH() {
    return this.landBottom + this.fogHeight + BORDER;
  }

  get fogHeight() {
    return this.fogNames.length > 0 ? FOG_H : 0;
  }

  /** Zooms the map keeping the point under `focus` (client coords; default stage center) still. */
  setViewZoom(zoom, focus = null) {
    if (this.is3d) {
      this.viewZoom = this.world3d.zoomTo(zoom, focus?.x ?? null, focus?.y ?? null);
      this.canvas.dispatchEvent(new CustomEvent('viewzoom', { detail: this.viewZoom }));
      return this.viewZoom;
    }
    const stage = this.canvas.parentElement.parentElement;
    const stageBox = stage.getBoundingClientRect();
    const before = this.canvas.getBoundingClientRect();
    const px = focus?.x ?? stageBox.left + stageBox.width / 2;
    const py = focus?.y ?? stageBox.top + stageBox.height / 2;
    const worldX = (px - before.left) / this.scale;
    const worldY = (py - before.top) / this.scale;
    this.viewZoom = Math.min(VIEW_ZOOM_MAX, Math.max(1, zoom));
    this.resize();
    if (this.viewZoom === 1) {
      stage.scrollLeft = 0; // back to fit: nothing scrolls, so nothing may stay shifted
      stage.scrollTop = 0;
    } else {
      const after = this.canvas.getBoundingClientRect();
      stage.scrollLeft += after.left + worldX * this.scale - px;
      stage.scrollTop += after.top + worldY * this.scale - py;
    }
    this.canvas.dispatchEvent(new CustomEvent('viewzoom', { detail: this.viewZoom }));
    return this.viewZoom;
  }

  /** When zoomed in, scrolls the map so this agent's villager is in the middle of the stage. */
  centerOn(id) {
    const ch = this.chars.get(id);
    if (ch) this.centerOnWorld(ch.x, ch.y - 10);
  }

  // ---------- View: from above or isometric, and moving around the map ----------

  project(x, y) {
    return this.is3d ? this.world3d.screenOf(x, y) : project(this.proj, x, y);
  }

  unproject(x, y) {
    if (!this.is3d) return unproject(this.proj, x, y);
    return this.world3d.groundAtLocal(x, y) ?? { x: -1e6, y: -1e6 }; // above the horizon: nowhere
  }

  get isIso() {
    return this.viewMode === 'iso';
  }

  /**
   * mode 'top' | 'iso' | '3d'; rotation in quarter turns (isometric only). The 3D view (three.js)
   * loads the first time it is picked.
   */
  async setView(mode, rotation = this.viewRotation) {
    const next = ['iso', '3d'].includes(mode) ? mode : 'top';
    if (next === '3d' && !this.world3d) {
      try {
        const { World3D } = await import('./world3d.js');
        this.world3d = new World3D(this.canvas.parentElement, this, LAYOUT);
        this.bindPointer(this.world3d.canvas);
      } catch (err) {
        this.canvas.dispatchEvent(new CustomEvent('viewerror', { detail: String(err) }));
        return;
      }
    }
    this.viewMode = next;
    this.viewRotation = ((rotation % 4) + 4) % 4;
    this.world3d?.setActive(this.is3d);
    this.canvas.style.display = this.is3d ? 'none' : '';
    this.resize();
    if (this.is3d) {
      this.world3d.markStatic();
      this.viewZoom = this.world3d.cam.zoom; // the 3D camera keeps its own zoom
      this.canvas.dispatchEvent(new CustomEvent('viewzoom', { detail: this.viewZoom }));
    }
    this.canvas.dispatchEvent(new CustomEvent('viewchange', { detail: { mode: this.viewMode, rotation: this.viewRotation } }));
  }

  /** Q / E: the isometric camera turns a quarter, keeping the middle of the stage in the middle. */
  rotateView(step) {
    if (this.is3d) {
      this.world3d.rotate(step);
      return;
    }
    if (!this.isIso) return;
    const stage = this.canvas.parentElement.parentElement;
    const stageBox = stage.getBoundingClientRect();
    const box = this.canvas.getBoundingClientRect();
    const middle = this.unproject((stageBox.left + stageBox.width / 2 - box.left) / this.scale, (stageBox.top + stageBox.height / 2 - box.top) / this.scale);
    this.setView('iso', this.viewRotation + step);
    this.centerOnWorld(middle.x, middle.y);
  }

  // Draws an upright sprite (written in world coordinates) standing on its projected foot.
  billboard(x, y, draw) {
    const p = this.project(x, y);
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, Math.round(p.x - x), Math.round(p.y - y));
    draw();
    ctx.restore();
  }

  glow(x, y, radius, color, strength) {
    const p = this.project(x, y);
    S.drawGlow(this.ctx, p.x, p.y, radius, color, strength);
  }

  // A sprite's hit box, written around its world foot, moved to where the sprite is drawn.
  pushSpriteHit(box, x, y) {
    const p = this.project(x, y);
    this.hitBoxes.push({ ...box, x: box.x + Math.round(p.x - x), y: box.y + Math.round(p.y - y), z: p.y + (box.z - y) });
  }

  /** Arrow keys / WASD held down pan the zoomed map, a little every frame. */
  setPanKey(key, isDown) {
    const name = key.length === 1 ? key.toLowerCase() : key;
    if (!PAN_KEYS[name]) return false;
    if (isDown) this.panKeys.add(name);
    else this.panKeys.delete(name);
    return true;
  }

  applyPanKeys(dt) {
    if (this.panKeys.size === 0) return;
    let [vx, vy] = [0, 0];
    for (const key of this.panKeys) {
      vx += PAN_KEYS[key][0];
      vy += PAN_KEYS[key][1];
    }
    if (this.is3d) {
      this.world3d.panBy(vx * PAN_SPEED * dt, vy * PAN_SPEED * dt);
      return;
    }
    const stage = this.canvas.parentElement.parentElement;
    stage.scrollLeft += vx * PAN_SPEED * dt;
    stage.scrollTop += vy * PAN_SPEED * dt;
  }

  resize() {
    const stage = this.canvas.parentElement.parentElement;
    const dpr = window.devicePixelRatio || 1;
    // At fit there is nothing to scroll; leftover scrollbars from a zoomed view would shrink the
    // area measured below, so switch them off before measuring.
    stage.style.overflow = (this.viewZoom ?? 1) > 1 ? 'auto' : 'hidden';
    const style = getComputedStyle(stage);
    const innerW = stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const innerH = stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    const viewZoom = this.viewZoom ?? 1;
    this.proj = makeProjection(this.viewMode, this.viewRotation, WORLD_W, this.worldH);
    this.sizedWorldH = this.worldH;
    if (this.is3d) {
      stage.style.overflow = 'hidden'; // the camera moves; the stage never scrolls
      this.scale = 1;
      const box = this.canvas.parentElement;
      box.style.width = `${innerW}px`;
      box.style.height = `${innerH}px`;
      this.overlay.style.setProperty('--px', '2');
      this.buildStaticLayer();
      this.world3d.resize(innerW, innerH);
      for (const label of this.labels.values()) label.dataset.pos = '';
      return;
    }
    const { width, height } = this.proj;
    const fit = Math.min(innerW / width, innerH / height) * viewZoom;
    // At "fit", whole device pixels per art pixel keep every pixel the same size. Below 2x that
    // would halve the map, and when zooming it would swallow steps (156% and 180% both 2x), so
    // the exact fractional scale wins there. The isometric map may shrink below 1x to fit.
    this.scale = viewZoom === 1 && fit >= 2 ? Math.floor(fit * dpr) / dpr : Math.max(this.isIso ? MIN_ISO_SCALE : 1, fit);
    this.canvas.width = width;
    this.canvas.height = height;
    this.canvas.style.imageRendering = this.scale < 1 ? 'auto' : ''; // shrunk pixel art reads better smoothed
    const box = this.canvas.parentElement;
    box.style.width = `${width * this.scale}px`;
    box.style.height = `${height * this.scale}px`;
    this.overlay.style.setProperty('--px', String(this.scale)); // labels size with the art
    this.ctx.imageSmoothingEnabled = false;
    this.buildStaticLayer();
    for (const label of this.labels.values()) label.dataset.pos = '';
  }

  // Grass, roads, the forest edge, the square's paving and the scenery of unclaimed land. From
  // above, trees and the rest are painted into it; isometric keeps them as upright props.
  buildStaticLayer() {
    this.props = [];
    const layer = this.staticLayer;
    const width = WORLD_W;
    const height = this.worldH;
    layer.width = width;
    layer.height = height;
    const ctx = layer.getContext('2d');
    this.buildNav();
    S.drawGrass(ctx, 0, 0, width, height);
    this.drawRoads(ctx);
    for (const base of this.bases.values()) S.drawBaseGround(ctx, base.pos.x, base.pos.y, PLOT_W, PLOT_H, BASE_GROUND);
    this.drawWildLand(ctx);
    this.drawFogGround(ctx);
    this.drawSquareScenery(ctx);
    this.drawForestEdge(ctx, width, height);
    this.world3d?.markStatic();
  }

  // Trees, bushes and rocks on every bit of land no base, road or the square uses (the strip right of
  // the main road too, once the square leaves it). Each one has a fixed place, so moving a base
  // clears or grows the woods only where it went.
  drawWildLand(ctx) {
    const step = 26;
    const areas = this.occupiedSpots().map(({ pos }) => ({ ...pos, w: PLOT_W, h: PLOT_H }));
    areas.push({ ...this.square, w: SQUARE_W, h: SQUARE_H });
    const props = [];
    for (let gy = MAP_Y0; gy < this.landBottom; gy += step) {
      for (let gx = MAP_X0; gx < WORLD_W - BORDER; gx += step) {
        const h = S.ihash(gx * 977 + gy * 131);
        if (h % 10 >= 3) continue; // mostly open ground: room to build
        const x = gx + 3 + (h % (step - 6));
        const y = gy + 10 + ((h >>> 8) % (step - 10));
        if (x > WORLD_W - BORDER - 5 || y > this.landBottom - 2) continue;
        if (areas.some((a) => x > a.x - 8 && x < a.x + a.w + 8 && y > a.y - 2 && y < a.y + a.h + 14)) continue;
        if (this.isNearRoad(x, y)) continue;
        const roll = (h >>> 16) % 16;
        props.push({ x, y, kind: roll < 9 ? 'tree' : roll < 13 ? 'bush' : 'rock', size: (h >>> 20) % 3 });
      }
    }
    props.sort((a, b) => a.y - b.y);
    for (const prop of props) this.addProp(ctx, prop.kind, prop.x, prop.y, prop.size);
  }

  // Upright scenery (foot at x, y): painted into the ground from above, a standing sprite in isometric.
  addProp(ctx, kind, x, y, size = 0) {
    const prop = { kind, x, y, size };
    this.props.push(prop); // isometric and 3D stand them up
    if (this.viewMode === 'top') this.drawProp(ctx, prop);
  }

  drawProp(ctx, { kind, x, y, size }) {
    if (kind === 'tree') S.drawTree(ctx, x, y, size);
    else if (kind === 'bush') S.drawBush(ctx, x, y);
    else if (kind === 'rock') S.drawRock(ctx, x, y, 4 + size);
    else if (kind === 'barrel') S.drawBarrel(ctx, x - 3, y - 8);
    else if (kind === 'crate') S.drawCrate(ctx, x - 3, y - 7);
    else if (kind === 'ruin') this.drawRuin(ctx, x, y, size);
  }

  // A dark ruin in the fog: a lone tower or a house with its roof, picked by the repo's hash.
  drawRuin(ctx, x, ground, h) {
    const shade = '#1c231b';
    if (h % 3 === 0) {
      S.rect(ctx, x + 4, ground - 18, 7, 18, shade);
      for (let k = 0; k < 7; k += 2) S.rect(ctx, x + 4 + k, ground - 20, 1, 2, shade);
      return;
    }
    S.rect(ctx, x, ground - 9, 16, 9, shade);
    S.rect(ctx, x + 2, ground - 13, 12, 4, shade);
    S.rect(ctx, x + 5, ground - 16, 6, 3, shade);
    if (h % 2) S.rect(ctx, x + 11, ground - 18, 2, 5, shade);
  }

  // Unexplored land: dim ground with the dark ruins of the repositories nobody has visited yet.
  drawFogGround(ctx) {
    if (this.fogNames.length === 0) return;
    const y0 = this.landBottom;
    const width = LAND_X1 - MAP_X0;
    S.rect(ctx, MAP_X0, y0, width, FOG_H, '#2f3a2b');
    for (let x = MAP_X0; x < LAND_X1; x += 2) if (S.ihash(x * 7) % 2) S.rect(ctx, x, y0, 1, 1, '#3d4a35'); // ragged edge
    const ruins = this.fogNames.slice(0, FOG_RUINS_MAX);
    const step = width / ruins.length;
    ruins.forEach((name, i) => {
      const h = S.hashString(name);
      const x = Math.round(MAP_X0 + step * i + step / 2 - 8 + (h % 7) - 3);
      this.addProp(ctx, 'ruin', x, y0 + FOG_H - 6 - ((h >>> 4) % 6), h);
    });
  }

  // A flat veil over the fog band (no clouds): the ruins show through, dimmed.
  drawFogMist(ctx) {
    if (this.fogNames.length === 0) return;
    ctx.save();
    ctx.globalAlpha = 0.22;
    S.rect(ctx, MAP_X0, this.landBottom, LAND_X1 - MAP_X0, FOG_H, '#c9d2d6');
    ctx.restore();
  }

  /** Repositories no agent has explored yet: they wait under the fog, below the land. */
  setFog(names) {
    const next = [...names].sort((a, b) => a.localeCompare(b));
    if (next.join('|') === this.fogNames.join('|')) return;
    this.fogNames = next;
    this.refreshLayout();
  }

  /** A base picked in the empire overview glows for a moment (and the zoomed map scrolls to it). */
  highlightBase(project) {
    const base = this.bases.get(project);
    if (!base) return;
    this.baseHighlight = { project, until: performance.now() + HIGHLIGHT_MS };
    this.centerOnWorld(base.pos.x + PLOT_W / 2, base.pos.y + PLOT_H / 2);
  }

  centerOnWorld(x, y) {
    if ((this.viewZoom ?? 1) <= 1) return;
    if (this.is3d) {
      this.world3d.lookAt(x, y);
      return;
    }
    const stage = this.canvas.parentElement.parentElement;
    const stageBox = stage.getBoundingClientRect();
    const box = this.canvas.getBoundingClientRect();
    const p = this.project(x, y);
    stage.scrollLeft += box.left + p.x * this.scale - (stageBox.left + stageBox.width / 2);
    stage.scrollTop += box.top + p.y * this.scale - (stageBox.top + stageBox.height / 2);
  }

  // ---------- Minimap (only while the map is zoomed in, as in the game) ----------

  setMinimap(canvas) {
    this.minimap = canvas ? { canvas, drawnAt: 0 } : null;
    if (!canvas) return;
    canvas.width = Math.round(WORLD_W / 3);
    canvas.height = Math.round(this.worldH / 3);
  }

  drawMinimap(now) {
    const minimap = this.minimap;
    if (!minimap || now - minimap.drawnAt < MINIMAP_FRAME_MS) return;
    minimap.drawnAt = now;
    const { canvas } = minimap;
    const k = canvas.width / WORLD_W;
    if (canvas.height !== Math.round(this.worldH * k)) canvas.height = Math.round(this.worldH * k);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.staticLayer, 0, 0, canvas.width, canvas.height);
    for (const base of this.bases.values()) {
      ctx.fillStyle = base.team[0];
      ctx.fillRect(base.pos.x * k, base.pos.y * k, PLOT_W * k, PLOT_H * k);
    }
    for (const ch of this.chars.values()) {
      if (ch.isObserver) continue;
      ctx.fillStyle = needsUser(ch.agent) ? '#fbbf24' : S.C.white;
      ctx.fillRect(ch.x * k - 1, ch.y * k - 2, 2, 2);
    }
    // the part of the map on screen
    const stage = this.canvas.parentElement.parentElement;
    const stageBox = stage.getBoundingClientRect();
    const box = this.canvas.getBoundingClientRect();
    const corners = this.is3d
      ? [[0, 0], [this.world3d.width, 0], [this.world3d.width, this.world3d.height], [0, this.world3d.height]].map(([cx, cy]) => this.world3d.groundAtLocal(cx, cy) ?? this.world3d.groundAtLocal(cx, this.world3d.height * 0.35) ?? { x: 0, y: 0 })
      : [
          [stageBox.left, stageBox.top],
          [stageBox.right, stageBox.top],
          [stageBox.right, stageBox.bottom],
          [stageBox.left, stageBox.bottom],
        ].map(([cx, cy]) => this.unproject((cx - box.left) / this.scale, (cy - box.top) / this.scale));
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width, canvas.height);
    ctx.clip();
    ctx.strokeStyle = S.C.white;
    ctx.lineWidth = 1;
    ctx.beginPath();
    corners.forEach(({ x, y }, i) => (i === 0 ? ctx.moveTo(x * k, y * k) : ctx.lineTo(x * k, y * k)));
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  /** A click on the minimap: that point of the world goes to the middle of the stage. */
  centerOnMinimap(event) {
    const box = this.minimap?.canvas.getBoundingClientRect();
    if (!box) return;
    const x = ((event.clientX - box.left) / box.width) * WORLD_W;
    const y = ((event.clientY - box.top) / box.height) * this.worldH;
    this.centerOnWorld(x, y);
  }

  // A prop here would stand on a road, or its canopy would cover one.
  isNearRoad(x, y) {
    for (let wy = y - 16; wy <= y + 4; wy += CELL) {
      for (let wx = x - 8; wx <= x + 8; wx += CELL) if (this.nav.isRoad[this.cellAt(wx, wy)]) return true;
    }
    return false;
  }

  drawRoads(ctx) {
    const centers = [];
    this.nav.isRoad.forEach((isRoad, cell) => {
      if (isRoad) centers.push(this.cellCenter(cell));
    });
    for (const { x, y } of centers) S.rect(ctx, x - ROAD / 2, y - ROAD / 2, ROAD, ROAD, S.C.dirtDark);
    for (const { x, y } of centers) S.rect(ctx, x - ROAD / 2 + 1, y - ROAD / 2 + 1, ROAD - 2, ROAD - 2, S.C.dirt);
    for (const { x, y } of centers) {
      const h = S.ihash(x * 31 + y * 17);
      if (h % 3 === 0) S.rect(ctx, x - 3 + (h % 6), y - 3 + ((h >>> 4) % 6), 1, 1, S.C.dirtDark);
      if (h % 5 === 1) S.rect(ctx, x - 3 + ((h >>> 8) % 6), y - 3 + ((h >>> 12) % 6), 1, 1, S.C.dirtLight);
    }
  }

  // ---------- Paths and roads ----------

  cellAt(x, y) {
    const { cols, rows } = this.nav;
    const col = Math.min(cols - 1, Math.max(0, Math.floor(x / CELL)));
    const row = Math.min(rows - 1, Math.max(0, Math.floor(y / CELL)));
    return row * cols + col;
  }

  cellCenter(cell) {
    const col = cell % this.nav.cols;
    return { x: col * CELL + CELL / 2, y: ((cell - col) / this.nav.cols) * CELL + CELL / 2 };
  }

  /**
   * The path grid and its roads: the main road down the right, then one road from each base's
   * gate (and from the square, on open land) to the nearest road, nearest first, so the farther
   * ones branch off those.
   */
  buildNav() {
    const cols = Math.ceil(WORLD_W / CELL);
    const rows = Math.ceil(this.worldH / CELL);
    const cost = new Float32Array(cols * rows).fill(COST_GRASS);
    const isRoad = new Uint8Array(cols * rows);
    const spots = this.occupiedSpots();
    const sq = this.square;
    const isSquareCell = (x, y) => x > sq.x && x < sq.x + SQUARE_W && y > sq.y && y < sq.y + SQUARE_H;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = col * CELL + CELL / 2;
        const y = row * CELL + CELL / 2;
        const isFog = y > this.landBottom && y < this.landBottom + this.fogHeight && x < LAND_X1;
        const isOff = x < MAP_X0 || y < MAP_Y0 || x > SQUARE_X || isFog; // forest edge, the strip right of the main road and the fog
        if (isOff || isSquareCell(x, y) || spots.some(({ pos }) => isInsideSpot(pos, x, y))) cost[row * cols + col] = COST_BLOCKED;
      }
    }
    const mainCol = Math.floor(MAIN_X / CELL);
    for (let row = Math.floor(MAP_Y0 / CELL); row < rows; row++) isRoad[row * cols + mainCol] = 1;
    const size = cols * rows * 4;
    this.nav = { cols, rows, cost, isRoad, best: new Float64Array(size), from: new Int32Array(size), closed: new Uint8Array(size) };
    const gates = spots.map(({ pos }) => ({ pos, exit: gateExit(pos) }));
    if (!this.isSquareHome) gates.push({ pos: sq, exit: this.squareEntrance() });
    gates.sort((a, b) => b.pos.x - a.pos.x || a.pos.y - b.pos.y);
    for (const { exit } of gates) {
      const start = this.cellAt(exit.x, exit.y);
      const path = searchGrid(this.nav, start, (cell) => isRoad[cell] === 1, () => 0);
      isRoad[start] = 1;
      for (const cell of path ?? []) isRoad[cell] = 1;
    }
    // Roads go around the square, but villagers cross it on foot to the campfire and the market.
    for (let row = Math.floor(sq.y / CELL); row * CELL < sq.y + SQUARE_H; row++) {
      for (let col = Math.floor(sq.x / CELL); col * CELL < sq.x + SQUARE_W; col++) {
        if (isSquareCell(col * CELL + CELL / 2, row * CELL + CELL / 2)) cost[row * cols + col] = COST_GRASS;
      }
    }
    isRoad.forEach((road, cell) => {
      if (road && cost[cell] < COST_BLOCKED) cost[cell] = COST_ROAD;
    });
  }

  /** Corners of the cheapest walk between two points, by the roads where they help. */
  findPath(from, to) {
    const { cols } = this.nav;
    const start = this.cellAt(from.x, from.y);
    const goal = this.cellAt(to.x, to.y);
    const goalCol = goal % cols;
    const goalRow = (goal - goalCol) / cols;
    const heuristic = (cell) => {
      const col = cell % cols;
      return (Math.abs(col - goalCol) + Math.abs((cell - col) / cols - goalRow)) * COST_ROAD;
    };
    const cells = searchGrid(this.nav, start, (cell) => cell === goal, heuristic);
    if (!cells) return [];
    const corners = [];
    for (let i = 0; i < cells.length - 1; i++) {
      const previous = i === 0 ? start : cells[i - 1];
      if (cells[i + 1] - cells[i] !== cells[i] - previous) corners.push(this.cellCenter(cells[i]));
    }
    return corners;
  }

  // Paved market corner, a ring of bare earth around the campfire, crates and barrels.
  drawSquareScenery(ctx) {
    const sq = this.square;
    S.drawPlaza(ctx, sq.x + PAVING.x, sq.y + PAVING.y, PAVING.w, PAVING.h);
    S.drawDirtPatch(ctx, sq.x + CAMPFIRE.x, sq.y + CAMPFIRE.y - 8, 40, 26);
    S.drawDirtPatch(ctx, sq.x + 34, sq.y + 160, 30, 12);
    this.addProp(ctx, 'barrel', sq.x + 109, sq.y + 38);
    this.addProp(ctx, 'barrel', sq.x + 61, sq.y + 40);
    this.addProp(ctx, 'crate', sq.x + 110, sq.y + 49);
    this.addProp(ctx, 'bush', sq.x + 8, sq.y + 74);
    this.addProp(ctx, 'bush', sq.x + 112, sq.y + 110);
    this.addProp(ctx, 'bush', sq.x + 10, sq.y + 132);
    this.addProp(ctx, 'tree', sq.x + 108, sq.y + 134, 1);
  }

  drawForestEdge(ctx, width, height) {
    for (let x = -2; x < width + 6; x += 9) {
      const h = S.ihash(x + 17);
      this.addProp(ctx, 'tree', x + (h % 4), 10 + ((h >>> 4) % 3), (h >>> 8) % 2);
    }
    for (let y = 14; y < height; y += 10) {
      const h = S.ihash(y + 401);
      this.addProp(ctx, 'tree', 4 + (h % 3), y, (h >>> 6) % 2);
      this.addProp(ctx, 'tree', width - 5 - (h % 3), y + 3, (h >>> 9) % 2);
    }
    for (let x = -2; x < width + 6; x += 9) {
      if (Math.abs(x - MAIN_X) < ROAD) continue; // the main road leaves the map here
      const h = S.ihash(x + 733);
      this.addProp(ctx, 'tree', x + (h % 4), height + 3, (h >>> 8) % 2);
    }
  }

  // Rebuilds the roads and the cached ground when a base (or the square) is founded, moved or
  // abandoned, and grows the land so there is always room to found one more base.
  refreshLayout() {
    const spots = this.occupiedSpots();
    const lowest = Math.max(MAP_Y0, this.square.y + SQUARE_H, ...spots.map(({ pos }) => pos.y + PLOT_H));
    this.landBottom = Math.max(MAP_Y0 + MIN_LAND_ROWS * (PLOT_H + ROAD), lowest + ROAD + FREE_ROWS * (PLOT_H + ROAD));
    const places = spots.map(({ project, pos }) => `${project}@${pos.x},${pos.y}`).sort();
    const key = `${this.landBottom}|${this.fogNames.join(',')}|square@${this.square.x},${this.square.y}|${places.join('|')}`;
    if (key === this.layoutKey) return;
    this.layoutKey = key;
    if (!this.nav || this.sizedWorldH !== this.worldH) this.resize();
    else this.buildStaticLayer();
  }

  // ---------- Data sync ----------

  setAgents(allAgents) {
    const now = performance.now();
    this.lastAgents = allAgents;
    for (const agent of allAgents) if (agent.cwd && !isObserver(agent)) this.repoPaths.set(agent.project, agent.cwd);
    this.pruneOrders(allAgents);
    const agents = allAgents.filter((agent) => !this.hidden.has(this.workProjectOf(agent)));
    const liveIds = new Set(agents.map((agent) => agent.id));
    // First paint: bases in name order, so the map reads the same on every launch.
    const ordered = this.hasSynced ? agents : [...agents].sort((a, b) => this.workProjectOf(a).localeCompare(this.workProjectOf(b)));
    for (const agent of ordered) {
      let ch = this.chars.get(agent.id);
      if (!ch) ch = this.spawn(agent, now);
      else if (ch.goal?.type === 'exit') this.cancelExit(ch); // came back while walking out
      ch.agent = agent;
      const project = this.workProjectOf(agent);
      if (!ch.isObserver && ch.project !== project) this.relocateVillager(ch, project, now);
      this.syncBots(ch, now);
    }
    // Recruits have no session yet, so the snapshot never lists them.
    const picked = [...this.selected].filter((id) => liveIds.has(id) || this.chars.get(id)?.isRecruit);
    if (picked.length !== this.selected.size) this.setSelection(picked);
    for (const ch of this.chars.values()) {
      if (!ch.isRecruit && !liveIds.has(ch.id) && ch.goal?.type !== 'exit') this.sendToExit(ch, now);
    }
    this.hasSynced = true;
    this.refreshLayout();
  }

  spawn(agent, now) {
    const isScout = isObserver(agent);
    const project = isScout ? agent.project : this.workProjectOf(agent);
    const ch = makeChar(agent.id, agent, project, S.makeLook(agent.id, agent.project, isScout ? 'scout' : 'villager'), MAIN_X, this.worldH + 8);
    ch.isObserver = isScout;
    if (!isScout) this.dressInTeam(ch.look, project);
    this.chars.set(agent.id, ch);
    if (isScout) {
      // The scout rides in from the road at the bottom of the map.
      if (!this.hasSynced) this.placeImmediately(ch, now);
      else this.walk(ch, { type: 'enter' }, [{ x: MAIN_X, y: this.landBottom - ROAD / 2 }], now);
      return ch;
    }
    const base = this.claimBase(ch.project, now);
    if (!this.hasSynced) {
      this.placeImmediately(ch, now);
      return ch;
    }
    // New villagers come out of their town center, once it has risen (for a new base).
    this.training.delete(agent.project);
    this.training.delete(ch.project);
    // A recruit sent here is still on its way: the session's villager is that recruit, from where it walks.
    const recruit = this.takeRecruit(ch.project);
    if (recruit) {
      Object.assign(ch, { x: recruit.x, y: recruit.y, dir: recruit.dir, facing: recruit.facing });
      return ch;
    }
    const { x, y } = base.pos;
    Object.assign(ch, { x: x + DOOR.x, y: y + DOOR.y, hiddenUntil: base.foundedAt + FOUNDING_MS });
    this.walk(ch, { type: 'enter' }, [{ x: x + DOOR.x, y: y + DOOR.y + 5 }], now);
    return ch;
  }

  placeImmediately(ch, now) {
    if (ch.isObserver || !wantsBase(ch.agent)) {
      const poi = this.reservePoi(ch);
      if (poi) {
        Object.assign(ch, { x: poi.x, y: poi.y, dir: poi.dir, mode: 'poi', goal: { type: 'poi', poi } });
        ch.poiUntil = now + randomBetween(poi.dwell) * 1000;
        return;
      }
      if (ch.isObserver) {
        Object.assign(ch, { x: MAIN_X, y: MAP_Y0 + PLOT_H + ROAD / 2, mode: 'free' });
        return;
      }
    }
    const node = nodeFor(ch.agent);
    Object.assign(ch, this.claimSpot(ch, node), { mode: 'working', node, nodeSince: now, dir: NODES[node].dir, goal: { type: 'node', node } });
  }

  // A repository keeps its place while it has agents (or for good, when pinned); a new one takes
  // the land clicked for it, or the first free spot.
  claimBase(project, now) {
    const base = this.bases.get(project);
    if (base) return base;
    this.dropExpiredReservations(now);
    const reservation = this.reservations.get(project);
    this.reservations.delete(project);
    return this.createBase(project, reservation?.pos ?? this.findFreeSpot(), this.hasSynced ? now : -Infinity);
  }

  createBase(project, pos, foundedAt) {
    const base = { project, pos, team: this.teamOf(project), foundedAt, spots: new Map() };
    this.bases.set(project, base);
    if (this.hasSynced && Number.isFinite(foundedAt)) this.onEvent?.({ kind: 'founded', project });
    return base;
  }

  removeBase(project) {
    this.bases.delete(project);
  }

  // ---------- Where each agent works ----------

  /**
   * Repositories in ~/Code: their folders tell where an edited file lives, and their size the era
   * a town center suggests.
   */
  setRepoPaths(projects) {
    for (const { name, path, trackedFiles } of projects) {
      if (name && path && !this.repoPaths.has(name)) this.repoPaths.set(name, path);
      if (name && Number.isFinite(trackedFiles)) this.repoSizes.set(name, trackedFiles);
    }
  }

  repoPathOf(project) {
    return this.repoPaths.get(project) ?? null;
  }

  /**
   * The base a villager works at. A session never leaves its folder, but it can work elsewhere:
   * the latest file it edited in the current task (or since your order) decides; with no edit
   * since then, your order does; otherwise it is home.
   */
  workProjectOf(agent) {
    if (isObserver(agent)) return agent.project;
    const order = this.orders.get(agent.id);
    const since = Math.max(agent.lastPromptAt ?? 0, order?.at ?? 0);
    const latest = agent.files?.[0];
    if (latest && Number.isFinite(latest.at) && latest.at >= since) return projectOfPath(latest.path, this.repoPaths) ?? agent.project;
    return order?.project ?? agent.project;
  }

  /** Sends these agents' villagers to work at another repository's base (the order itself goes out elsewhere). */
  orderTo(ids, project) {
    const at = Date.now();
    for (const id of ids) {
      const agent = this.lastAgents.find((a) => a.id === id);
      if (!agent || isObserver(agent)) continue;
      if (project === agent.project) this.orders.delete(id); // back home
      else this.orders.set(id, { project, at });
    }
    if (this.hidden.has(project)) this.hidden.delete(project);
    this.setAgents(this.lastAgents);
    this.saveLayout();
  }

  // Orders end with their session.
  pruneOrders(allAgents) {
    if (!this.hasSynced || this.orders.size === 0) return;
    const live = new Set(allAgents.map((agent) => agent.id));
    let isChanged = false;
    for (const id of this.orders.keys()) {
      if (live.has(id)) continue;
      this.orders.delete(id);
      isChanged = true;
    }
    if (isChanged) this.saveLayout();
  }

  // The villager walks from its current base to the new one, in its colors; an emptied temporary base goes away.
  relocateVillager(ch, project, now) {
    const previous = ch.project;
    this.releaseSpot(ch);
    ch.project = project;
    this.dressInTeam(ch.look, project);
    this.claimBase(project, now);
    if (ch.goal?.type === 'exit') this.sendToExit(ch, now);
    else if (ch.mode !== 'poi' && ch.goal?.type !== 'poi') this.sendToNode(ch, ch.goal?.node ?? ch.node ?? nodeFor(ch.agent), now);
    const isEmpty = ![...this.chars.values()].some((other) => other.project === previous && !other.isObserver);
    if (isEmpty && !this.pinned.has(previous)) this.removeBase(previous);
    this.refreshLayout();
  }

  // ---------- Selection ----------

  setSelection(ids) {
    const next = new Set(ids.filter((id) => this.chars.has(id) && !this.chars.get(id).isObserver));
    const isSame = next.size === this.selected.size && [...next].every((id) => this.selected.has(id));
    if (isSame) return;
    this.selected = next;
    this.onSelectionChange?.([...next]);
  }

  selectAll() {
    this.setSelection([...this.chars.values()].filter((ch) => !ch.isObserver && ch.goal?.type !== 'exit').map((ch) => ch.id));
  }

  toggleSelected(id) {
    const next = new Set(this.selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.setSelection([...next]);
  }

  // ---------- Recruits: summoned villagers waiting for an order ----------

  /**
   * A villager with no session yet. It walks in from the main road to its place in line in the
   * square, or stands where it was dropped (at, world pixels), until you send it to a base: the
   * session starts in that repository's folder and takes this villager's place. Returns its id.
   */
  addRecruit(at = null) {
    const id = `recruit:${++this.recruitCount}`;
    const agent = { id, isRecruit: true, target: null, entrypoint: 'recruit', name: 'Recruta', title: 'Recruta', project: null, status: 'idle', activity: { kind: 'idle', label: 'Aguardando ordem', since: Date.now() }, files: [], subagents: [] };
    const look = { ...S.makeLook(id, id), ...RECRUIT_CLOTH, shirt: RECRUIT_CLOTH.tunic };
    const slot = at ? null : this.freeRallySlot();
    const home = at ?? formationSpot(this.rallyPoint(), slot);
    const start = at ?? (this.isSquareHome ? { x: MAIN_X, y: home.y } : this.squareEntrance());
    const ch = makeChar(id, agent, null, look, start.x, start.y);
    Object.assign(ch, { isObserver: false, isRecruit: true, recruit: { home, slot, sentAt: 0 } });
    this.chars.set(id, ch);
    return id;
  }

  /** Recruits still waiting for an order, the longest waiting first. */
  idleRecruitIds() {
    return [...this.chars.values()].filter((ch) => ch.isRecruit && !ch.agent.target && ch.goal?.type !== 'leave').map((ch) => ch.id);
  }

  /** A recruit's agent ({ isRecruit, target }), or null when the id is not a recruit. */
  recruitOf(id) {
    const ch = this.chars.get(id);
    return ch?.isRecruit ? ch.agent : null;
  }

  freeRallySlot() {
    const taken = new Set([...this.chars.values()].filter((ch) => ch.isRecruit).map((ch) => ch.recruit.slot));
    let slot = 0;
    while (taken.has(slot)) slot += 1;
    return slot;
  }

  // Back to its place when it is not there; a recruit sent to a base keeps walking.
  thinkRecruit(ch, now) {
    if (ch.mode !== 'free' || ch.agent.target) return;
    const { home } = ch.recruit;
    if (Math.hypot(ch.x - home.x, ch.y - home.y) < 1) return;
    this.walk(ch, { type: 'rally' }, this.route(ch, home), now);
  }

  /**
   * Recruits walk into a base's town center; the session started there takes over the first one
   * still on its way. They leave the selection: their session already started, so a second order
   * would start another.
   */
  sendRecruits(ids, project) {
    const pos = this.bases.get(project)?.pos ?? this.reservations.get(project)?.pos;
    if (!pos) return;
    const now = performance.now();
    const door = { x: pos.x + DOOR.x, y: pos.y + DOOR.y };
    for (const id of ids) {
      const ch = this.chars.get(id);
      if (!ch?.isRecruit) continue;
      ch.agent.target = project;
      Object.assign(ch.recruit, { slot: null, sentAt: now });
      this.walk(ch, { type: 'garrison' }, [...this.route(ch, { x: door.x, y: door.y + 5 }), door], now);
    }
    this.setSelection([...this.selected].filter((id) => !ids.includes(id)));
  }

  takeRecruit(project) {
    const onTheWay = [...this.chars.values()].filter((ch) => ch.isRecruit && ch.agent.target === project && ch.goal?.type === 'garrison');
    const first = onTheWay.sort((a, b) => a.recruit.sentAt - b.recruit.sentAt)[0];
    if (first) this.chars.delete(first.id);
    return first ?? null;
  }

  /** Right-click on the ground with recruits picked: the idle ones go stand there, side by side. Returns how many went. */
  moveRecruits(at) {
    const now = performance.now();
    const crew = [...this.selected].map((id) => this.chars.get(id)).filter((ch) => ch?.isRecruit && !ch.agent.target);
    crew.forEach((ch, index) => {
      Object.assign(ch.recruit, { home: formationSpot(at, index, crew.length), slot: null });
      this.walk(ch, { type: 'rally' }, this.route(ch, ch.recruit.home), now);
    });
    return crew.length;
  }

  /** The recruit walks off the map by the main road; no session ever started for it. */
  dismissRecruit(id) {
    const ch = this.chars.get(id);
    if (!ch?.isRecruit) return;
    ch.recruit.slot = null;
    if (this.selected.has(id)) this.setSelection([...this.selected].filter((other) => other !== id));
    const out = [...this.route(ch, { x: MAIN_X, y: this.landBottom - ROAD / 2 }), { x: MAIN_X, y: this.worldH + 10 }];
    this.walk(ch, { type: 'leave' }, out, performance.now());
  }

  removeRecruit(ch) {
    this.chars.delete(ch.id);
    if (this.selected.has(ch.id)) this.setSelection([...this.selected].filter((id) => id !== ch.id));
  }

  /** The ground under the pointer, in world pixels, where a villager can stand: on the map, outside every base. */
  groundAt(event) {
    const point = this.is3d ? this.world3d.groundAtClient(event.clientX, event.clientY) : this.worldAt(event);
    if (!point) return null;
    const isOnMap = point.x >= MAP_X0 && point.x <= WORLD_W - BORDER && point.y >= MAP_Y0 && point.y <= this.landBottom;
    return isOnMap && !this.baseAt(point.x, point.y) ? { x: point.x, y: point.y } : null;
  }

  // ---------- Layout the user controls: pin, hide, move, design ----------

  getLayout() {
    const paths = {};
    for (const project of this.pinned.keys()) if (this.repoPaths.has(project)) paths[project] = this.repoPaths.get(project);
    return {
      pinned: Object.fromEntries(this.pinned),
      hidden: [...this.hidden],
      paths,
      orders: Object.fromEntries(this.orders),
      designs: Object.fromEntries(this.designs),
      eras: Object.fromEntries(this.reachedEras),
      wonders: Object.fromEntries(this.wondersSeen),
      square: { ...this.square },
    };
  }

  isPinned(project) {
    return this.pinned.has(project);
  }

  hasBase(project) {
    return this.bases.has(project);
  }

  /** The repositories with a base on the map now. */
  baseProjects() {
    return [...this.bases.keys()];
  }

  saveLayout() {
    this.onLayoutChange?.(this.getLayout());
  }

  /**
   * How a base's town center looks: the era (how robust it stands) and the style (its city). The
   * era follows the repository's size until the user picks one.
   */
  designOf(project) {
    const custom = this.designs.get(project) ?? {};
    const files = this.repoSizes.get(project) ?? null;
    const stats = this.repoStats.get(project);
    const xp = stats ? xpOf(stats) : null;
    const earned = stats ? Math.max(eraForXp(xp), this.reachedEras.get(project) ?? 1) : suggestEra(files);
    const hasEra = S.ERAS.some((era) => era.id === custom.era);
    const hasStyle = S.TOWN_STYLES.some((style) => style.id === custom.style);
    const hasSize = S.SIZES.some((size) => size.id === custom.size);
    const ageDays = Number.isFinite(stats?.foundedAt) ? Math.max(0, Math.floor((Date.now() - stats.foundedAt) / DAY_MS)) : null;
    const suggestedSize = suggestSize(files, ageDays);
    return {
      era: hasEra ? custom.era : earned,
      style: hasStyle ? custom.style : S.DEFAULT_TOWN.style,
      size: hasSize ? custom.size : suggestedSize,
      rotation: [1, 2, 3].includes(custom.rotation) ? custom.rotation : 0,
      suggestedEra: earned,
      isEraAuto: !hasEra,
      suggestedSize,
      isSizeAuto: !hasSize,
      ageDays,
      files,
      xp,
      nextXp: stats ? (ERA_XP_STEPS.at(earned - 1) ?? null) : null,
      commits: stats?.commitsTotal ?? null,
      hours: stats ? Math.round(stats.agentMinutesTotal / 60) : null,
      color: Number.isInteger(custom.color) ? custom.color : null,
      nickname: custom.nickname ?? '',
    };
  }

  /**
   * era null: follow the work again; size null: follow the repository's size and age; style null: the
   * default city; color null: the automatic one; rotation: quarter turns of the town center (3D).
   */
  setDesign(project, { era = null, size = null, rotation = 0, style = null, color = null, nickname = '' }) {
    const design = {};
    if (era) design.era = era;
    if (S.SIZES.some((s) => s.id === size)) design.size = size;
    if ([1, 2, 3].includes(rotation)) design.rotation = rotation;
    if (style && style !== S.DEFAULT_TOWN.style) design.style = style;
    if (Number.isInteger(color) && S.TEAM_COLORS[color]) design.color = color;
    const name = nickname.trim().slice(0, NICKNAME_MAX);
    if (name && name !== project) design.nickname = name;
    if (Object.keys(design).length > 0) this.designs.set(project, design);
    else this.designs.delete(project);
    this.applyTeamColors(project);
    this.saveLayout();
  }

  /** A quarter turn of the town center (3D view), keeping the rest of its design. */
  rotateDesign(project) {
    const design = { ...(this.designs.get(project) ?? {}) };
    const rotation = ((design.rotation ?? 0) + 1) % 4;
    if (rotation) design.rotation = rotation;
    else delete design.rotation;
    if (Object.keys(design).length > 0) this.designs.set(project, design);
    else this.designs.delete(project);
    this.saveLayout();
  }

  /** The base's colors: the user's pick from the palette, or the one its name hashes to. */
  teamOf(project) {
    const color = this.designs.get(project)?.color;
    return Number.isInteger(color) && S.TEAM_COLORS[color] ? [...S.TEAM_COLORS[color]] : [S.teamColor(project), S.teamShade(project)];
  }

  displayName(project) {
    return this.designs.get(project)?.nickname || project;
  }

  /** The name the app shows for this repository; empty goes back to the folder's. The folder never changes. */
  setNickname(project, nickname) {
    const design = { ...this.designs.get(project) };
    const name = nickname.trim().slice(0, NICKNAME_MAX);
    if (name && name !== project) design.nickname = name;
    else delete design.nickname;
    if (Object.keys(design).length > 0) this.designs.set(project, design);
    else this.designs.delete(project);
    this.saveLayout();
  }

  // A villager wears the color of the base it works at (a recruit keeps its undyed linen).
  dressInTeam(look, project) {
    const [color, shade] = this.teamOf(project);
    Object.assign(look, { tunic: color, tunicShade: shade, shirt: color });
  }

  applyTeamColors(project) {
    const base = this.bases.get(project);
    if (base) base.team = this.teamOf(project);
    for (const ch of this.chars.values()) if (!ch.isObserver && !ch.isRecruit && ch.project === project) this.dressInTeam(ch.look, project);
  }

  /**
   * What each base's agents spent of the plan's session window, for the balloon over its town
   * center: { tokens, percent, sessionPercent, severity } by project (percent null with no window open).
   */
  setSpend(spend) {
    this.spend = spend;
  }

  spendOf(project) {
    return this.spend.get(project) ?? null;
  }

  /**
   * The empire's numbers arrived (get_empire): experience raises eras (with the age-up beam and a
   * callback for a base on the map) and milestones raise wonders. The first count is silent.
   */
  setEmpireStats(repos) {
    let isChanged = false;
    for (const repo of repos) {
      this.repoStats.set(repo.name, repo);
      if (Number.isFinite(repo.trackedFiles)) this.repoSizes.set(repo.name, repo.trackedFiles);
      const earned = eraForXp(xpOf(repo));
      const reached = this.reachedEras.get(repo.name) ?? 0;
      if (earned > reached) {
        this.reachedEras.set(repo.name, earned);
        isChanged = true;
        const isVisible = reached > 0 && this.bases.has(repo.name) && this.designOf(repo.name).isEraAuto;
        if (isVisible) this.celebrations.set(repo.name, performance.now());
        if (reached > 0) this.onAgeUp?.(repo.name, earned);
      }
      const seen = this.wondersSeen.get(repo.name);
      const wonders = this.wondersOf(repo.name);
      if (!seen || wonders.some((id) => !seen.includes(id))) {
        if (seen) for (const id of wonders.filter((w) => !seen.includes(w))) this.onEvent?.({ kind: 'wonder', project: repo.name, wonder: id });
        this.wondersSeen.set(repo.name, wonders);
        isChanged = true;
      }
    }
    if (isChanged) this.saveLayout();
  }

  wondersOf(project) {
    const stats = this.repoStats.get(project);
    return stats ? WONDERS.filter((wonder) => wonder.isEarned(stats)).map((wonder) => wonder.id) : [];
  }

  /** Keeps a repository's base on the map for good: at `spot` if given and free, else where it is. */
  pinBase(project, spot = null, path = null) {
    this.hidden.delete(project);
    if (path) this.repoPaths.set(project, path);
    const isFree = this.isSpotFree(spot, project, false);
    let base = this.bases.get(project);
    if (!base) base = this.createBase(project, isFree ? spot : this.findFreeSpot(spot, project), performance.now());
    else if (isFree) this.moveBase(project, spot);
    this.pinned.set(project, base.pos);
    if (this.hasSynced) this.setAgents(this.lastAgents); // a repo that was hidden brings its villagers back
    this.saveLayout();
    this.refreshLayout();
  }

  /** Back to a temporary base: it goes away once no agent works there. */
  unpinBase(project) {
    this.pinned.delete(project);
    const hasCrew = [...this.chars.values()].some((ch) => ch.project === project && !ch.isObserver);
    if (!hasCrew) this.removeBase(project);
    this.saveLayout();
    this.refreshLayout();
  }

  setHidden(project, isHidden) {
    if (isHidden) {
      this.hidden.add(project);
      for (const ch of [...this.chars.values()]) {
        if (ch.project !== project) continue;
        this.releasePoi(ch);
        this.chars.delete(ch.id);
        this.selected.delete(ch.id);
        for (const [id, bot] of this.bots) if (bot.parentId === ch.id) this.bots.delete(id);
      }
      this.reservations.delete(project);
      this.training.delete(project);
      this.removeBase(project);
    } else {
      this.hidden.delete(project);
      if (this.pinned.has(project) && !this.bases.has(project)) {
        const spot = this.pinned.get(project);
        const base = this.createBase(project, this.isSpotFree(spot, project, false) ? spot : this.findFreeSpot(spot, project), performance.now());
        this.pinned.set(project, base.pos);
      }
      if (this.hasSynced) this.setAgents(this.lastAgents);
    }
    this.saveLayout();
    this.refreshLayout();
  }

  /** Moves a base to free land (one road apart from its neighbours). Moving pins it. */
  moveBase(project, spot) {
    const base = this.bases.get(project);
    if (!base || !this.isSpotFree(spot, project, false)) return;
    if (spot.x === base.pos.x && spot.y === base.pos.y) return;
    base.pos = { x: spot.x, y: spot.y };
    this.pinned.set(project, base.pos);
    this.relocateCrew(base, performance.now());
    this.saveLayout();
    this.refreshLayout();
  }

  /** Dropping a base on another one: they trade places. The one moved is pinned. */
  swapBases(project, otherProject) {
    const base = this.bases.get(project);
    const other = this.bases.get(otherProject);
    if (!base || !other || base === other) return;
    [base.pos, other.pos] = [other.pos, base.pos];
    this.pinned.set(project, base.pos);
    if (this.pinned.has(otherProject)) this.pinned.set(otherProject, other.pos);
    const now = performance.now();
    for (const moved of [base, other]) this.relocateCrew(moved, now);
    this.saveLayout();
    this.refreshLayout();
  }

  // The villagers of a moved base walk over to the new place (by the roads, like everyone).
  relocateCrew(base, now) {
    const { x, y } = base.pos;
    for (const ch of this.chars.values()) {
      if (ch.project !== base.project || ch.isObserver) continue;
      if (now < ch.hiddenUntil) Object.assign(ch, { x: x + DOOR.x, y: y + DOOR.y });
      if (ch.goal?.type === 'exit') this.sendToExit(ch, now);
      else if (ch.goal?.type === 'node' || ch.mode === 'working') this.sendToNode(ch, ch.goal?.node ?? ch.node ?? nodeFor(ch.agent), now);
      else if (ch.goal?.type === 'enter') this.cancelExit(ch);
    }
  }

  // ---------- The square ----------

  // Beside the main road, where it starts (it may slide up and down there), not out on open land.
  get isSquareHome() {
    return this.square.x === SQUARE_HOME.x;
  }

  setSquare(pos) {
    this.square = { x: pos.x, y: pos.y };
    this.pois = POIS.map((poi) => ({ ...poi, x: pos.x + poi.x, y: pos.y + poi.y }));
  }

  rallyPoint() {
    return { x: this.square.x + RALLY.x, y: this.square.y + RALLY.y };
  }

  // A world point on the square, or on one part of it (square-local).
  isOnSquare(x, y, area = { x: 0, y: 0, w: SQUARE_W, h: SQUARE_H }) {
    const sq = this.square;
    return x >= sq.x + area.x && x <= sq.x + area.x + area.w && y >= sq.y + area.y && y <= sq.y + area.y + area.h;
  }

  // Where villagers come out of the square onto the roads: the main road beside it, or its own road.
  squareEntrance() {
    const sq = this.square;
    return this.isSquareHome ? { x: MAIN_X, y: sq.y + RALLY.y } : { x: sq.x + SQUARE_GATE_X, y: sq.y + SQUARE_H + ROAD / 2 };
  }

  /**
   * The square fits here: beside the main road, or on the land a road apart from every base.
   * isBounded: false lets it go below the land, which then grows.
   */
  isSquareFree(pos, isBounded = true) {
    if (!Number.isFinite(pos?.x) || !Number.isFinite(pos?.y) || pos.y < MAP_Y0) return false;
    if (pos.x === SQUARE_HOME.x) return !isBounded || pos.y + SQUARE_H <= this.landBottom;
    if (pos.x < MAP_X0 || pos.x + SQUARE_W > LAND_X1) return false;
    if (isBounded && pos.y + SQUARE_H + ROAD > this.landBottom) return false;
    return this.occupiedSpots().every(({ pos: base }) => !isOverlappingSquare(base, pos));
  }

  // Where the square dragged to this top-left would stand: back beside the main road when its middle
  // crosses it, else on the land, lined up with the bases nearby.
  snapSquare(spot) {
    const maxY = (gap) => Math.max(MAP_Y0, this.landBottom - gap - SQUARE_H);
    if (spot.x + SQUARE_W / 2 > MAIN_X) return { x: SQUARE_HOME.x, y: Math.min(maxY(0), Math.max(MAP_Y0, roundToEven(snapTo(spot.y, [MAP_Y0])))) };
    const xs = [MAP_X0, LAND_X1 - SQUARE_W];
    const ys = [MAP_Y0];
    for (const { pos } of this.occupiedSpots()) {
      xs.push(pos.x, pos.x - SQUARE_W - ROAD, pos.x + PLOT_W + ROAD);
      ys.push(pos.y, pos.y + PLOT_H - SQUARE_H, pos.y - SQUARE_H - ROAD, pos.y + PLOT_H + ROAD);
    }
    return {
      x: Math.min(LAND_X1 - SQUARE_W, Math.max(MAP_X0, roundToEven(snapTo(spot.x, xs)))),
      y: Math.min(maxY(ROAD), Math.max(MAP_Y0, roundToEven(snapTo(spot.y, ys)))),
    };
  }

  /** Moves the square; whoever is at the campfire, at the market or in line there walks over. */
  moveSquare(pos) {
    if (!this.isSquareFree(pos) || (pos.x === this.square.x && pos.y === this.square.y)) return;
    this.setSquare(pos);
    this.saveLayout();
    this.refreshLayout(); // the new roads first: the walks below take them
    const now = performance.now();
    for (const ch of this.chars.values()) {
      if (ch.poi) ch.poi = this.pois.find((poi) => poi.id === ch.poi.id);
      if (ch.goal?.type === 'poi' && ch.poi) this.walk(ch, { type: 'poi', poi: ch.poi }, this.route(ch, ch.poi), now);
      if (ch.isRecruit && ch.recruit.slot !== null) ch.recruit.home = formationSpot(this.rallyPoint(), ch.recruit.slot);
    }
  }

  // ---------- Building and summoning ----------

  /** Build menu: this repository's base follows the pointer until a click places it (Esc cancels). */
  startPlacing(project, path) {
    this.placing = { project, path, spot: null };
    this.landHover = null;
    this.viewCanvas.style.cursor = 'crosshair';
  }

  cancelPlacing() {
    this.placing = null;
    this.viewCanvas.style.cursor = 'default';
  }

  // Where the base being built would stand: the free spot nearest the pointer, on the land only.
  placingSpotAt(event) {
    const world = this.worldAt(event);
    const isOnLand = world.x >= MAP_X0 && world.x <= LAND_X1 && world.y >= MAP_Y0 && world.y <= this.landBottom;
    return isOnLand ? this.spotForPoint(world.x, world.y) : null;
  }

  /** A summon token dragged over the map: the base under it lights up (off the bases, a recruit appears where it drops). */
  previewSummon(event) {
    const hit = this.hitAt(event);
    this.summonTarget = hit?.project ?? null;
    return hit;
  }

  clearSummon() {
    this.landHover = null;
    this.summonTarget = null;
  }

  // ---------- Free land ----------

  // Pointer in canvas pixels (where sprites are drawn) and on the ground (world pixels).
  artAt(event) {
    const box = this.viewCanvas.getBoundingClientRect();
    return { x: (event.clientX - box.left) / this.scale, y: (event.clientY - box.top) / this.scale };
  }

  worldAt(event) {
    const art = this.artAt(event);
    return this.unproject(art.x, art.y);
  }

  baseAt(x, y) {
    for (const base of this.bases.values()) if (isInsideSpot(base.pos, x, y)) return base;
    return null;
  }

  /** Bases and the land staked for the ones about to be founded: [{ project, pos }]. */
  occupiedSpots() {
    const spots = [...this.bases.values()].map((base) => ({ project: base.project, pos: base.pos }));
    for (const [project, reservation] of this.reservations) spots.push({ project, pos: reservation.pos });
    return spots;
  }

  /**
   * A base fits here: inside the land, a road apart from the square and every other base (but
   * `ignore`'s own). isBounded: false lets it go below the land, which then grows.
   */
  isSpotFree(spot, ignore = null, isBounded = true) {
    if (!Number.isFinite(spot?.x) || !Number.isFinite(spot?.y)) return false;
    if (spot.x < MAP_X0 || spot.x + PLOT_W > LAND_X1 || spot.y < MAP_Y0) return false;
    if (isBounded && spot.y + PLOT_H + ROAD > this.landBottom) return false;
    if (isOverlappingSquare(spot, this.square)) return false;
    return this.occupiedSpots().every(({ project, pos }) => project === ignore || !isOverlapping(spot, pos));
  }

  clampSpot(spot) {
    const maxY = Math.max(MAP_Y0, this.landBottom - ROAD - PLOT_H);
    return {
      x: Math.min(LAND_X1 - PLOT_W, Math.max(MAP_X0, roundToEven(spot.x))),
      y: Math.min(maxY, Math.max(MAP_Y0, roundToEven(spot.y))),
    };
  }

  // Lines a spot up with its neighbours (side by side, or one under the other) when it is close,
  // the square on open land included.
  snapSpot(spot, ignore = null) {
    const xs = [MAP_X0, LAND_X1 - PLOT_W];
    const ys = [MAP_Y0];
    for (const { project, pos } of this.occupiedSpots()) {
      if (project === ignore) continue;
      xs.push(pos.x, pos.x - PLOT_W - ROAD, pos.x + PLOT_W + ROAD);
      ys.push(pos.y, pos.y - PLOT_H - ROAD, pos.y + PLOT_H + ROAD);
    }
    if (!this.isSquareHome) {
      const sq = this.square;
      xs.push(sq.x, sq.x - PLOT_W - ROAD, sq.x + SQUARE_W + ROAD);
      ys.push(sq.y, sq.y + SQUARE_H - PLOT_H, sq.y - PLOT_H - ROAD, sq.y + SQUARE_H + ROAD);
    }
    return this.clampSpot({ x: snapTo(spot.x, xs), y: snapTo(spot.y, ys) });
  }

  // Places worth trying: the default columns and rows, and every place beside an existing base.
  candidateSpots(ignore = null) {
    const xs = new Set([MAP_X0, LAND_X1 - PLOT_W]);
    const ys = new Set();
    for (let col = 0; col < LAND_COLS; col++) xs.add(MAP_X0 + col * (PLOT_W + ROAD));
    for (let y = MAP_Y0; y + PLOT_H + ROAD <= this.landBottom; y += PLOT_H + ROAD) ys.add(y);
    for (const { project, pos } of this.occupiedSpots()) {
      if (project === ignore) continue;
      for (const step of [-1, 0, 1]) {
        xs.add(pos.x + step * (PLOT_W + ROAD));
        ys.add(pos.y + step * (PLOT_H + ROAD));
      }
    }
    const spots = [];
    for (const y of ys) for (const x of xs) spots.push({ x, y });
    return spots;
  }

  /**
   * Free land for a base: `near` itself if it fits, else the free spot closest to it; with no
   * `near`, the first one in reading order. With the land full, a new row below.
   */
  findFreeSpot(near = null, ignore = null) {
    const wanted = near && this.clampSpot(near);
    if (wanted && this.isSpotFree(wanted, ignore)) return wanted;
    const order = (spot) => (near ? Math.hypot(spot.x - near.x, spot.y - near.y) : spot.y * 10000 + spot.x);
    const free = this.candidateSpots(ignore).filter((spot) => this.isSpotFree(spot, ignore));
    free.sort((a, b) => order(a) - order(b));
    if (free.length > 0) return free[0];
    const bottoms = this.occupiedSpots().filter(({ project }) => project !== ignore).map(({ pos }) => pos.y + PLOT_H);
    if (!this.isSquareHome) bottoms.push(this.square.y + SQUARE_H);
    return { x: MAP_X0, y: Math.max(MAP_Y0 - ROAD, ...bottoms) + ROAD };
  }

  /** Where a base founded by clicking at this world point would stand (its town center under the pointer). */
  spotForPoint(x, y) {
    const near = { x: x - PLOT_W / 2, y: y - (TOWN_CENTER.y + TOWN_CENTER.h / 2) };
    const snapped = this.snapSpot(near);
    return this.isSpotFree(snapped) ? snapped : this.findFreeSpot(near);
  }

  /** Free land right beside a base (right, left, below, above): to found a related repository next to it. */
  spotBeside(project) {
    const base = this.bases.get(project);
    if (!base) return this.findFreeSpot();
    const { x, y } = base.pos;
    const around = [
      { x: x + PLOT_W + ROAD, y },
      { x: x - PLOT_W - ROAD, y },
      { x, y: y + PLOT_H + ROAD },
      { x, y: y - PLOT_H - ROAD },
    ];
    return around.find((spot) => this.isSpotFree(spot, null, false)) ?? this.findFreeSpot(base.pos);
  }

  // Press on a town center and drag: move the base. Press on the square's market and drag: move the
  // square. Press on the ground and drag: pick villagers.
  startDrag(event) {
    if (this.placing) return;
    const stage = this.canvas.parentElement.parentElement;
    if (event.button === 1 || (event.button === 0 && this.isPanKeyDown)) {
      this.drag = { kind: 'pan', x: event.clientX, y: event.clientY, left: stage.scrollLeft, top: stage.scrollTop, isDragging: false };
      return;
    }
    if (event.button !== 0) return;
    const hit = this.hitAt(event);
    if (hit?.id) return;
    const kind = hit?.square ? 'square' : hit?.project ? 'base' : 'box';
    const base = hit?.project ? this.bases.get(hit.project) : null;
    const origin = hit?.square ? this.square : base?.pos;
    const world = this.worldAt(event);
    const grab = origin ? { x: world.x - origin.x, y: world.y - origin.y } : null;
    this.drag = { kind, project: hit?.project, x: event.clientX, y: event.clientY, toX: event.clientX, toY: event.clientY, isDragging: false, target: null, isAdditive: event.shiftKey, grab };
  }

  moveDrag(event) {
    const drag = this.drag;
    if (!drag) return;
    if (!drag.isDragging && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < DRAG_THRESHOLD_PX) return;
    drag.isDragging = true;
    drag.toX = event.clientX;
    drag.toY = event.clientY;
    if (drag.kind === 'pan') {
      if (this.is3d) {
        this.world3d.panBy(-(event.clientX - (drag.lastX ?? drag.x)), -(event.clientY - (drag.lastY ?? drag.y)));
        drag.lastX = event.clientX;
        drag.lastY = event.clientY;
      } else {
        const stage = this.canvas.parentElement.parentElement;
        stage.scrollLeft = drag.left - (event.clientX - drag.x);
        stage.scrollTop = drag.top - (event.clientY - drag.y);
      }
      this.viewCanvas.style.cursor = 'grabbing';
      return;
    }
    if (drag.kind === 'box' && this.is3d) this.showSelectBox(this.dragBox(drag));
    if (drag.kind === 'base' || drag.kind === 'square') {
      drag.target = this.dropTarget(drag, event);
      this.viewCanvas.style.cursor = drag.target.isValid === false ? 'not-allowed' : 'grabbing';
    }
    this.landHover = null;
    this.onHover(null);
  }

  // Over another base: trade places. Elsewhere: that spot, lined up with the neighbours when close.
  dropTarget(drag, event) {
    const world = this.worldAt(event);
    if (drag.kind === 'square') {
      const pos = this.snapSquare({ x: world.x - drag.grab.x, y: world.y - drag.grab.y });
      return { pos, isValid: this.isSquareFree(pos) };
    }
    const other = this.baseAt(world.x, world.y);
    if (other && other.project !== drag.project) return { swap: other.project };
    const pos = this.snapSpot({ x: world.x - drag.grab.x, y: world.y - drag.grab.y }, drag.project);
    return { pos, isValid: this.isSpotFree(pos, drag.project) };
  }

  endDrag() {
    const drag = this.drag;
    this.drag = null;
    if (!drag?.isDragging) return;
    // The click that follows this mouseup is the drop, not a click on what is under it.
    this.suppressClickUntil = performance.now() + 250;
    this.viewCanvas.style.cursor = this.isPanKeyDown ? 'grab' : 'default';
    if (this.selectBoxEl) this.showSelectBox(null);
    if (drag.kind === 'pan') return;
    if (drag.kind === 'square') {
      if (drag.target?.isValid) this.moveSquare(drag.target.pos);
      return;
    }
    if (drag.kind === 'base') {
      if (drag.target?.swap) this.swapBases(drag.project, drag.target.swap);
      else if (drag.target?.isValid) this.moveBase(drag.project, drag.target.pos);
      return;
    }
    const box = this.dragBox(drag);
    const isInBox = (ch) => {
      const p = this.project(ch.x, ch.y);
      return p.x >= box.x && p.x <= box.x + box.w && p.y - 8 >= box.y && p.y - 8 <= box.y + box.h;
    };
    const inside = [...this.chars.values()].filter((ch) => !ch.isObserver && ch.goal?.type !== 'exit' && isInBox(ch)).map((ch) => ch.id);
    this.setSelection(drag.isAdditive ? [...this.selected, ...inside] : inside);
  }

  // The 2D map draws the selection box on its canvas; over the 3D scene it is a div.
  showSelectBox(box) {
    if (!this.selectBoxEl) {
      this.selectBoxEl = document.createElement('div');
      this.selectBoxEl.className = 'select-box';
      this.overlay.append(this.selectBoxEl);
    }
    this.selectBoxEl.hidden = !box;
    if (!box) return;
    Object.assign(this.selectBoxEl.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` });
  }

  // The selection box in world pixels.
  dragBox(drag) {
    const box = this.viewCanvas.getBoundingClientRect();
    const x0 = (Math.min(drag.x, drag.toX) - box.left) / this.scale;
    const y0 = (Math.min(drag.y, drag.toY) - box.top) / this.scale;
    return { x: x0, y: y0, w: Math.abs(drag.toX - drag.x) / this.scale, h: Math.abs(drag.toY - drag.y) / this.scale };
  }

  /**
   * A deployed agent is on its way. Its repository already has a base: a villager is "in training"
   * at that town center. Otherwise the clicked land (or the first free spot) is staked for the new
   * base. hint: what the user sees until the agent arrives (depends on where it runs).
   */
  reserveLand(spot, project, hint) {
    const now = performance.now();
    if (this.hidden.has(project)) this.setHidden(project, false); // deploying there means you want to see it
    if (this.bases.has(project)) {
      this.training.set(project, { hint, since: now, until: now + RESERVATION_MS });
      return;
    }
    this.reservations.delete(project);
    const pos = this.isSpotFree(spot, project, false) ? spot : this.findFreeSpot(spot, project);
    this.reservations.set(project, { pos, hint, until: now + RESERVATION_MS });
    this.refreshLayout();
  }

  dropExpiredReservations(now) {
    let isChanged = false;
    for (const [project, reservation] of this.reservations) {
      if (reservation.until < now) {
        this.reservations.delete(project);
        isChanged = true;
      }
    }
    for (const [project, training] of this.training) if (training.until < now) this.training.delete(project);
    if (isChanged) this.refreshLayout();
  }

  claimSpot(ch, node) {
    const base = this.bases.get(ch.project);
    this.releaseSpot(ch);
    let owners = base.spots.get(node);
    if (!owners) base.spots.set(node, (owners = []));
    let index = 0;
    while (owners[index]) index++;
    owners[index] = ch.id;
    ch.spot = { node, index };
    const spots = NODES[node].spots;
    const [sx, sy] = spots[index % spots.length];
    const nudge = Math.floor(index / spots.length) * 3; // a crowded site packs units a bit tighter
    const { x, y } = base.pos;
    return { x: x + sx + nudge, y: y + sy + nudge };
  }

  releaseSpot(ch) {
    if (!ch.spot) return;
    const owners = this.bases.get(ch.project)?.spots.get(ch.spot.node);
    if (owners?.[ch.spot.index] === ch.id) owners[ch.spot.index] = null;
    ch.spot = null;
  }

  syncBots(ch, now) {
    const seen = new Set();
    for (const sub of ch.agent.subagents) {
      seen.add(sub.id);
      let bot = this.bots.get(sub.id);
      if (!bot) {
        bot = { id: sub.id, parentId: ch.id, slot: this.freeBotSlot(ch.id), goneAt: null, seed: S.hashString(sub.id) % 997 };
        this.bots.set(sub.id, bot);
      }
      bot.sub = sub;
      bot.goneAt = null;
    }
    for (const bot of this.bots.values()) {
      if (bot.parentId === ch.id && !seen.has(bot.id) && bot.goneAt === null) bot.goneAt = now;
    }
  }

  freeBotSlot(parentId) {
    const used = new Set([...this.bots.values()].filter((b) => b.parentId === parentId && b.goneAt === null).map((b) => b.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    return slot;
  }

  setConflicts(ids) {
    this.conflicts = ids;
  }

  highlightAgent(id) {
    this.highlight = { id, until: performance.now() + HIGHLIGHT_MS };
    this.centerOn(id);
  }

  setLinkedAgent(id) {
    this.linkedId = id;
  }

  linkFromScene(id) {
    if (id === this.sceneLinkedId) return;
    this.sceneLinkedId = id;
    this.onLink(id);
  }

  // ---------- Behaviour ----------

  think(ch, now) {
    if (ch.isRecruit) {
      this.thinkRecruit(ch, now);
      return;
    }
    const goalType = ch.goal?.type;
    if (goalType === 'exit' || goalType === 'enter') return;
    if (ch.isObserver) {
      this.patrol(ch, now);
      return;
    }
    if (wantsBase(ch.agent)) {
      ch.idleSince = null;
      const node = nodeFor(ch.agent);
      if (goalType === 'node' && ch.goal.node === node) return; // there, or on the way
      if (ch.mode === 'working' && now - ch.nodeSince < NODE_DWELL_MS) return;
      this.sendToNode(ch, node, now);
      return;
    }
    if (ch.mode === 'working') {
      ch.idleSince ??= now;
      if (now - ch.idleSince > IDLE_LEAVE_MS) this.sendToSquare(ch, now);
      return;
    }
    if (ch.mode === 'free' || (ch.mode === 'poi' && now > ch.poiUntil)) this.sendToSquare(ch, now);
  }

  // Rides between the bases, stopping beside working villagers; with nobody working it waits in the square.
  patrol(ch, now) {
    if (ch.mode === 'walking' || (ch.mode === 'inspecting' && now < ch.inspectUntil) || (ch.mode === 'poi' && now < ch.poiUntil)) return;
    const workers = [...this.chars.values()].filter((o) => !o.isObserver && o.mode === 'working' && o.goal?.type !== 'exit');
    const candidates = workers.length > 1 ? workers.filter((o) => o.id !== ch.inspectId) : workers;
    if (candidates.length === 0) {
      this.sendToSquare(ch, now);
      return;
    }
    const target = candidates[Math.floor(Math.random() * candidates.length)];
    const base = this.bases.get(target.project);
    if (!base) return;
    const { x: ox, y: oy } = base.pos;
    const isLeft = Math.random() < 0.5;
    const x = Math.min(ox + PLOT_W - 10, Math.max(ox + 10, target.x + (isLeft ? -13 : 13)));
    const y = Math.min(oy + PLOT_H - 4, target.y + 2);
    this.releasePoi(ch);
    this.walk(ch, { type: 'inspect', targetId: target.id, isLeft }, this.route(ch, { x, y }), now);
  }

  sendToNode(ch, node, now) {
    this.releasePoi(ch);
    const target = this.claimSpot(ch, node);
    this.walk(ch, { type: 'node', node }, this.route(ch, target), now);
  }

  sendToSquare(ch, now) {
    const previous = ch.poi;
    const poi = this.reservePoi(ch, previous);
    if (!poi) {
      ch.poiUntil = now + 5000; // square full: stay put and retry later
      if (ch.mode === 'free') ch.mode = 'poi';
      return;
    }
    if (previous && this.poiOwners.get(previous.id) === ch.id) this.poiOwners.delete(previous.id);
    this.releaseSpot(ch);
    this.walk(ch, { type: 'poi', poi }, this.route(ch, poi), now);
  }

  sendToExit(ch, now) {
    this.releasePoi(ch);
    this.releaseSpot(ch);
    for (const bot of this.bots.values()) if (bot.parentId === ch.id && bot.goneAt === null) bot.goneAt = now;
    if (ch.isObserver) {
      const out = { x: MAIN_X, y: this.worldH + 10 };
      this.walk(ch, { type: 'exit' }, [...this.route(ch, { x: MAIN_X, y: this.landBottom - ROAD / 2 }), out], now);
      return;
    }
    // Back into the town center it came from.
    const { x, y } = this.bases.get(ch.project).pos;
    const door = { x: x + DOOR.x, y: y + DOOR.y };
    this.walk(ch, { type: 'exit' }, [...this.route(ch, { x: door.x, y: door.y + 5 }), door], now);
  }

  cancelExit(ch) {
    ch.goal = null;
    ch.path = [];
    ch.mode = 'free';
  }

  walk(ch, goal, path, now) {
    ch.goal = goal;
    ch.path = path;
    ch.mode = 'walking';
    ch.node = null;
    if (path.length === 0) this.arrive(ch, now);
  }

  reservePoi(ch, exclude = null) {
    const free = this.pois.filter((poi) => poi !== exclude && !this.poiOwners.has(poi.id));
    if (free.length === 0) return null;
    const poi = free[Math.floor(Math.random() * free.length)];
    this.poiOwners.set(poi.id, ch.id);
    ch.poi = poi;
    return poi;
  }

  releasePoi(ch) {
    if (ch.poi && this.poiOwners.get(ch.poi.id) === ch.id) this.poiOwners.delete(ch.poi.id);
    ch.poi = null;
  }

  arrive(ch, now) {
    const goal = ch.goal;
    if (goal?.type === 'node') {
      ch.mode = 'working';
      ch.node = goal.node;
      ch.nodeSince = now;
      ch.dir = NODES[goal.node].dir;
    } else if (goal?.type === 'poi') {
      ch.mode = 'poi';
      ch.dir = goal.poi.dir;
      ch.facing = goal.poi.dir === 'w' ? 'w' : 'e';
      ch.poiUntil = now + randomBetween(goal.poi.dwell) * 1000;
    } else if (goal?.type === 'inspect') {
      ch.mode = 'inspecting';
      ch.facing = goal.isLeft ? 'e' : 'w'; // facing the villager it inspects
      ch.inspectId = goal.targetId;
      ch.inspectUntil = now + randomBetween(INSPECT_SECONDS) * 1000;
    } else if (goal?.type === 'enter' || goal?.type === 'rally') {
      ch.goal = null;
      ch.mode = 'free';
    } else if (goal?.type === 'garrison' || goal?.type === 'leave') {
      this.removeRecruit(ch); // into the town center (its session is starting there), or off the map
    } else if (goal?.type === 'exit') {
      this.removeChar(ch);
    }
  }

  // A base with nobody left is abandoned (unless pinned): its land goes back to the wild.
  removeChar(ch) {
    this.chars.delete(ch.id);
    for (const [id, bot] of this.bots) if (bot.parentId === ch.id) this.bots.delete(id);
    if (ch.isObserver || this.pinned.has(ch.project)) return;
    const isEmpty = ![...this.chars.values()].some((other) => other.project === ch.project && !other.isObserver);
    if (!isEmpty) return;
    this.removeBase(ch.project);
    this.refreshLayout();
  }

  // Across the yard and out the gate, then by the roads (the path search), then in through the
  // other base's gate, so nobody walks through buildings. The square is open ground: the path
  // search walks into it and out of it.
  route(ch, to) {
    const points = [];
    let x = ch.x;
    let y = ch.y;
    const push = (nx, ny) => {
      if (Math.abs(nx - x) > 0.5 || Math.abs(ny - y) > 0.5) points.push({ x: nx, y: ny });
      x = nx;
      y = ny;
    };
    const from = this.baseAt(x, y);
    const dest = this.baseAt(to.x, to.y);
    if (from) {
      const o = from.pos;
      push(x, o.y + YARD_Y);
      if (dest === from) {
        push(to.x, o.y + YARD_Y);
        push(to.x, to.y);
        return points;
      }
      const exit = gateExit(o);
      push(exit.x, o.y + YARD_Y);
      push(exit.x, exit.y);
    }
    let goal = to;
    let tail = [];
    if (dest) {
      goal = gateExit(dest.pos);
      tail = [[goal.x, dest.pos.y + YARD_Y], [to.x, dest.pos.y + YARD_Y], [to.x, to.y]];
    }
    for (const corner of this.findPath({ x, y }, goal)) push(corner.x, corner.y);
    push(goal.x, goal.y);
    for (const [tx, ty] of tail) push(tx, ty);
    return points;
  }

  step(ch, dt, now) {
    if (ch.path.length === 0) return;
    let budget = (ch.isObserver ? SCOUT_SPEED : WALK_SPEED) * dt;
    while (budget > 0 && ch.path.length > 0) {
      const target = ch.path[0];
      const dx = target.x - ch.x;
      const dy = target.y - ch.y;
      const dist = Math.hypot(dx, dy);
      const seen = projectStep(this.proj, dx, dy); // the way it walks on screen
      if (dist > 0.01) ch.dir = Math.abs(seen.x) > Math.abs(seen.y) ? (seen.x > 0 ? 'e' : 'w') : seen.y > 0 ? 's' : 'n';
      if (Math.abs(seen.x) > 0.01) ch.facing = seen.x > 0 ? 'e' : 'w';
      if (dist <= budget) {
        ch.x = target.x;
        ch.y = target.y;
        budget -= dist;
        ch.path.shift();
      } else {
        ch.x += (dx / dist) * budget;
        ch.y += (dy / dist) * budget;
        budget = 0;
      }
    }
    ch.walkClock += dt;
    ch.frame = Math.floor(ch.walkClock / (ch.isObserver ? 0.1 : 0.14)) % 4;
    if (ch.path.length === 0) this.arrive(ch, now);
  }

  // ---------- Frame ----------

  loop(now) {
    requestAnimationFrame((next) => this.loop(next));
    if (now - this.lastFrameAt < FRAME_MS) return;
    const dt = Math.min(MAX_FRAME_DT, (now - this.lastFrameAt) / 1000);
    this.lastFrameAt = now;
    this.applyPanKeys(dt);
    for (const ch of [...this.chars.values()]) {
      if (now < ch.hiddenUntil) continue;
      this.think(ch, now);
      this.step(ch, dt, now);
    }
    for (const [id, bot] of this.bots) if (bot.goneAt !== null && now - bot.goneAt > BOT_EXIT_MS) this.bots.delete(id);
    if (this.is3d) this.world3d.render(now, S.skyFor(mapClock().hour));
    else this.render(now);
    this.updateLabels(now);
    this.drawMinimap(now);
  }

  render(now) {
    const ctx = this.ctx;
    const t = now / 1000;
    const sky = S.skyFor(mapClock().hour);

    const { a, b, c, d, e, f, width, height } = this.proj;
    // The ground and what lies flat on it (territories, foundations, mist) go through the
    // projection; everything upright is drawn after, standing on its projected foot.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.setTransform(a, b, c, d, e, f);
    ctx.imageSmoothingEnabled = this.isIso; // a softer, Ragnarok-like ground; crisp from above
    ctx.drawImage(this.staticLayer, 0, 0);
    ctx.imageSmoothingEnabled = false;
    const drawables = [];
    const lights = [];
    this.hitBoxes = [];
    this.collectLand(ctx, t);
    this.collectBases(drawables, lights, t, now, sky);
    this.drawDragGhost(ctx, t);
    this.drawFogMist(ctx);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.collectSquare(drawables, lights, t);
    this.collectUnits(drawables, t, now);
    this.collectBots(drawables, t, now);
    if (this.isIso) for (const prop of this.props) drawables.push({ x: prop.x, y: prop.y, draw: () => this.drawProp(ctx, prop) });
    for (const item of drawables) item.depth = this.project(item.x, item.y).y + (item.dz ?? 0);
    drawables.sort((p, q) => p.depth - q.depth).forEach((item) => this.billboard(item.x, item.y, item.draw));

    if (sky.darkness > 0.02) {
      S.rect(ctx, 0, 0, width, height, `rgba(12, 16, 44, ${sky.darkness.toFixed(3)})`);
      for (const drawLight of lights) drawLight(sky.darkness);
    }
    this.drawOverlays(t, now);
    if (this.drag?.isDragging && this.drag.kind === 'box') {
      const { x, y, w, h } = this.dragBox(this.drag);
      S.drawSelectionBox(ctx, Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    }
  }

  // Free land is clickable to found a base (the pointer shows where it would stand); land staked
  // for a deploy shows the foundation.
  collectLand(ctx, t) {
    for (const [project, reservation] of this.reservations) {
      const { x, y } = reservation.pos;
      S.drawTerritory(ctx, x, y, PLOT_W, PLOT_H, S.teamColor(project), null, t);
      S.drawFoundation(ctx, x + TOWN_CENTER.x, y + TOWN_CENTER.y + 8, TOWN_CENTER.w, TOWN_CENTER.h - 8, S.teamColor(project), t);
    }
    if (this.placing?.spot) {
      const { project } = this.placing;
      const { x, y } = this.placing.spot;
      const team = [S.teamColor(project), S.teamShade(project)];
      S.drawPlotGlow(ctx, x, y, PLOT_W, PLOT_H, team[0], t);
      S.drawTerritory(ctx, x, y, PLOT_W, PLOT_H, team[0], null, t);
      ctx.save();
      ctx.globalAlpha = 0.6;
      this.billboard(x + DOOR.x, y + TOWN_CENTER.y + TOWN_CENTER.h, () => S.drawTownCenter(ctx, x + TOWN_CENTER.x, y + TOWN_CENTER.y, team, false, 1, this.designOf(project), t));
      ctx.restore();
    }
    if (this.landHover && !this.drag?.isDragging) {
      const { x, y } = this.landHover;
      ctx.save();
      ctx.globalAlpha = 0.55;
      S.drawTerritory(ctx, x, y, PLOT_W, PLOT_H, S.C.white, null, t);
      S.drawFoundation(ctx, x + TOWN_CENTER.x, y + TOWN_CENTER.y + 8, TOWN_CENTER.w, TOWN_CENTER.h - 8, S.C.white, t);
      ctx.restore();
    }
    this.hitBoxes.push({ x: MAP_X0, y: MAP_Y0, w: LAND_X1 - MAP_X0, h: this.landBottom - MAP_Y0, z: -Infinity, freeLand: true, isGround: true });
    if (this.fogNames.length > 0) this.hitBoxes.push({ x: MAP_X0, y: this.landBottom, w: LAND_X1 - MAP_X0, h: FOG_H, z: -Infinity, fog: this.fogNames.length, isGround: true });
  }

  // Where the town center being dragged would land, as in AoE: a see-through building on its
  // territory, red where it does not fit. Over another base, the two trade places.
  drawDragGhost(ctx, t) {
    const drag = this.drag;
    if (drag?.isDragging && drag.kind === 'square' && drag.target) {
      const { pos, isValid } = drag.target;
      const color = isValid ? S.C.white : '#ef4444';
      S.drawPlotGlow(ctx, pos.x, pos.y, SQUARE_W, SQUARE_H, color, t);
      S.drawTerritory(ctx, pos.x, pos.y, SQUARE_W, SQUARE_H, color, null, t);
      ctx.save();
      ctx.globalAlpha = 0.6;
      S.drawPlaza(ctx, pos.x + PAVING.x, pos.y + PAVING.y, PAVING.w, PAVING.h);
      ctx.restore();
      return;
    }
    if (!drag?.isDragging || drag.kind !== 'base' || !drag.target) return;
    const base = this.bases.get(drag.project);
    if (!base) return;
    const swapWith = drag.target.swap && this.bases.get(drag.target.swap);
    const pos = swapWith ? swapWith.pos : drag.target.pos;
    if (!pos) return;
    const color = drag.target.isValid === false ? '#ef4444' : base.team[0];
    S.drawPlotGlow(ctx, pos.x, pos.y, PLOT_W, PLOT_H, color, t);
    S.drawTerritory(ctx, pos.x, pos.y, PLOT_W, PLOT_H, color, null, t);
    ctx.save();
    ctx.globalAlpha = 0.6;
    this.billboard(pos.x + DOOR.x, pos.y + TOWN_CENTER.y + TOWN_CENTER.h, () => S.drawTownCenter(ctx, pos.x + TOWN_CENTER.x, pos.y + TOWN_CENTER.y, base.team, false, 1, this.designOf(base.project), t));
    ctx.restore();
  }

  collectBases(drawables, lights, t, now, sky) {
    const ctx = this.ctx;
    const members = new Map();
    for (const ch of this.chars.values()) {
      if (ch.isObserver) continue;
      if (!members.has(ch.project)) members.set(ch.project, []);
      members.get(ch.project).push(ch);
    }
    for (const base of this.bases.values()) {
      const { x: ox, y: oy } = base.pos;
      const crew = members.get(base.project) ?? [];
      const live = crew.filter((ch) => ch.goal?.type !== 'exit');
      const isAlarm = live.some((ch) => isBlocked(ch.agent));
      const isPicked = this.baseHighlight?.project === base.project && now < this.baseHighlight.until;
      const isLinked = isPicked || this.summonTarget === base.project || live.some((ch) => ch.id === this.linkedId);
      const atWork = new Set(live.filter((ch) => ch.mode === 'working' && ch.agent.status === 'busy').map((ch) => ch.node));
      const rise = Math.min(1, Math.max(0, (now - base.foundedAt) / FOUNDING_MS));
      const training = this.training.get(base.project);
      const design = this.designOf(base.project);
      const tcX = ox + TOWN_CENTER.x;
      const tcY = oy + TOWN_CENTER.y;

      S.drawTerritory(ctx, ox, oy, PLOT_W, PLOT_H, base.team[0], isAlarm ? kindInfo('asking').color : null, t);
      if (isLinked) S.drawPlotGlow(ctx, ox, oy, PLOT_W, PLOT_H, LINK_COLOR, t);
      drawables.push({ x: ox + 18, y: oy + 30, draw: () => S.drawMine(ctx, ox + 4, oy + 10, t, atWork.has('mine')) });
      drawables.push({ x: ox + 110, y: oy + 32, draw: () => S.drawForge(ctx, ox + 96, oy + 8, t, atWork.has('forge')) });
      drawables.push({ x: ox + BANNER.x, y: oy + BANNER.y, draw: () => S.drawBanner(ctx, ox + BANNER.x, oy + BANNER.y, base.team, t) });
      const wonders = this.wondersOf(base.project);
      if (wonders.includes('obelisk')) drawables.push({ x: ox + 16, y: oy + 76, draw: () => S.drawObelisk(ctx, ox + 16, oy + 76) });
      if (wonders.includes('beacon')) drawables.push({ x: ox + 120, y: oy + 78, draw: () => S.drawBeacon(ctx, ox + 120, oy + 78, t) });
      const ageUp = this.celebrations.get(base.project);
      if (ageUp !== undefined && now - ageUp < AGE_UP_MS) {
        drawables.push({ x: ox + DOOR.x, y: oy + TOWN_CENTER.y + TOWN_CENTER.h, dz: 1000, draw: () => S.drawAgeUp(ctx, ox + DOOR.x, oy + TOWN_CENTER.y + TOWN_CENTER.h, t, (now - ageUp) / AGE_UP_MS) });
      } else if (ageUp !== undefined) {
        this.celebrations.delete(base.project);
      }
      // The town bell goes up only while an agent of this base is blocked on you.
      if (isAlarm && rise === 1) drawables.push({ x: ox + BELL.x, y: oy + BELL.y, draw: () => S.drawBell(ctx, ox + BELL.x, oy + BELL.y, t, true) });
      drawables.push({
        x: ox + DOOR.x,
        y: oy + TOWN_CENTER.y + TOWN_CENTER.h,
        draw: () => {
          S.drawTownCenter(ctx, tcX, tcY, base.team, sky.isNight, rise, design, t);
          if (rise < 1) return;
          if (training) S.drawTrainingBar(ctx, ox + DOOR.x, oy + 2, Math.min(0.95, (now - training.since) / TRAINING_EXPECTED_MS));
        },
      });
      // Lights shine where their sprite stands: shifted with its foot, like the sprite.
      const shine = (footX, footY, x, y, radius, color, strength) => {
        const p = this.project(footX, footY);
        S.drawGlow(ctx, x + Math.round(p.x - footX), y + Math.round(p.y - footY), radius, color, strength);
      };
      const tcFoot = [ox + DOOR.x, oy + TOWN_CENTER.y + TOWN_CENTER.h];
      lights.push((darkness) => {
        for (const light of S.townCenterLights(design)) shine(...tcFoot, tcX + light.x, tcY + light.y, light.r, light.color, darkness * 1.2);
        shine(ox + 110, oy + 32, ox + 105, oy + 26, 16, '#f97316', darkness * (atWork.has('forge') ? 1.6 : 0.9));
        if (wonders.includes('beacon')) shine(ox + 120, oy + 78, ox + 120, oy + 50, 22, '#f97316', darkness * 1.6);
      });
      const reach = S.TOWN_REACH_SIDE;
      this.pushSpriteHit({ x: tcX - reach, y: tcY - 8, w: TOWN_CENTER.w + 2 * reach, h: TOWN_CENTER.h + 8, z: tcFoot[1], project: base.project }, ...tcFoot);
      this.pushSpriteHit({ x: ox + BANNER.x - 1, y: oy + BANNER.y - 29, w: 10, h: 30, z: oy + BANNER.y, project: base.project }, ox + BANNER.x, oy + BANNER.y);
    }
  }

  // The well, the market and the paving between them are where you grab the square to move it.
  collectSquare(drawables, lights, t) {
    const ctx = this.ctx;
    const sq = this.square;
    const fire = { x: sq.x + CAMPFIRE.x, y: sq.y + CAMPFIRE.y };
    drawables.push({ x: sq.x + 27, y: sq.y + 41, draw: () => S.drawWell(ctx, sq.x + 18, sq.y + 22, t) });
    drawables.push({ x: sq.x + 85, y: sq.y + 41, draw: () => S.drawMarket(ctx, sq.x + 66, sq.y + 14, t) });
    for (const poi of this.pois.filter((p) => p.id.startsWith('log'))) {
      drawables.push({ x: poi.x, y: poi.y + 1, draw: () => S.drawLogSeat(ctx, poi.x, poi.y + 3) });
    }
    drawables.push({ x: fire.x, y: fire.y, draw: () => S.drawCampfire(ctx, fire.x, fire.y, t) });
    drawables.push({ x: sq.x + 30, y: sq.y + 166, draw: () => S.drawHayCart(ctx, sq.x + 14, sq.y + 150) });
    lights.push((darkness) => this.glow(fire.x, fire.y - 5, 26, '#f97316', darkness * 1.8));
    this.hitBoxes.push({ x: sq.x + PAVING.x, y: sq.y + PAVING.y, w: PAVING.w, h: PAVING.h, z: -1e9, square: true, isGround: true });
    this.pushSpriteHit({ x: sq.x + 18, y: sq.y + 20, w: 18, h: 21, z: sq.y + 41, square: true }, sq.x + 27, sq.y + 41);
    this.pushSpriteHit({ x: sq.x + 66, y: sq.y + 14, w: 40, h: 27, z: sq.y + 41, square: true }, sq.x + 85, sq.y + 41);
  }

  collectUnits(drawables, t, now) {
    const ctx = this.ctx;
    for (const ch of this.chars.values()) {
      if (now < ch.hiddenUntil) continue;
      const isWalking = ch.path.length > 0;
      if (ch.isObserver) {
        drawables.push({
          x: ch.x,
          y: ch.y,
          draw: () => {
            S.drawShadow(ctx, ch.x, ch.y, 15);
            S.drawScout(ctx, ch.look, ch.x, ch.y, ch.facing, isWalking, ch.frame, t);
          },
        });
        this.pushSpriteHit({ x: ch.x - 8, y: ch.y - 23, w: 16, h: 24, z: ch.y, id: ch.id }, ch.x, ch.y);
        continue;
      }
      const { agent } = ch;
      const isBusy = agent.status === 'busy';
      const isSitting = !isWalking && ch.mode === 'poi' && ch.poi?.pose === 'sit';
      const isWorking = !isWalking && ch.mode === 'working' && isBusy && ch.node !== 'tc' && ch.node !== 'wait';
      const node = ch.node && NODES[ch.node];
      const pose = isWalking ? 'walk' : isSitting ? 'sit' : isWorking && ch.node !== 'tower' ? 'work' : 'stand';
      const isScroll = !isWalking && ch.node === 'tc' && isBusy && ['writing', 'planning'].includes(agent.activity.kind);
      const tool = isWorking ? node.tool : isScroll ? 'scroll' : null;
      const swing = Math.floor(t * (ch.node === 'forge' ? 4 : 3) + (ch.look.seed % 5) / 5) % 2;
      const frame = isWalking ? ch.frame : swing;
      const isWaiting = ch.goal?.type !== 'exit' && needsUser(agent);
      const wave = isWaiting && !isWalking && ch.dir !== 'n' ? waveFrame(t, ch.look.seed, isBlocked(agent)) : -1;
      const isLinked = ch.id === this.linkedId;
      const isPicked = this.selected.has(ch.id);
      const z = isSitting ? ch.y + 6 : ch.y;
      drawables.push({
        x: ch.x,
        y: ch.y,
        dz: z - ch.y,
        draw: () => {
          if (isPicked) S.drawSelectionRing(ctx, ch.x, ch.y);
          if (isLinked) S.drawStatusRing(ctx, ch.x, ch.y, LINK_COLOR, t);
          else if (isWaiting) S.drawStatusRing(ctx, ch.x, ch.y, kindInfo(isBlocked(agent) ? 'asking' : 'yourturn').color, t);
          else if (!isSitting) S.drawShadow(ctx, ch.x, ch.y);
          S.drawVillager(ctx, ch.look, ch.x, ch.y, isSitting ? 's' : ch.dir, pose, frame, t, tool, wave);
          if (pose === 'work' && swing === 1 && node.impact) {
            const [ix, iy] = IMPACT_AT[ch.dir] ?? IMPACT_AT.n;
            S.drawImpact(ctx, ch.x + ix, ch.y + iy, node.impact, t, ch.look.seed);
          }
        },
      });
      this.pushSpriteHit({ x: ch.x - 6, y: ch.y - (isSitting ? 15 : 19), w: 12, h: isSitting ? 16 : 20, z, id: ch.id }, ch.x, ch.y);
    }
  }

  collectBots(drawables, t, now) {
    const ctx = this.ctx;
    for (const bot of this.bots.values()) {
      const parent = this.chars.get(bot.parentId);
      if (!parent || parent.isObserver || now < parent.hiddenUntil) continue;
      const exitProgress = bot.goneAt === null ? 0 : (now - bot.goneAt) / BOT_EXIT_MS;
      if (exitProgress > 0 && Math.floor(now / 90) % 2) continue; // flicker out
      const [sx, sy] = ESCORT_SLOTS[bot.slot % ESCORT_SLOTS.length];
      const spread = Math.floor(bot.slot / ESCORT_SLOTS.length) * 4;
      const gx = parent.x + sx + Math.sign(sx) * spread;
      const gy = parent.y + sy + spread;
      const kind = bot.goneAt === null ? bot.sub.activity.kind : 'done';
      drawables.push({ x: gx, y: gy, draw: () => S.drawSoldier(ctx, parent.look, gx, gy, kind, t, bot.seed, Math.round(exitProgress * 12)) });
      this.pushSpriteHit({ x: gx - 5, y: gy - 16, w: 10, h: 17, z: gy + 0.5, id: parent.id, botId: bot.id }, gx, gy);
    }
  }

  drawOverlays(t, now) {
    const ctx = this.ctx;
    // Bubbles and arrows ride over each villager where it stands on screen.
    const at = (ch) => {
      const p = this.project(ch.x, ch.y);
      return { x: Math.round(p.x), y: Math.round(p.y) };
    };
    for (const ch of this.chars.values()) {
      if (ch.goal?.type === 'exit' || now < ch.hiddenUntil) continue;
      const p = at(ch);
      if (ch.isObserver) {
        const target = ch.mode === 'inspecting' && this.chars.get(ch.inspectId);
        if (target) S.drawScan(ctx, p.x + (ch.facing === 'e' ? 2 : -2), p.y - 19, at(target).x, at(target).y - 9, t);
        continue;
      }
      if (ch.isRecruit) continue; // nothing to do yet, so no bubble
      const isSitting = ch.mode === 'poi' && ch.poi?.pose === 'sit' && ch.path.length === 0;
      const headY = p.y - (isSitting ? 15 : 18);
      if (this.conflicts.has(ch.id)) S.drawEmote(ctx, p.x - 6, headY, 'conflict', t);
      S.drawEmote(ctx, p.x + 6, headY, ch.agent.status === 'busy' ? ch.agent.activity.kind : 'yourturn', t);
    }
    const isHighlightOn = this.highlight && now <= this.highlight.until;
    for (const id of new Set([this.linkedId, isHighlightOn ? this.highlight.id : null])) {
      const ch = this.chars.get(id);
      if (ch && now >= ch.hiddenUntil) S.drawHighlightArrow(ctx, at(ch).x, at(ch).y - 33, t);
    }
  }

  // ---------- Labels (DOM, for crisp text over the pixel art) ----------

  updateLabels(now) {
    const active = new Set();
    this.dropExpiredReservations(now);
    for (const base of this.bases.values()) {
      const crew = [...this.chars.values()].filter((ch) => ch.project === base.project && !ch.isObserver && ch.goal?.type !== 'exit');
      const agents = crew.map((ch) => ch.agent);
      const training = this.training.get(base.project);
      const detail = training ? `Novo aldeão · ${training.hint}` : baseSummary(agents) || 'Nenhum aldeão agora';
      const kind = agents.some(isBlocked) ? 'asking' : agents.some((a) => a.status !== 'busy') ? 'yourturn' : agents.length ? 'busy' : 'empty';
      const key = `base:${base.project}`;
      active.add(key);
      this.placeBaseLabel(key, base.pos, this.displayName(base.project), detail, kind, base.team[0]);
      const spend = this.spend.get(base.project);
      if (spend?.tokens > 0) {
        active.add(`spend:${base.project}`);
        this.placeSpendBalloon(`spend:${base.project}`, base, spend);
      }
    }
    for (const [project, reservation] of this.reservations) {
      const key = `reserved:${project}`;
      active.add(key);
      this.placeBaseLabel(key, reservation.pos, `Nova base · ${project}`, reservation.hint, 'reserved', S.teamColor(project));
    }
    if (this.fogNames.length > 0) {
      const count = this.fogNames.length;
      const spot = { x: (MAP_X0 + LAND_X1 - PLOT_W) / 2, y: this.landBottom + FOG_H / 2 - 10 - NAMEPLATE_Y };
      active.add('fog');
      this.placeBaseLabel('fog', spot, 'Névoa de guerra', `${count} ${count > 1 ? 'terras inexploradas' : 'terra inexplorada'} · clique para explorar`, 'fog', '#9ca3af');
    }
    const isHighlightOn = this.highlight && now <= this.highlight.until;
    // Full labels only for the villager hovered in the panel or just selected; on the map the tooltip says it.
    const focused = new Set([this.linkedId, this.hovered.id && now < this.hovered.until ? this.hovered.id : null, isHighlightOn ? this.highlight.id : null]);
    for (const ch of this.chars.values()) {
      if (ch.isObserver || ch.goal?.type === 'exit' || now < ch.hiddenUntil) continue;
      const { agent } = ch;
      if (ch.isRecruit) {
        const key = `idle:${ch.id}`;
        active.add(key);
        this.placeIdleTag(key, ch, agent.target ? `→ ${agent.target}` : 'novo');
        continue;
      }
      const isBusy = agent.status === 'busy';
      if (focused.has(ch.id)) {
        const key = `unit:${ch.id}`;
        active.add(key);
        // Busy agents show how long the task has been going; idle ones how long they have waited.
        const activity = isBusy ? `${agent.activity.label} · ${formatElapsed(agent.lastPromptAt)}` : `Sua vez · há ${formatElapsed(agent.activity.since)}`;
        this.placeUnitLabel(key, ch, taskSentence(agent), activity, isBusy ? agent.activity.kind : 'yourturn');
      } else if (!isBusy) {
        // Villagers waiting on you carry a small, quiet "how long idle" tag.
        const key = `idle:${ch.id}`;
        active.add(key);
        this.placeIdleTag(key, ch, formatElapsed(agent.activity.since));
      }
    }
    for (const [key, label] of this.labels) {
      if (!active.has(key)) {
        label.remove();
        this.labels.delete(key);
      }
    }
  }

  placeBaseLabel(key, spot, title, detail, kind, color) {
    let label = this.labels.get(key);
    if (!label) {
      label = document.createElement('div');
      label.className = 'base-label';
      label.append(document.createElement('strong'), document.createElement('span'));
      this.overlay.append(label);
      this.labels.set(key, label);
    }
    const content = `${title}|${detail}|${kind}|${color}`;
    if (label.dataset.content !== content) {
      label.dataset.content = content;
      label.dataset.kind = kind;
      label.style.setProperty('--team', color);
      label.querySelector('strong').textContent = breakable(title);
      label.querySelector('span').textContent = detail;
    }
    const pos = `${spot.x},${spot.y}|${this.scale}|${this.viewMode}${this.viewRotation}|${this.is3d ? this.world3d.cameraVersion : 0}`;
    if (label.dataset.pos !== pos) {
      label.dataset.pos = pos;
      const p = this.project(spot.x + PLOT_W / 2, spot.y + NAMEPLATE_Y);
      label.style.left = `${p.x * this.scale}px`;
      label.style.top = `${p.y * this.scale}px`;
      label.style.maxWidth = `${(PLOT_W + ROAD - 8) * this.scale}px`; // the whole plot: neighbors' nameplates never touch
    }
  }

  // Balloon over the town center: the tokens its agents spent in the plan's session window and how
  // much of the session that is. The bar is the whole session: this base's part lit, the rest used dim.
  placeSpendBalloon(key, base, spend) {
    let balloon = this.labels.get(key);
    if (!balloon) {
      balloon = document.createElement('div');
      balloon.className = 'spend-balloon';
      const tokens = document.createElement('span');
      tokens.className = 'spend-tokens';
      tokens.append(resourceIcon('tokens'), document.createElement('strong'));
      const meter = document.createElement('span');
      meter.className = 'spend-meter';
      const bar = document.createElement('span');
      bar.className = 'spend-bar';
      meter.append(bar, document.createElement('b'));
      balloon.append(tokens, meter);
      this.overlay.append(balloon);
      this.labels.set(key, balloon);
    }
    const hasPercent = spend.percent !== null;
    const content = `${spend.tokens}|${hasPercent ? spend.percent.toFixed(1) : ''}|${spend.sessionPercent}|${spend.severity}`;
    if (balloon.dataset.content !== content) {
      const isGrowing = Number(balloon.dataset.tokens) < spend.tokens;
      balloon.dataset.content = content;
      balloon.dataset.tokens = String(spend.tokens);
      balloon.dataset.severity = spend.severity;
      balloon.querySelector('strong').textContent = `${formatResource('tokens', spend.tokens)} tokens`;
      const meter = balloon.querySelector('.spend-meter');
      meter.hidden = !hasPercent;
      if (hasPercent) {
        meter.querySelector('b').textContent = `${formatSessionPercent(spend.percent)} da sessão`;
        meter.style.setProperty('--mine', `${Math.min(100, spend.percent)}%`);
        meter.style.setProperty('--used', `${Math.min(100, spend.sessionPercent)}%`);
      }
      if (isGrowing) {
        balloon.classList.remove('is-growing');
        void balloon.offsetWidth; // restart the pop
        balloon.classList.add('is-growing');
      }
    }
    const p = this.spendBalloonPoint(base);
    balloon.hidden = !p;
    if (!p) return;
    const pos = `${Math.round(p.x * this.scale)}|${Math.round(p.y * this.scale)}`;
    if (balloon.dataset.pos !== pos) {
      balloon.dataset.pos = pos;
      balloon.style.left = `${Math.round(p.x * this.scale)}px`;
      balloon.style.top = `${Math.round(p.y * this.scale)}px`;
    }
  }

  // Just over the town center's roof, on screen: 3D knows the castle's real height, the pixel art
  // stands its era's town center up from the door's foot.
  spendBalloonPoint(base) {
    if (this.is3d) {
      const p = this.world3d.balloonPoint(base.project);
      return p && !p.isBehind ? p : null;
    }
    const p = this.project(base.pos.x + DOOR.x, base.pos.y + TOWN_CENTER.y + TOWN_CENTER.h);
    return { x: p.x, y: p.y - S.townCenterHeight(this.designOf(base.project)) - 3 };
  }

  placeUnitLabel(key, ch, title, detail, kind) {
    let label = this.labels.get(key);
    if (!label) {
      label = document.createElement('div');
      label.className = 'unit-label';
      label.append(document.createElement('strong'), document.createElement('span'), this.createLabelMenuButton(label));
      this.overlay.append(label);
      this.labels.set(key, label);
    }
    label.dataset.agent = ch.id;
    label.classList.toggle('is-linked', this.linkedId === ch.id);
    const content = `${title}|${detail}|${kind}`;
    if (label.dataset.content !== content) {
      label.dataset.content = content;
      label.dataset.kind = kind;
      label.querySelector('strong').textContent = title;
      label.querySelector('span').textContent = detail; // not lastChild: unit labels end with the "…" button
    }
    const p = this.project(ch.x, ch.y);
    const pos = `${Math.round(p.x)}|${Math.round(p.y)}|${this.scale}`;
    if (label.dataset.pos !== pos) {
      label.dataset.pos = pos;
      label.style.left = `${Math.round(p.x) * this.scale}px`;
      label.style.top = `${(Math.round(p.y) + 2) * this.scale}px`;
      label.style.maxWidth = `${84 * this.scale}px`;
    }
  }

  placeIdleTag(key, ch, text) {
    let tag = this.labels.get(key);
    if (!tag) {
      tag = document.createElement('div');
      tag.className = 'idle-tag';
      this.overlay.append(tag);
      this.labels.set(key, tag);
    }
    tag.dataset.agent = ch.id;
    if (tag.textContent !== text) tag.textContent = text;
    const p = this.project(ch.x, ch.y);
    tag.style.left = `${p.x * this.scale}px`;
    tag.style.top = `${(p.y + 1) * this.scale}px`;
  }

  createLabelMenuButton(label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'label-more';
    button.textContent = '…';
    button.setAttribute('aria-label', 'Ações da sessão');
    button.setAttribute('aria-haspopup', 'menu');
    button.addEventListener('click', () => this.onMenu(label.dataset.agent, button, button));
    button.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this.onMenu(label.dataset.agent, button, button);
    });
    // Over the button the canvas sees a mouseleave; keep its card lit and the label up meanwhile.
    button.addEventListener('mouseenter', () => {
      this.hovered = { id: label.dataset.agent, until: Infinity };
      this.linkFromScene(label.dataset.agent);
    });
    button.addEventListener('mouseleave', () => {
      this.hovered = { id: label.dataset.agent, until: performance.now() + LABEL_MENU_LINGER_MS };
      this.linkFromScene(null);
    });
    return button;
  }

  // Labels let the pointer through so the art stays clickable, so they are hit-tested here:
  // right-click and hover on a label mean its agent. Then the art itself.
  agentAt(event) {
    for (const tag of this.overlay.querySelectorAll('[data-agent]')) {
      const box = tag.getBoundingClientRect();
      const isInside = event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
      if (isInside) return tag.dataset.agent;
    }
    return this.hitAt(event)?.id ?? null;
  }

  hitAt(event) {
    if (this.is3d) return this.hitAt3d(event);
    const art = this.artAt(event);
    const { x: wx, y: wy } = this.unproject(art.x, art.y);
    const isInside = (b) => {
      const [x, y] = b.isGround ? [wx, wy] : [art.x, art.y];
      return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
    };
    const hit = this.hitBoxes.filter(isInside).sort((a, b) => b.z - a.z)[0];
    if (!hit?.freeLand) return hit;
    // Free land is wherever no base (nor the square) stands; it answers with the spot a base founded there takes.
    const isTaken = this.occupiedSpots().some(({ pos }) => isInsideSpot(pos, wx, wy)) || this.isOnSquare(wx, wy);
    return isTaken ? undefined : { ...hit, freeLand: this.spotForPoint(wx, wy) };
  }

  hitAt3d(event) {
    const hit = this.world3d.pick(event.clientX, event.clientY);
    if (hit) return hit;
    const ground = this.world3d.groundAtClient(event.clientX, event.clientY);
    if (!ground) return undefined;
    if (this.isOnSquare(ground.x, ground.y, PAVING)) return { square: true };
    const isOnLand = ground.x >= MAP_X0 && ground.x <= LAND_X1 && ground.y >= MAP_Y0;
    if (isOnLand && ground.y > this.landBottom && ground.y < this.landBottom + this.fogHeight) return { fog: this.fogNames.length };
    if (!isOnLand || ground.y > this.landBottom) return undefined;
    if (this.occupiedSpots().some(({ pos }) => isInsideSpot(pos, ground.x, ground.y)) || this.isOnSquare(ground.x, ground.y)) return undefined;
    return { freeLand: this.spotForPoint(ground.x, ground.y) };
  }

  handlePointer(event, isClick) {
    if (this.drag?.isDragging) return;
    if (isClick && performance.now() < this.suppressClickUntil) return;
    if (this.placing) {
      this.placing.spot = this.placingSpotAt(event);
      this.onHover(null);
      if (!isClick || !this.placing.spot) return;
      const { project, path, spot } = this.placing;
      this.cancelPlacing();
      this.onPlace?.(project, spot, path);
      return;
    }
    const hit = this.hitAt(event);
    const agentId = this.agentAt(event);
    this.linkFromScene(agentId);
    const isClickable = Boolean(hit?.id) || Boolean(hit?.project) || Boolean(hit?.fog);
    this.viewCanvas.style.cursor = isClickable ? 'pointer' : hit?.square ? 'grab' : 'default';
    this.landHover = null; // where a base would go shows only while building or summoning
    if (isClick) {
      const point = { x: event.clientX, y: event.clientY };
      const isAdding = event.shiftKey || event.ctrlKey || event.metaKey;
      // With villagers picked, a click anywhere on a base sends them there (the order dialog).
      const world = this.worldAt(event);
      const orderTo = this.selected.size > 0 && !hit?.id ? (hit?.project ?? this.baseAt(world.x, world.y)?.project) : null;
      if (hit?.id && isAdding) this.toggleSelected(hit.id);
      else if (hit?.id) this.onSelect(hit.id, point);
      else if (orderTo) this.onOrder([...this.selected], orderTo, point);
      else if (hit?.project) this.onProjectClick(hit.project, point);
      else if (hit?.fog) this.onFogClick?.();
      else if (!isAdding) this.setSelection([]); // a click on the ground drops the selection, as in the game
      return;
    }
    const detail = hit && !hit.freeLand && { id: hit.id, botId: hit.botId, project: hit.project, fog: hit.fog, square: hit.square };
    this.onHover(detail ? { ...detail, x: event.clientX, y: event.clientY } : null);
  }
}
