// A base's land, grown or shrunk by dragging its edges. The core (town center, gold mine, forge and
// yard, as laid out for a lot) stands on the bottom edge, by the gate; a land smaller than a lot gets
// the half-lot core instead. Land behind a full core walls in a bailey around the town center, towers
// along the walls and a keep and halls inside; the rest fills with a village of houses, barns,
// fields, trees, haystacks, woodpiles, market stalls, windmills and ponds off a street out of the
// yard. Deterministic: the same land and name always grow the same base, and resizing it keeps what
// already stood, since each spot rolls on its own on a grid tied to the core and the bailey steps out
// from the core in whole steps. Plot-local world pixels, from the top-left.
import { hashString, ihash } from './sprites.js';

// The core, as empire.js lays it out.
export const CORE_W = 128;
export const CORE_H = 84;
// The half-lot core (empire.js lays it out too): a smaller town center with a little mine and forge
// at its sides. A land narrower or shallower than a lot gets it.
export const SMALL_CORE_W = 64;
export const SMALL_CORE_H = 60;
// Behind the town center, clear of the mine, the forge and the work spots: where a big castle's
// walls stand on the smallest land (core-local).
export const CORE_WALLS = { x0: 34, x1: 94, y0: 6, y1: 30 };
const CORE_MID = 64; // the town center's middle, over the gate
const SMALL_MID = 32;
const CORE_TC_TOP = 16; // the town center's back wall
const CORE_STREET_Y = 56; // the yard's band across the core, which the village street carries on
const SMALL_STREET_Y = 40;
const STREET_H = 9;
const EDGE = 4; // nothing grows closer to the plot's edge
const BAILEY_MIN_DEPTH = 36; // land behind the core it takes to wall in a bailey
const BAILEY_MAX_DEPTH = 120; // past this the land behind the bailey is village again
const BAILEY_MAX_HALF = 110;
const BAILEY_STEP = 8; // the bailey widens and deepens in whole steps, not with every pixel dragged
const TOWER_R = 5;
const TOWER_STEP = 44; // the longest run of wall between two towers
const CELL = 16; // the village rolls once per cell
const GAP = 3; // between two buildings
// The town center grows with the land: fully once the land has this many core sizes more, across
// plus deep (about three lots each way), when it may stand this much further back into the bailey.
const TOWN_GROW_FULL = 4;
const TOWN_GROW_BACK = 36;

const even = (value) => Math.round(value / 2) * 2;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const stepDown = (value) => Math.floor(value / BAILEY_STEP) * BAILEY_STEP;

/** Whether a w × h land is too small for the full core and gets the half-lot one. */
export function isSmallLand(w, h) {
  return w < CORE_W || h < CORE_H;
}

/**
 * What stands on a w × h plot whose core is coreX from its left edge:
 * { core, growth, walls, towers, buildings, fields, trees, props, well, yards }. core is
 * { x, y, w, h, isSmall }. growth is how the town center grows with the land: { k } from 0 (a lot or
 * less) to 1, { room }, how much further back than its usual back wall it may stand (the bailey
 * keeps that ground clear), and { isSmall } on a half-lot core, where it stands smaller. walls is the
 * curtain wall as an open polyline [[x, y]…] (null without a bailey); buildings are { kind: 'keep' |
 * 'hall' | 'house' | 'barn', x, y, w, h, axis, seed } footprints, the door on the front (+y) and the
 * ridge along `axis`; props are { kind: 'haystack' | 'woodpile' | 'stall' | 'windmill' | 'pond', x,
 * y, w, h, seed } footprints.
 */
export function planPlot(project, w, h, coreX) {
  const seed = hashString(project);
  const isSmall = isSmallLand(w, h);
  const [coreW, coreH] = isSmall ? [SMALL_CORE_W, SMALL_CORE_H] : [CORE_W, CORE_H];
  const core = { x: coreX, y: h - coreH, w: coreW, h: coreH, isSmall };
  const growth = { k: clamp(((w - CORE_W) / CORE_W + (h - CORE_H) / CORE_H) / TOWN_GROW_FULL, 0, 1), room: 0, isSmall };
  const plan = { w, h, core, growth, walls: null, towers: [], buildings: [], fields: [], trees: [], props: [], well: null, yards: [] };
  const taken = [{ x: core.x, y: core.y, w: core.w, h: core.h }];
  addStreets(plan, taken);
  if (!isSmall && core.y >= BAILEY_MIN_DEPTH) addBailey(plan, taken, seed);
  addVillage(plan, taken, seed);
  return plan;
}

// The yard's band runs on to the plot's edges, left and right of the core.
function addStreets(plan, taken) {
  const { core, w } = plan;
  const y = core.y + (core.isSmall ? SMALL_STREET_Y : CORE_STREET_Y);
  const left = { x: EDGE, y, w: core.x + 6 - EDGE, h: STREET_H };
  const right = { x: core.x + core.w - 6, y, w: w - EDGE - (core.x + core.w - 6), h: STREET_H };
  for (const street of [left, right]) {
    if (street.w <= 6 + EDGE) continue;
    plan.yards.push(street);
    taken.push(street);
  }
}

// Curtain walls from the town center's sides round the land behind the core, wider and deeper as the
// land allows, in whole steps; a keep against the back wall and halls along the walls when there is
// room inside. Halls and towers line up from the core (and the keep) outward, so a bigger bailey
// keeps the ones that stood and adds more at its ends.
function addBailey(plan, taken, seed) {
  const { core, w } = plan;
  const mid = core.x + CORE_MID;
  const half = clamp(stepDown(Math.min(mid - EDGE - TOWER_R, w - EDGE - TOWER_R - mid, 30 + core.y)), CORE_MID - CORE_WALLS.x0, BAILEY_MAX_HALF);
  const [x0, x1] = [mid - half, mid + half];
  const y1 = core.y - 4;
  const y0 = y1 - Math.min(stepDown(y1 - EDGE - TOWER_R), BAILEY_MAX_DEPTH);
  const [n0, n1, ny] = [core.x + CORE_WALLS.x0, core.x + CORE_WALLS.x1, core.y + CORE_WALLS.y1];
  plan.walls = simplify([[n0, ny], [n0, y1], [x0, y1], [x0, y0], [x1, y0], [x1, y1], [n1, y1], [n1, ny]]);
  plan.towers = baileyTowers(plan.walls, mid);
  taken.push({ x: x0 - TOWER_R, y: y0 - TOWER_R, w: x1 - x0 + 2 * TOWER_R, h: y1 - y0 + TOWER_R });
  const inner = { x0: x0 + 6, x1: x1 - 6, y0: y0 + 6, y1: y1 - 6 };
  const [innerW, innerH] = [inner.x1 - inner.x0, inner.y1 - inner.y0];
  let courtTop = inner.y0;
  if (innerW >= 50 && innerH >= 30) {
    const kw = even(clamp(innerW * 0.22, 14, 28));
    const kh = even(clamp(innerH * 0.45, 12, 24));
    plan.buildings.push({ kind: 'keep', x: mid - kw / 2, y: inner.y0, w: kw, h: kh, axis: 'x', seed });
    courtTop = inner.y0 + kh;
  }
  // halls along the back wall, either side of the keep, leaving the middle to the courtyard
  const hallH = 12;
  if (innerH >= hallH + 18) {
    const keep = plan.buildings.find((b) => b.kind === 'keep');
    const leftEnd = keep ? keep.x - 2 * GAP : mid - 14;
    const rightStart = keep ? keep.x + keep.w + 2 * GAP : mid + 14;
    fillRow(plan, leftEnd, inner.x0, inner.y0, hallH, seed, 1);
    fillRow(plan, rightStart, inner.x1, inner.y0, hallH, seed, 2);
    courtTop = Math.max(courtTop, inner.y0 + hallH);
  }
  // and up the side walls from the core, when the courtyard keeps the town center's width
  const sideW = 12;
  if (inner.x0 + sideW + GAP <= mid - 30) {
    for (const [x, side] of [[inner.x0, 3], [inner.x1 - sideW, 4]]) fillColumn(plan, x, inner.y1, inner.y0 + hallH + 2 * GAP, sideW, seed, side);
  }
  // the grown town center reaches back into the courtyard, short of the keep and the halls, and the
  // well keeps clear of it
  const tcBack = core.y + CORE_TC_TOP;
  plan.growth.room = tcBack - Math.max(courtTop + GAP, tcBack - Math.round(plan.growth.k * TOWN_GROW_BACK));
  const courtEnd = Math.min(inner.y1, tcBack - plan.growth.room - 8);
  if (courtEnd - courtTop >= 24) plan.well = { x: mid, y: Math.round((courtTop + courtEnd) / 2) + 8 };
  // a trodden path from the keep (or the back wall) down to the town center's back
  plan.yards.push({ x: mid - 5, y: courtTop, w: 10, h: core.y + CORE_TC_TOP - courtTop });
}

// Halls side by side along x, from `from` toward `to` (either way), each its own length; the last
// one takes what room is left.
function fillRow(plan, from, to, y, h, seed, salt) {
  const dir = Math.sign(to - from);
  for (let x = from, k = 0; ; k++) {
    const room = Math.abs(to - x);
    const w = Math.min(16 + (ihash(seed + salt * 977 + k * 31) % 4) * 4, Math.floor(room / 2) * 2);
    if (w < 14) return;
    plan.buildings.push({ kind: 'hall', x: dir > 0 ? x : x - w, y, w, h, axis: 'x', seed: seed + k });
    x += dir * (w + GAP);
  }
}

// Halls end to end along y, from the bottom `from` up to `to`.
function fillColumn(plan, x, from, to, w, seed, salt) {
  for (let y = from, k = 0; ; k++) {
    const h = 16 + (ihash(seed + salt * 977 + k * 31) % 3) * 5;
    if (y - h < to) return;
    plan.buildings.push({ kind: 'hall', x, y: y - h, w, h, axis: 'y', seed: seed + salt * 100 + k });
    y -= h + GAP;
  }
}

// A tower on every corner of the bailey's wall, and along each run every TOWER_STEP from the end
// nearest the core (from the middle on the back wall), skipping one that would crowd a corner.
function baileyTowers(points, mid) {
  const towers = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    const axis = a[0] === b[0] ? 1 : 0; // 1: the run goes along y
    const [lo, hi] = [Math.min(a[axis], b[axis]), Math.max(a[axis], b[axis])];
    const anchor = axis === 1 ? hi : clamp(mid, lo, hi);
    for (let v = anchor - Math.floor((anchor - lo) / TOWER_STEP) * TOWER_STEP; v < hi; v += TOWER_STEP) {
      if (v - lo >= TOWER_STEP / 3 && hi - v >= TOWER_STEP / 3) towers.push(axis === 1 ? [a[0], v] : [v, a[1]]);
    }
    towers.push(b);
  }
  return towers;
}

// Drops repeated corners and corners on a straight run.
function simplify(points) {
  const out = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && last[0] === p[0] && last[1] === p[1]) continue;
    const before = out[out.length - 2];
    if (before && last && (before[0] === last[0]) === (last[0] === p[0]) && (before[1] === last[1]) === (last[1] === p[1])) out.pop();
    out.push(p);
  }
  return out;
}

/** A tower on every corner, and along each run so no stretch of wall is longer than `step`. */
export function towersAlong(points, step = TOWER_STEP) {
  const towers = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1];
    const [bx, by] = points[i];
    const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / step);
    for (let k = 1; k < steps; k++) towers.push([Math.round(ax + ((bx - ax) * k) / steps), Math.round(ay + ((by - ay) * k) / steps)]);
    towers.push(points[i]);
  }
  return towers;
}

// One roll per cell of a grid tied to the core, the cells nearest the town center first: a house, a
// barn, a field, a tree, a haystack, a woodpile, a market stall, a windmill, a pond or open ground,
// placed where it clears everything already standing.
function addVillage(plan, taken, seed) {
  const { core, w, h } = plan;
  const cells = [];
  for (let j = Math.floor((EDGE - core.y) / CELL); core.y + j * CELL < h - EDGE; j++) {
    for (let i = Math.floor((EDGE - core.x) / CELL); core.x + i * CELL < w - EDGE; i++) cells.push([i, j]);
  }
  const [mx, my] = [(core.isSmall ? SMALL_MID : CORE_MID) / CELL, 2.5];
  cells.sort((a, b) => Math.hypot(a[0] - mx, a[1] - my) - Math.hypot(b[0] - mx, b[1] - my));
  for (const [i, j] of cells) {
    const r = ihash(seed + i * 7919 + j * 104729);
    const item = villageItem(r, core.x + i * CELL + ((r >>> 13) % 5) - 2, core.y + j * CELL + ((r >>> 17) % 5) - 2);
    if (!item) continue;
    const box = item.kind === 'tree' ? { x: item.x - 5, y: item.y - 6, w: 10, h: 8 } : item;
    const isInside = box.x >= EDGE && box.y >= EDGE && box.x + box.w <= w - EDGE && box.y + box.h <= h - EDGE;
    if (!isInside || taken.some((t) => overlaps(box, t, GAP))) continue;
    taken.push(box);
    if (item.kind === 'tree') plan.trees.push(item);
    else if (item.kind === 'field') plan.fields.push(item);
    else if (item.kind === 'house' || item.kind === 'barn') plan.buildings.push(item);
    else plan.props.push(item);
  }
}

// The rolls below 62 grow what they always did; the rest, once open ground, now mostly gets a prop.
function villageItem(r, x, y) {
  const roll = r % 100;
  const [a, b] = [(r >>> 8) % 4, (r >>> 11) % 3];
  if (roll < 26) return { kind: 'house', x, y, w: 14 + (a % 3) * 2, h: 12 + (b % 2) * 2, axis: b === 2 ? 'y' : 'x', seed: r };
  if (roll < 42) return { kind: 'field', x, y, w: 24 + a * 4, h: 16 + b * 4, seed: r };
  if (roll < 48) return { kind: 'barn', x, y, w: 20 + (a % 2) * 4, h: 14 + (b % 2) * 2, axis: 'x', seed: r };
  if (roll < 62) return { kind: 'tree', x: x + 8, y: y + 12, size: b };
  if (roll < 68) return { kind: 'haystack', x, y, w: 8 + (a % 2) * 2, h: 6, seed: r };
  if (roll < 73) return { kind: 'woodpile', x, y, w: 10 + (a % 2) * 2, h: 5, seed: r };
  if (roll < 77) return { kind: 'stall', x, y, w: 12, h: 8, seed: r };
  if (roll < 80) return { kind: 'windmill', x, y, w: 12, h: 12, seed: r };
  if (roll < 85) return { kind: 'pond', x, y, w: 18 + a * 3, h: 10 + b * 2, seed: r };
  return null;
}

function overlaps(a, b, gap) {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
}
