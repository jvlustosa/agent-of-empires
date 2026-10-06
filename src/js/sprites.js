// Procedural pixel art: every sprite is drawn with fillRect at 1 world pixel per cell,
// and the canvas is upscaled with image-rendering: pixelated.
import { kindInfo } from './kinds.js';

export const C = {
  outline: '#1b1d2b',
  eye: '#1b1d2b',
  shadow: 'rgba(8, 14, 6, 0.32)',
  white: '#f4f4f0',
  grassA: '#4f7a36',
  grassB: '#56843b',
  grassDark: '#41682d',
  grassLight: '#6a9a48',
  trodden: '#7f8a4a',
  dirt: '#a07f52',
  dirtLight: '#b39062',
  dirtDark: '#86683f',
  plaza: '#8f8570',
  plazaLight: '#a2977f',
  plazaDark: '#776d5b',
  stone: '#a59a86',
  stoneLight: '#c4b9a3',
  stoneDark: '#7d7362',
  rock: '#8d8f96',
  rockLight: '#b4b6bc',
  rockDark: '#65676e',
  gold: '#f2c84b',
  goldDark: '#c99a2e',
  goldGlint: '#fff3b0',
  wood: '#8a5a32',
  woodLight: '#a8773f',
  woodDark: '#5e3c20',
  trunk: '#5a3d22',
  leaf: '#2f6b33',
  leafLight: '#3f8a40',
  leafDark: '#24512a',
  plaster: '#d8c7a2',
  doorDark: '#3a2716',
  windowDark: '#2a1d12',
  windowLit: '#fcd77a',
  fire: '#f97316',
  fireHot: '#facc15',
  fireCore: '#fff7d6',
  water: '#3b6fa8',
  waterLight: '#6f9fd6',
  metal: '#aab3c4',
  metalDark: '#5d677b',
  brass: '#c8a24a',
  parchment: '#efe2c0',
  hay: '#e0c060',
  hayDark: '#b8983c',
  claude: '#d97757',
};

// Team colors: each repository flies its own (roof, banner, territory and the villagers' tunics).
// The palette the user can pick a base's color from, [color, shade].
export const TEAM_COLORS = [
  ['#e05a4f', '#b8443b'],
  ['#4f8fe0', '#3a6fb5'],
  ['#4fbf76', '#389458'],
  ['#e0ae4f', '#b8893a'],
  ['#9b6be0', '#7a4fbd'],
  ['#e07ab0', '#bb5a8e'],
  ['#45c1bd', '#339592'],
  ['#f08a3c', '#c96c28'],
  ['#2f2f36', '#1c1c21'],
];
// Black is a pick in the design dialog only: the color a repository's name hashes to keeps drawing
// from the first eight, so adding it repaints no base that uses the automatic one.
const HASHED_TEAM_COLORS = TEAM_COLORS.slice(0, 8);
const SKINS = [
  ['#f1c9a5', '#d9a983'],
  ['#d9a47a', '#bd8960'],
  ['#b07850', '#93603d'],
  ['#8a5a3a', '#6f472d'],
  ['#5e3b25', '#4a2d1c'],
];
const HAIRS = ['#3b2a1a', '#6b4a2a', '#c9a050', '#1f1a17', '#8a3b1f', '#9a9a9a'];
const PANTS = ['#6b5a44', '#5a4c3a', '#4d5560', '#6a5136'];
const ARMY = { base: '#5a6b3b', dark: '#3e4a28', light: '#7a8c4e', plume: '#ef4444' };
const HORSES = [
  ['#7a4f2e', '#5a3a22', '#2a1d12'],
  ['#d8d0c0', '#b0a690', '#6b6255'],
  ['#3a2c22', '#261c15', '#120d09'],
];

const SPARK_5 = ['#.#.#', '.###.', '#####', '.###.', '#.#.#'];
// Claude Code's spinner (· ✢ ✳ ✶ ✻ ✽) in 5×5 pixels: a dot that turns as it grows into the spark.
const SPINNER = [
  ['.....', '.....', '..#..', '.....', '.....'],
  ['.....', '..#..', '.###.', '..#..', '.....'],
  ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
  ['..#..', '..#..', '#####', '..#..', '..#..'],
  SPARK_5,
];
const SPINNER_FPS = 8;

/** The spinner's frame at t seconds: up to the spark and back down, as the terminal's. */
export function spinnerFrame(t) {
  const lap = 2 * SPINNER.length - 2;
  const step = Math.floor(t * SPINNER_FPS) % lap;
  return step < SPINNER.length ? step : lap - step;
}

const ICONS = {
  terminal: ['#....', '.#...', '..#..', '.#...', '#.###'],
  git: ['#...#', '#...#', '.###.', '..#..', '..#..'], // a fork: two lines joining into one
  coding: ['...##', '..###', '.###.', '###..', '##...'],
  reading: ['.###.', '#...#', '#...#', '.###.', '....#'],
  web: ['.###.', '#.#.#', '#####', '#.#.#', '.###.'],
  writing: ['#####', '.....', '####.', '.....', '###..'],
  delegating: ['...##', '..#..', '##...', '..#..', '...##'],
  planning: ['#.###', '.....', '#.###', '.....', '#.###'],
  asking: ['..#..', '..#..', '..#..', '.....', '..#..'],
  tool: ['.#.#.', '#####', '##.##', '#####', '.#.#.'],
  idle: ['####.', '..#..', '.#...', '####.', '.....'],
  done: ['....#', '...#.', '#.#..', '.#...', '.....'],
  yourturn: ['.....', '.....', '#.#.#', '.....', '.....'],
  // Crossed swords: two agents fighting over the same file.
  conflict: ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
};

// Bubbles that ask something of the user are filled: red = blocked, amber = your turn.
const FILLED_EMOTES = {
  asking: { bg: '#dc2626', fg: '#f4f4f0' },
  yourturn: { bg: '#fbbf24', fg: '#1b1d2b' },
  conflict: { bg: '#fb923c', fg: '#1b1d2b' },
};

export function rect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function bitmap(ctx, x, y, rows, colors) {
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      const color = colors[rows[r][c]];
      if (color) rect(ctx, x + c, y + r, 1, 1, color);
    }
  }
}

function line(ctx, x0, y0, x1, y1, color) {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    rect(ctx, x0, y0, 1, 1, color);
    if (x0 === x1 && y0 === y1) return;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

export function hashString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Integer hash for deterministic "random" scenery and animation per step.
export function ihash(n) {
  let x = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return x >>> 0;
}

function pick(list, n) {
  return list[n % list.length];
}

export function teamColor(project) {
  return pick(HASHED_TEAM_COLORS, hashString(project))[0];
}

export function teamShade(project) {
  return pick(HASHED_TEAM_COLORS, hashString(project))[1];
}

// Villagers wear the repository's color (teams read at a glance); face, hair and hat vary per
// session. kind 'scout' is the observer that rides between the bases.
export function makeLook(id, project, kind = 'villager') {
  const h = hashString(id);
  const [tunic, tunicShade] = pick(HASHED_TEAM_COLORS, hashString(project));
  const [skin, skinShade] = pick(SKINS, h >>> 3);
  return {
    tunic,
    tunicShade,
    shirt: tunic,
    skin,
    skinShade,
    hair: pick(HAIRS, h >>> 7),
    pants: pick(PANTS, h >>> 11),
    hat: (h >>> 15) % 4,
    horse: pick(HORSES, h >>> 17),
    kind,
    seed: h,
  };
}

export function drawShadow(ctx, x, y, width = 9) {
  const left = Math.round(x - width / 2);
  rect(ctx, left + 1, Math.round(y) - 1, width - 2, 2, C.shadow);
  rect(ctx, left, Math.round(y) - 1, width, 1, C.shadow);
}

// ---------- Units ----------

/**
 * Villager anchored at the feet (x = center, y = bottom), 10 x 17 art pixels.
 * pose: 'stand' | 'walk' | 'work' (tool swinging) | 'sit' (facing the camera)
 * tool: null | 'pickaxe' | 'hammer' | 'spyglass' | 'scroll'; wave: -1 = arms down, 0/1 = hand up.
 */
/**
 * Construir's icon: a keep with two team-roofed towers, 12 x 13 art pixels from (x0, y0), lit from
 * the left like the units, so it sits beside the villager's bust in the game bar as one set.
 */
export function drawKeepIcon(ctx, x0, y0, team, shade) {
  const P = (c, r, w, h, color) => rect(ctx, x0 + c, y0 + r, w, h, color);
  // banner on the gate tower
  P(6, 0, 1, 5, C.woodDark);
  P(7, 0, 3, 1, team);
  P(7, 1, 2, 1, shade);
  // curtain wall: merlons, the lit walkway, then the gate
  P(3, 5, 1, 1, C.stone);
  P(5, 5, 2, 1, C.stone);
  P(8, 5, 1, 1, C.stone);
  P(3, 6, 6, 7, C.stone);
  P(3, 6, 6, 1, C.stoneLight);
  P(5, 8, 2, 1, C.doorDark);
  P(4, 9, 4, 4, C.doorDark);
  P(4, 10, 4, 3, C.wood);
  P(5, 10, 1, 3, C.woodDark);
  P(7, 10, 1, 3, C.woodDark);
  // the towers: cone roof in the team color, lit left edge, a lit window
  for (const left of [0, 9]) {
    P(left + 1, 1, 1, 1, team);
    P(left, 2, 3, 1, team);
    P(left + 2, 2, 1, 1, shade);
    P(left, 3, 3, 1, shade);
    P(left, 4, 3, 9, C.stone);
    P(left, 4, 1, 9, C.stoneLight);
    P(left + 2, 4, 1, 9, C.stoneDark);
    P(left + 1, 6, 1, 2, C.windowLit);
    P(left + 1, 10, 1, 1, C.stoneDark);
  }
  P(0, 12, 12, 1, C.stoneDark); // footing
}

export function drawVillager(ctx, look, ax, ay, dir, pose, frame, t, tool = null, wave = -1) {
  const isSitting = pose === 'sit';
  const x0 = Math.round(ax) - 5;
  const top = Math.round(ay) - (isSitting ? 14 : 17);
  const isFlipped = dir === 'w';
  const P = (c, r, w, h, color) => rect(ctx, isFlipped ? x0 + 10 - c - w : x0 + c, top + r, w, h, color);
  const view = isSitting ? 'front' : dir === 'n' ? 'back' : dir === 'e' || dir === 'w' ? 'side' : 'front';
  if (view === 'side') drawVillagerSide(P, look, pose, frame, t);
  else drawVillagerFront(P, look, view, pose, frame, t, tool, wave);
  if (tool) drawTool(P, tool, view, pose === 'work' ? frame % 2 : 0);
}

function drawHat(P, look, view) {
  if (look.hat === 1) {
    // straw hat
    P(0, 1, 10, 1, C.hayDark);
    P(2, -1, 6, 2, C.hay);
    P(2, 0, 6, 1, C.hayDark);
    return true;
  }
  if (look.hat === 2) {
    // hood in the team shade
    P(1, -1, 8, 2, look.tunicShade);
    P(1, 1, 1, 4, look.tunicShade);
    P(8, 1, 1, 4, look.tunicShade);
    if (view === 'back') P(2, 1, 6, 4, look.tunicShade);
    return true;
  }
  if (look.hat === 3) {
    // cap in the team color
    P(2, -1, 6, 2, look.tunic);
    P(2, 0, view === 'back' ? 6 : 7, 1, look.tunicShade);
    return false;
  }
  return false;
}

function drawVillagerFront(P, look, view, pose, frame, t, tool, wave) {
  const isSitting = pose === 'sit';
  // hair, then the face (or the back of the head)
  P(2, 0, 6, 2, look.hair);
  P(1, 1, 1, 3, look.hair);
  P(8, 1, 1, 3, look.hair);
  if (view === 'back') {
    P(2, 2, 6, 4, look.hair);
  } else {
    P(2, 2, 6, 4, look.skin);
    P(2, 2, 6, 1, look.hair);
    const isBlinking = Math.floor(t * 1.3 + look.seed) % 5 === 0;
    if (!isBlinking) {
      P(3, 3, 1, 1, C.eye);
      P(6, 3, 1, 1, C.eye);
    }
    P(7, 4, 1, 1, look.skinShade);
  }
  drawHat(P, look, view);
  P(4, 6, 2, 1, look.skinShade);
  // tunic and belt
  P(2, 7, 6, 6, look.tunic);
  P(7, 7, 1, 6, look.tunicShade);
  P(3, 7, 4, 1, look.tunicShade);
  P(2, 10, 6, 1, C.woodDark);
  if (view !== 'back') P(4, 10, 1, 1, C.gold);
  // arms (the right one holds the tool or waves)
  const swing = pose === 'walk' ? [0, 1, 0, -1][frame] : 0;
  const isScroll = tool === 'scroll';
  P(1, 7 + swing, 1, 4, look.tunic);
  P(1, 11 + swing, 1, 1, look.skin);
  if (wave >= 0) {
    P(8, 3, 1, 5, look.tunic);
    P(8 + wave, 2, 1, 1, look.skin);
  } else if (!tool || isScroll) {
    P(8, 7 - swing, 1, 4, look.tunic);
    P(8, 11 - swing, 1, 1, look.skin);
  } else {
    P(8, 7, 1, 3, look.tunic);
    P(8, 10, 1, 1, look.skin);
  }
  // legs
  if (isSitting) {
    P(2, 13, 6, 1, look.pants);
    return;
  }
  const liftLeft = pose === 'walk' && frame === 1 ? 1 : 0;
  const liftRight = pose === 'walk' && frame === 3 ? 1 : 0;
  P(2, 13, 2, 3 - liftLeft, look.pants);
  P(6, 13, 2, 3 - liftRight, look.pants);
  P(2, 16 - liftLeft, 3, 1, C.woodDark);
  P(5, 16 - liftRight, 3, 1, C.woodDark);
}

function drawVillagerSide(P, look, pose, frame, t) {
  P(3, 0, 5, 2, look.hair);
  P(3, 2, 2, 3, look.hair);
  P(5, 2, 3, 4, look.skin);
  P(5, 2, 3, 1, look.hair);
  const isBlinking = Math.floor(t * 1.3 + look.seed) % 5 === 0;
  if (!isBlinking) P(6, 3, 1, 1, C.eye);
  P(8, 4, 1, 1, look.skin);
  drawHat(P, look, 'side');
  P(5, 6, 2, 1, look.skinShade);
  P(3, 7, 5, 6, look.tunic);
  P(3, 7, 1, 6, look.tunicShade);
  P(3, 10, 5, 1, C.woodDark);
  const swing = pose === 'walk' ? [0, 1, 0, -1][frame] : 0;
  P(5 + swing, 8, 2, 3, look.tunicShade);
  P(5 + swing, 11, 2, 1, look.skin);
  const isStriding = pose === 'walk' && frame % 2 === 1;
  if (!isStriding) {
    P(4, 13, 3, 3, look.pants);
    P(4, 16, 4, 1, C.woodDark);
  } else {
    P(3, 13, 2, 3, look.pants);
    P(6, 13, 2, 3, look.pants);
    P(2, 16, 3, 1, C.woodDark);
    P(6, 16, 3, 1, C.woodDark);
  }
}

// Tools sit in the right hand; frame 0 = raised, 1 = striking.
function drawTool(P, tool, view, frame) {
  const isSide = view === 'side';
  const hand = isSide ? 7 : 8;
  switch (tool) {
    case 'pickaxe':
      if (frame === 0) {
        P(hand, 1, 1, 9, C.wood);
        P(hand - 2, 0, 5, 1, C.metal);
        P(hand - 2, 1, 1, 1, C.metalDark);
        P(hand + 2, 1, 1, 1, C.metalDark);
      } else {
        P(hand, 9, 3, 1, C.wood);
        P(hand + 2, 7, 1, 5, C.metal);
      }
      return;
    case 'hammer':
      if (frame === 0) {
        P(hand, 4, 1, 6, C.wood);
        P(hand - 1, 2, 3, 2, C.metalDark);
      } else {
        P(hand, 10, 3, 1, C.wood);
        P(hand + 2, 9, 2, 3, C.metalDark);
      }
      return;
    case 'spyglass':
      P(hand - 1, 3, 3, 1, C.brass);
      P(hand + 1, 3, 1, 1, C.goldGlint);
      return;
    case 'scroll':
      if (isSide) {
        P(6, 8, 3, 3, C.parchment);
        return;
      }
      P(2, 8, 6, 3, C.parchment);
      P(3, 9, 4, 1, '#b8a47a');
      P(2, 8, 1, 3, '#d8c9a0');
      P(7, 8, 1, 3, '#d8c9a0');
      return;
    default:
  }
}

/** Mounted scout (the observer): horse seen from the side, rider in army green. */
export function drawScout(ctx, look, ax, ay, facing, isMoving, frame, t) {
  const x0 = Math.round(ax) - 8;
  const by = Math.round(ay);
  const isFlipped = facing === 'w';
  const P = (c, r, w, h, color) => rect(ctx, isFlipped ? x0 + 16 - c - w : x0 + c, by + r, w, h, color);
  const [coat, coatShade, mane] = look.horse;
  // legs (gallop: alternate pairs)
  const lift = isMoving ? frame % 2 : 0;
  P(4, -5 + lift, 1, 4 - lift, coatShade);
  P(6, -5, 1, 4, coat);
  P(11, -5 + (1 - lift), 1, 4 - (1 - lift), coatShade);
  P(13, -5, 1, 4, coat);
  P(4, -1, 1, 1, mane);
  P(6, -1, 1, 1, mane);
  P(11, -1, 1, 1, mane);
  P(13, -1, 1, 1, mane);
  // body, neck, head, tail
  P(3, -9, 11, 4, coat);
  P(3, -6, 11, 1, coatShade);
  P(12, -12, 2, 4, coat);
  P(13, -13, 3, 2, coat);
  P(15, -12, 1, 1, mane);
  P(13, -14, 1, 1, coat);
  P(11, -12, 1, 4, mane);
  P(1, -9, 2, 1, mane);
  P(1, -8, 1, 3 + (isMoving ? frame % 2 : 0), mane);
  // saddle and rider
  P(6, -10, 4, 1, '#7a1f1f');
  P(7, -9, 2, 3, ARMY.dark);
  P(6, -15, 4, 5, ARMY.base);
  P(6, -15, 1, 5, ARMY.dark);
  P(9, -14, 2, 2, ARMY.base);
  P(10, -13, 1, 1, look.skin);
  P(6, -19, 4, 3, look.skin);
  P(9, -18, 1, 1, C.eye);
  P(5, -20, 6, 2, ARMY.dark);
  P(6, -21, 4, 1, ARMY.light);
  P(7, -23 + (Math.floor(t * 3) % 2), 1, 2, ARMY.plume);
}

/** Soldier escorting its villager: a subagent; the spear pennant shows what it is doing. */
export function drawSoldier(ctx, look, x, y, kind, t, seed, lift = 0) {
  const bob = Math.floor(t * 2 + seed) % 2;
  const x0 = Math.round(x) - 4;
  const top = Math.round(y) - 13 - lift;
  const P = (c, r, w, h, color) => rect(ctx, x0 + c, top + r + (r < 8 ? bob : 0), w, h, color);
  drawShadow(ctx, x, y, 7);
  const flag = kind === 'done' ? '#34d399' : kindInfo(kind).color;
  P(7, -4, 1, 13, C.wood);
  P(7, -6, 1, 2, '#d6dbe3');
  P(8, -4, 2, 2, flag);
  P(2, 0, 4, 1, C.metal);
  P(1, 1, 6, 1, C.metalDark);
  P(2, 2, 4, 2, look.skin);
  P(3, 2, 1, 1, C.eye);
  P(5, 2, 1, 1, C.eye);
  P(2, 4, 4, 4, look.tunic);
  P(5, 4, 1, 4, look.tunicShade);
  P(0, 4, 2, 4, look.tunicShade);
  P(0, 5, 1, 1, C.gold);
  P(6, 5, 1, 1, look.skin);
  P(2, 8, 1, 4, look.pants);
  P(5, 8, 1, 4, look.pants);
  P(2, 12, 2, 1, C.woodDark);
  P(5, 12, 2, 1, C.woodDark);
}

/** Red scan line from the scout to the villager it inspects, plus a sweep over them. */
export function drawScan(ctx, fromX, fromY, toX, toY, t) {
  const steps = Math.max(1, Math.abs(toX - fromX), Math.abs(toY - fromY));
  ctx.save();
  ctx.globalAlpha = 0.5 + 0.2 * Math.sin(t * 20);
  for (let i = 0; i <= steps; i += 2) {
    rect(ctx, Math.round(fromX + ((toX - fromX) * i) / steps), Math.round(fromY + ((toY - fromY) * i) / steps), 1, 1, '#f87171');
  }
  ctx.globalAlpha = 0.4;
  rect(ctx, Math.round(toX) - 6, Math.round(toY) - 8 + Math.round(Math.abs(Math.sin(t * 3)) * 14), 12, 1, '#f87171');
  ctx.restore();
}

/** Speech bubble with a pixel icon; (tipX, tipY) is where the tail points. */
export function drawEmote(ctx, tipX, tipY, kind, t, frame = spinnerFrame(t)) {
  const icon = ICONS[kind];
  const filled = FILLED_EMOTES[kind];
  const w = 9;
  const h = 9;
  const hop = kind === 'asking' ? -Math.round(Math.abs(Math.sin(t * 5)) * 3) : 0;
  const x = Math.round(tipX - w / 2);
  const y = Math.round(tipY) - h - 2 + hop;
  const bg = filled?.bg ?? C.white;

  rect(ctx, x + 1, y, w - 2, 1, C.outline);
  rect(ctx, x + 1, y + h - 1, w - 2, 1, C.outline);
  rect(ctx, x, y + 1, 1, h - 2, C.outline);
  rect(ctx, x + w - 1, y + 1, 1, h - 2, C.outline);
  rect(ctx, x + 1, y + 1, w - 2, h - 2, bg);
  const tx = Math.round(tipX) - 1;
  rect(ctx, tx, y + h - 1, 3, 1, bg);
  rect(ctx, tx, y + h, 1, 1, C.outline);
  rect(ctx, tx + 1, y + h, 1, 1, bg);
  rect(ctx, tx + 2, y + h, 1, 1, C.outline);
  rect(ctx, tx + 1, y + h + 1, 1, 1, C.outline);

  if (kind === 'thinking') {
    bitmap(ctx, x + 2, y + 2, SPINNER[frame], { '#': C.claude });
    return;
  }
  if (!icon) return;
  bitmap(ctx, x + 2, y + 2, icon, { '#': filled?.fg ?? darken(kindInfo(kind).color) });
}

// Ragnarok-style emotes (/!, /?, /ho, /gg, /thx, /ok, /swt, /sob, /..., /zzz, /an): one pops over a
// villager when something happens to it and plays its loop, with bits flying out of the balloon.
// Original pixel art in the game's spirit: the game's own sprites are not ours to ship.
export const FEELING_MS = 3000;
// A push or a merge is news to keep up: its emote loops for minutes, the villager hopping now and then.
export const GIT_FEELING_MS = 10 * 60 * 1000;
const GIT_FEELINGS = new Set(['push', 'merge']);
const GIT_HOP_EVERY_MS = 6000;
const FEELING_FPS = 8;
const FEELING_LOOP = 8;
const FEELING_FRAMES = Math.ceil((FEELING_MS / 1000) * FEELING_FPS);
const FEELING_POP_MS = 260;
const FEELING_FOLD_MS = 180;
const FEELING_HOP_MS = 320;
const BALLOON_W = 15;
const BALLOON_H = 13;
const BALLOON_SHADE = '#d9dbe3';

const BANG = ['....##d....', '....##d....', '....##d....', '....##d....', '.....#.....', '...........', '....##d....', '....##d....', '...........'];
const QUESTION = ['...#####...', '..##...##..', '..##...##..', '......##...', '.....##....', '....##.....', '...........', '....##.....', '...........'];
const NOTES = ['...#######.', '...#######.', '...#.....#.', '...#.....#.', '...#.....#.', '.###...###.', '####..####.', '.##....##..', '...........'];
const DROP = ['.....#.....', '....###....', '....###....', '...#l###...', '..#l#####..', '..#######..', '..######d..', '...####d...', '....ddd....'];
const SOB = ['kkkk...kkkk', '.kk.....kk.', '.bb.....bb.', '.bb.kkk.bb.', '.bbk...kbb.', '.bb.....bb.', '.bb.....bb.', '.bb.....bb.', '...........'];
const BIG_Z = ['...........', '..#######..', '..#######..', '......##...', '.....##....', '....##.....', '...##......', '..#######..', '..#######..'];
const VEIN = ['...........', '...#...#...', '...#...#...', '.###...###.', '...........', '.###...###.', '...#...#...', '...#...#...', '...........'];
const VEIN_BIG = ['...#...#...', '...#...#...', '...#...#...', '####...####', '...........', '####...####', '...#...#...', '...#...#...', '...#...#...'];
const MINI_NOTE = ['.##', '.#.', '##.', '##.'];
const MINI_QUESTION = ['##.', '..#', '.#.', '...', '.#.'];
const MINI_Z = ['####', '..#.', '.#..', '####'];
const MINI_HEART = ['#.#', '###', '.#.'];
const MINI_DROP = ['.#.', '###', '.#.'];
const MINI_ARROW = ['..#..', '.###.', '#.#.#', '..#..', '..#..'];

// Block letters for the text emotes: 2 px uprights, 1 px bars.
const GLYPHS = {
  G: ['.####.', '##....', '##.###', '##..##', '##..##', '.####.'],
  O: ['.####.', '##..##', '##..##', '##..##', '##..##', '.####.'],
  K: ['##..##', '##.##.', '####..', '####..', '##.##.', '##..##'],
  T: ['######', '..##..', '..##..', '..##..', '..##..', '..##..'],
  H: ['##..##', '##..##', '######', '##..##', '##..##', '##..##'],
  X: ['##..##', '.####.', '..##..', '..##..', '.####.', '##..##'],
  P: ['#####.', '##..##', '##..##', '#####.', '##....', '##....'],
  U: ['##..##', '##..##', '##..##', '##..##', '##..##', '.####.'],
  S: ['.#####', '##....', '.####.', '....##', '....##', '#####.'],
  M: ['##...##', '###.###', '#######', '##.#.##', '##...##', '##...##'],
  E: ['######', '##....', '#####.', '##....', '##....', '######'],
  R: ['#####.', '##..##', '##..##', '#####.', '##.##.', '##..##'],
  '!': ['##', '##', '##', '##', '..', '##'],
};
// Light to dark, top to bottom: two letter rows per shade.
const GOLD = ['#fef3c7', '#fbbf24', '#d97706'];
const GREEN = ['#bbf7d0', '#22c55e', '#15803d'];
const PINK = ['#fce7f3', '#f472b6', '#db2777'];
const SKY = ['#e0f2fe', '#38bdf8', '#0284c7'];
const VIOLET = ['#ede9fe', '#a78bfa', '#7c3aed'];

const OUTLINE_AROUND = [[-1, 0], [1, 0], [0, -1], [0, 1]];

function outlined(ctx, x, y, rows, color) {
  for (const [ox, oy] of OUTLINE_AROUND) bitmap(ctx, x + ox, y + oy, rows, { '#': C.outline });
  bitmap(ctx, x, y, rows, { '#': color });
}

/** White rounded balloon with its tail at (tipX, tipY); dx shakes the body. Returns its top-left. */
function drawBalloon(ctx, tipX, tipY, dx = 0) {
  const w = BALLOON_W;
  const h = BALLOON_H;
  const x = Math.round(tipX - w / 2) + dx;
  const y = Math.round(tipY) - h - 2;
  rect(ctx, x + 2, y, w - 4, 1, C.outline);
  rect(ctx, x + 2, y + h - 1, w - 4, 1, C.outline);
  rect(ctx, x, y + 2, 1, h - 4, C.outline);
  rect(ctx, x + w - 1, y + 2, 1, h - 4, C.outline);
  for (const [cx, cy] of [[x + 1, y + 1], [x + w - 2, y + 1], [x + 1, y + h - 2], [x + w - 2, y + h - 2]]) rect(ctx, cx, cy, 1, 1, C.outline);
  rect(ctx, x + 2, y + 1, w - 4, h - 2, C.white);
  rect(ctx, x + 1, y + 2, w - 2, h - 4, C.white);
  rect(ctx, x + 2, y + h - 2, w - 4, 1, BALLOON_SHADE);
  const tx = Math.round(tipX) - 1;
  rect(ctx, tx, y + h - 1, 3, 1, BALLOON_SHADE);
  rect(ctx, tx, y + h, 1, 1, C.outline);
  rect(ctx, tx + 1, y + h, 1, 1, BALLOON_SHADE);
  rect(ctx, tx + 2, y + h, 1, 1, C.outline);
  rect(ctx, tx + 1, y + h + 1, 1, 1, C.outline);
  return { x, y };
}

/** Outlined, shaded block letters standing on (tipX, tipY); a wave runs through them. */
function drawEmoteText(ctx, tipX, tipY, text, shades, n) {
  const glyphs = [...text].map((letter) => GLYPHS[letter]);
  const width = glyphs.reduce((sum, glyph) => sum + glyph[0].length + 1, -1);
  let x = Math.round(tipX - width / 2);
  glyphs.forEach((glyph, i) => {
    const phase = (((n - i * 2) % FEELING_LOOP) + FEELING_LOOP) % FEELING_LOOP;
    const y = Math.round(tipY) - 8 - ([2, 1][phase] ?? 0);
    for (const [ox, oy] of [...OUTLINE_AROUND, [1, 1]]) bitmap(ctx, x + ox, y + oy, glyph, { '#': C.outline });
    glyph.forEach((row, r) => bitmap(ctx, x, y + r, [row], { '#': shades[Math.floor(r / 2)] }));
    x += glyph[0].length + 1;
  });
}

function drawSparkle(ctx, x, y, size, color) {
  if (size <= 0) return;
  rect(ctx, x, y - size, 1, size * 2 + 1, color);
  rect(ctx, x - size, y, size * 2 + 1, 1, color);
  rect(ctx, x, y, 1, 1, '#ffffff');
}

// Each emote draws frame n (0 until FEELING_FRAMES) of its life; most loop every FEELING_LOOP frames.
const EMOTES = {
  // /! : surprise. The balloon shakes, the mark jumps, strokes burst around it.
  exclaim(ctx, tipX, tipY, n) {
    const f = n % FEELING_LOOP;
    const { x, y } = drawBalloon(ctx, tipX, tipY, n < FEELING_LOOP ? [0, 1, 0, -1][f % 4] : 0);
    bitmap(ctx, x + 2, y + 2 - (f % 4 < 2 ? 1 : 0), BANG, { '#': '#ef4444', d: '#b91c1c' });
    if (f % 2) return;
    for (const [px, py] of [[x - 1, y - 1], [x - 2, y - 2], [x + 7, y - 2], [x + 7, y - 3], [x + 15, y - 1], [x + 16, y - 2]]) rect(ctx, px, py, 1, 1, '#ef4444');
  },
  // /? : the mark tilts while small ones float off the balloon.
  question(ctx, tipX, tipY, n) {
    const f = n % FEELING_LOOP;
    const { x, y } = drawBalloon(ctx, tipX, tipY);
    bitmap(ctx, x + 2 + (f < 4 ? 0 : 1), y + 2, QUESTION, { '#': '#2563eb' });
    const isRight = Math.floor(n / FEELING_LOOP) % 2 === 0;
    outlined(ctx, isRight ? x + 14 + (f >> 2) : x - 3 - (f >> 2), y - 1 - (f >> 1), MINI_QUESTION, '#60a5fa');
  },
  // /ho : music. The notes sway and single ones drift up on both sides.
  ho(ctx, tipX, tipY, n) {
    const f = n % FEELING_LOOP;
    const { x, y } = drawBalloon(ctx, tipX, tipY);
    bitmap(ctx, x + 2 + [0, 0, 1, 1, 0, 0, -1, -1][f], y + 2 - (f % 4 === 1 ? 1 : 0), NOTES, { '#': '#d97706' });
    const g = (f + 4) % FEELING_LOOP;
    outlined(ctx, x + 13 + (f >> 1), y + 1 - f, MINI_NOTE, '#fbbf24');
    outlined(ctx, x - 2 - (g >> 1), y + 1 - g, MINI_NOTE, '#fbbf24');
  },
  // /gg : a big job done. Gold letters wave, sparkles twinkle around.
  gg(ctx, tipX, tipY, n) {
    drawEmoteText(ctx, tipX, tipY, 'GG', GOLD, n);
    [[-10, -12], [10, -14], [11, -5], [-11, -4]].forEach(([sx, sy], i) => {
      const phase = (n + i * 2) % FEELING_LOOP;
      drawSparkle(ctx, Math.round(tipX) + sx, Math.round(tipY) + sy, phase < 2 ? 2 : phase < 4 ? 1 : 0, '#fde68a');
    });
  },
  // /thx : you unblocked it. Pink letters, hearts rising.
  thx(ctx, tipX, tipY, n) {
    drawEmoteText(ctx, tipX, tipY, 'THX', PINK, n);
    const f = n % FEELING_LOOP;
    const g = (f + 4) % FEELING_LOOP;
    outlined(ctx, Math.round(tipX) + 10 + (f >> 2), Math.round(tipY) - 12 - f, MINI_HEART, '#f43f5e');
    outlined(ctx, Math.round(tipX) - 13 - (g >> 2), Math.round(tipY) - 12 - g, MINI_HEART, '#f43f5e');
  },
  // /ok : you gave it a new task.
  ok(ctx, tipX, tipY, n) {
    drawEmoteText(ctx, tipX, tipY, 'OK!', GREEN, n);
    const phase = n % FEELING_LOOP;
    drawSparkle(ctx, Math.round(tipX) + 11, Math.round(tipY) - 12, phase < 2 ? 2 : phase < 4 ? 1 : 0, '#bbf7d0');
  },
  // /swt : blocked on you for a while. The drop slides, drops fly off both sides.
  swt(ctx, tipX, tipY, n) {
    const f = n % FEELING_LOOP;
    const { x, y } = drawBalloon(ctx, tipX, tipY);
    bitmap(ctx, x + 2, y + 2 + [-1, -1, 0, 0, 1, 1, 0, 0][f], DROP, { '#': '#3b82f6', l: '#bfdbfe', d: '#1d4ed8' });
    if (f < 2) return;
    const d = f - 2;
    const fall = Math.round((d * d) / 4);
    outlined(ctx, x - 2 - (d >> 1), y + 3 + fall, MINI_DROP, '#60a5fa');
    outlined(ctx, x + 14 + (d >> 1), y + 3 + fall, MINI_DROP, '#60a5fa');
  },
  // /sob : blocked on you for long. T_T with running tears, drops falling off the balloon.
  sob(ctx, tipX, tipY, n) {
    const f = n % FEELING_LOOP;
    const { x, y } = drawBalloon(ctx, tipX, tipY, f % 4 === 0 ? 1 : 0);
    bitmap(ctx, x + 2, y + 2, SOB, { k: C.outline, b: '#3b82f6' });
    const run = y + 4 + (f % 6);
    rect(ctx, x + 3, run, 2, 1, '#bfdbfe');
    rect(ctx, x + 10, run, 2, 1, '#bfdbfe');
    outlined(ctx, x - 2, y + 5 + f, MINI_DROP, '#60a5fa');
    outlined(ctx, x + 14, y + 5 + ((f + 4) % FEELING_LOOP), MINI_DROP, '#60a5fa');
  },
  // /... : your turn for a while. Dots come one by one, the last one hops in.
  dots(ctx, tipX, tipY, n) {
    const f = n % FEELING_LOOP;
    const { x, y } = drawBalloon(ctx, tipX, tipY);
    const shown = Math.min(3, (f >> 1) + 1);
    for (let i = 0; i < shown; i++) rect(ctx, x + 3 + i * 4, y + 6 - (i === shown - 1 && f % 2 === 0 ? 1 : 0), 2, 2, '#475569');
  },
  // /zzz : your turn for long. A big Z, small ones drifting up out of the balloon.
  zzz(ctx, tipX, tipY, n) {
    const f = n % FEELING_LOOP;
    const { x, y } = drawBalloon(ctx, tipX, tipY);
    bitmap(ctx, x + 2, y + 2, BIG_Z, { '#': '#6366f1' });
    outlined(ctx, x + 12 + (f >> 1), y - 1 - f, MINI_Z, '#a5b4fc');
  },
  // /push : its commits went up. Sky letters wave, arrows rise over them.
  push(ctx, tipX, tipY, n) {
    drawEmoteText(ctx, tipX, tipY, 'PUSH', SKY, n);
    const f = n % FEELING_LOOP;
    const g = (f + 4) % FEELING_LOOP;
    outlined(ctx, Math.round(tipX) + 5, Math.round(tipY) - 17 - f, MINI_ARROW, '#38bdf8');
    outlined(ctx, Math.round(tipX) - 10, Math.round(tipY) - 17 - g, MINI_ARROW, '#38bdf8');
  },
  // /merge : a branch joined another. Violet letters wave, sparkles twinkle over them.
  merge(ctx, tipX, tipY, n) {
    drawEmoteText(ctx, tipX, tipY, 'MERGE', VIOLET, n);
    [[-13, -15], [0, -19], [13, -15]].forEach(([sx, sy], i) => {
      const phase = (n + i * 3) % FEELING_LOOP;
      drawSparkle(ctx, Math.round(tipX) + sx, Math.round(tipY) + sy, phase < 2 ? 2 : phase < 4 ? 1 : 0, '#ddd6fe');
    });
  },
  // /an : another agent took its file. The vein throbs, the balloon shakes, steam puffs.
  an(ctx, tipX, tipY, n) {
    const f = n % FEELING_LOOP;
    const { x, y } = drawBalloon(ctx, tipX, tipY, [1, -1][f % 2]);
    const vein = f % 4 < 2 ? VEIN_BIG : VEIN;
    bitmap(ctx, x + 3, y + 3, vein, { '#': '#7f1d1d' });
    bitmap(ctx, x + 2, y + 2, vein, { '#': '#ef4444' });
    const puff = f >> 1;
    rect(ctx, x - 1 - puff, y - 1 - puff, 2, 2, '#e5e7eb');
    rect(ctx, x + 14 + puff, y - 1 - puff, 2, 2, '#e5e7eb');
  },
};

// The villager's own reaction: a hop for surprise, two for a big win.
const HOPS = { exclaim: 1, ok: 1, thx: 1, gg: 2, push: 2, merge: 2 };

export function isGitFeeling(kind) {
  return GIT_FEELINGS.has(kind);
}

/** How long this emote stays up. */
export function feelingMs(kind) {
  return isGitFeeling(kind) ? GIT_FEELING_MS : FEELING_MS;
}

/** Balloon scale: pops in with an overshoot, holds, folds away at the end (0 once gone). */
export function feelingPop(kind, age) {
  if (age < FEELING_POP_MS) {
    const p = age / FEELING_POP_MS;
    return 0.3 + 0.7 * p + 0.5 * Math.sin(p * Math.PI);
  }
  return Math.max(0, Math.min(1, (feelingMs(kind) - age) / FEELING_FOLD_MS));
}

/** How high (pixels) the villager jumps at this moment of its emote. */
export function feelingHop(kind, age) {
  const p = (isGitFeeling(kind) ? age % GIT_HOP_EVERY_MS : age) / FEELING_HOP_MS;
  return p < (HOPS[kind] ?? 0) ? Math.round(Math.sin((p % 1) * Math.PI) * 4) : 0;
}

/** The frame to draw: the long git emotes loop, the others stop on their last one. */
export function feelingFrame(kind, age) {
  const n = Math.floor((age / 1000) * FEELING_FPS);
  return isGitFeeling(kind) ? n % FEELING_LOOP : Math.min(FEELING_FRAMES - 1, n);
}

/** The emote at its current size and frame; (tipX, tipY) is where the balloon's tail points. */
export function drawFeeling(ctx, tipX, tipY, kind, age) {
  const scale = feelingPop(kind, age);
  if (scale <= 0) return;
  ctx.save();
  ctx.translate(tipX, tipY);
  ctx.scale(scale, scale);
  EMOTES[kind](ctx, 0, 0, feelingFrame(kind, age));
  ctx.restore();
}

export function drawFeelingFrame(ctx, tipX, tipY, kind, n) {
  EMOTES[kind](ctx, tipX, tipY, n);
}

function darken(hex) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.round(v * 0.62);
  return `rgb(${f(n >> 16)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
}

/** White ellipse under a picked villager, as in the game. */
export function drawSelectionRing(ctx, x, y) {
  const cx = Math.round(x);
  const cy = Math.round(y);
  rect(ctx, cx - 4, cy - 2, 9, 1, C.white);
  rect(ctx, cx - 6, cy - 1, 2, 1, C.white);
  rect(ctx, cx + 5, cy - 1, 2, 1, C.white);
  rect(ctx, cx - 7, cy, 1, 1, C.white);
  rect(ctx, cx + 7, cy, 1, 1, C.white);
  rect(ctx, cx - 6, cy + 1, 2, 1, C.white);
  rect(ctx, cx + 5, cy + 1, 2, 1, C.white);
  rect(ctx, cx - 4, cy + 2, 9, 1, C.white);
}

/** Rubber band while dragging on the ground to pick villagers. */
export function drawSelectionBox(ctx, x, y, w, h) {
  ctx.save();
  ctx.globalAlpha = 0.12;
  rect(ctx, x, y, w, h, C.white);
  ctx.globalAlpha = 0.9;
  rect(ctx, x, y, w, 1, C.white);
  rect(ctx, x, y + h, w + 1, 1, C.white);
  rect(ctx, x, y, 1, h, C.white);
  rect(ctx, x + w, y, 1, h, C.white);
  ctx.restore();
}

/** Pulsing ground glow under a villager that is waiting on the user. */
export function drawStatusRing(ctx, x, y, color, t) {
  const cx = Math.round(x);
  const cy = Math.round(y);
  ctx.save();
  ctx.globalAlpha = 0.3 + 0.25 * (Math.sin(t * 3) + 1) / 2;
  rect(ctx, cx - 6, cy - 1, 13, 1, color);
  rect(ctx, cx - 8, cy, 17, 1, color);
  rect(ctx, cx - 6, cy + 1, 13, 1, color);
  ctx.restore();
}

export function drawHighlightArrow(ctx, x, y, t) {
  const hop = Math.round(Math.abs(Math.sin(t * 6)) * 3);
  const ax = Math.round(x) - 3;
  const ay = Math.round(y) - hop;
  bitmap(ctx, ax, ay, ['#######', '.#####.', '..###..', '...#...'], { '#': '#facc15' });
  rect(ctx, ax, ay - 1, 7, 1, C.outline);
}

/** Dust or sparks where a villager strikes: work you can see from across the map. */
export function drawImpact(ctx, x, y, kind, t, seed) {
  const phase = (t * 3 + (seed % 7) / 7) % 1;
  if (phase > 0.45) return;
  const color = kind === 'sparks' ? (phase < 0.2 ? C.fireCore : C.fireHot) : kind === 'gold' ? C.goldGlint : '#d8c7a2';
  const spread = Math.round(phase * 8);
  rect(ctx, Math.round(x) - spread, Math.round(y) - 1 - spread, 1, 1, color);
  rect(ctx, Math.round(x) + spread, Math.round(y) - 2 - Math.round(spread / 2), 1, 1, color);
  rect(ctx, Math.round(x), Math.round(y) - 2 - spread, 1, 1, color);
}

// ---------- Terrain (static layer) ----------

export function drawGrass(ctx, x0, y0, w, h, salt = 0) {
  rect(ctx, x0, y0, w, h, C.grassA);
  for (let y = y0; y < y0 + h; y += 4) {
    for (let x = x0; x < x0 + w; x += 4) {
      const hsh = ihash(x * 73856093 + y * 19349663 + salt);
      if (hsh % 3 === 0) rect(ctx, x, y, 4, 4, C.grassB);
      if (hsh % 23 === 1) {
        rect(ctx, x + 1, y + 1, 1, 2, C.grassLight);
        rect(ctx, x + 2, y, 1, 2, C.grassLight);
      }
      if (hsh % 61 === 2) rect(ctx, x + 2, y + 2, 1, 1, hsh % 2 ? '#e8d36a' : '#d9708a');
      if (hsh % 29 === 3) rect(ctx, x, y + 3, 3, 1, C.grassDark);
    }
  }
}

export function drawRoad(ctx, x, y, w, h) {
  rect(ctx, x, y, w, h, C.dirt);
  const isHorizontal = w >= h;
  for (let i = 0; i < (isHorizontal ? w : h); i += 3) {
    const hsh = ihash(i * 31 + x * 7 + y * 13);
    const px = isHorizontal ? x + i : x + (hsh % Math.max(1, w));
    const py = isHorizontal ? y + (hsh % Math.max(1, h)) : y + i;
    if (hsh % 3 === 0) rect(ctx, px, py, 1, 1, C.dirtDark);
    if (hsh % 7 === 1) rect(ctx, px, py, 1, 1, C.dirtLight);
  }
  if (isHorizontal) {
    rect(ctx, x, y, w, 1, C.dirtDark);
    rect(ctx, x, y + h - 1, w, 1, C.dirtDark);
  } else {
    rect(ctx, x, y, 1, h, C.dirtDark);
    rect(ctx, x + w - 1, y, 1, h, C.dirtDark);
  }
}

/** Round-ish canopy tree; (x, y) is the trunk's foot. */
export function drawTree(ctx, x, y, size = 0) {
  const r = 5 + size;
  rect(ctx, x - r + 1, y - 1, r * 2 - 2, 2, C.shadow);
  rect(ctx, x - 1, y - 4, 2, 4, C.trunk);
  const cy = y - 4 - r;
  rect(ctx, x - r + 2, cy - r + 1, r * 2 - 4, r * 2, C.leafDark);
  rect(ctx, x - r + 1, cy - r + 3, r * 2 - 2, r * 2 - 4, C.leafDark);
  rect(ctx, x - r + 2, cy - r + 2, r * 2 - 5, r * 2 - 4, C.leaf);
  rect(ctx, x - r + 3, cy - r + 2, r - 1, r - 1, C.leafLight);
}

export function drawBush(ctx, x, y) {
  rect(ctx, x - 3, y - 1, 7, 2, C.shadow);
  rect(ctx, x - 3, y - 5, 7, 4, C.leafDark);
  rect(ctx, x - 2, y - 6, 5, 4, C.leaf);
  rect(ctx, x - 1, y - 6, 2, 1, C.leafLight);
}

export function drawRock(ctx, x, y, w = 6) {
  rect(ctx, x - 1, y - 1, w + 2, 2, C.shadow);
  rect(ctx, x, y - 4, w, 4, C.rockDark);
  rect(ctx, x + 1, y - 5, w - 2, 4, C.rock);
  rect(ctx, x + 1, y - 5, 2, 1, C.rockLight);
}

/** Bare earth patch with ragged edges, roughly an ellipse centered on (cx, cy). */
export function drawDirtPatch(ctx, cx, cy, rx, ry) {
  for (let dy = -ry; dy <= ry; dy += 2) {
    const half = Math.round(rx * Math.sqrt(1 - (dy / ry) ** 2));
    const jitter = ihash(cx * 7 + dy * 13) % 3;
    rect(ctx, cx - half - jitter, cy + dy, half * 2 + jitter * 2, 2, C.dirt);
    if (ihash(cy + dy) % 4 === 0) rect(ctx, cx - half + 3, cy + dy, 2, 1, C.dirtDark);
    if (ihash(cx + dy) % 5 === 0) rect(ctx, cx + half - 6, cy + dy + 1, 2, 1, C.dirtLight);
  }
}

export function drawBarrel(ctx, x, y) {
  rect(ctx, x - 1, y + 7, 8, 2, C.shadow);
  rect(ctx, x, y, 6, 8, C.wood);
  rect(ctx, x, y, 6, 1, C.woodLight);
  rect(ctx, x, y + 2, 6, 1, C.woodDark);
  rect(ctx, x, y + 5, 6, 1, C.woodDark);
  rect(ctx, x + 5, y + 1, 1, 7, C.woodDark);
}

export function drawCrate(ctx, x, y) {
  rect(ctx, x - 1, y + 6, 9, 2, C.shadow);
  rect(ctx, x, y, 7, 7, C.woodLight);
  rect(ctx, x, y, 7, 1, '#c9955e');
  rect(ctx, x, y + 6, 7, 1, C.woodDark);
  line(ctx, x, y + 1, x + 6, y + 6, C.wood);
}

export function drawPlaza(ctx, x0, y0, w, h) {
  rect(ctx, x0, y0, w, h, C.plaza);
  for (let y = y0; y < y0 + h; y += 4) {
    const offset = ((y - y0) / 4) % 2 ? 2 : 0;
    for (let x = x0 - offset; x < x0 + w; x += 5) {
      const hsh = ihash(x * 3 + y * 101);
      rect(ctx, Math.max(x0, x), y, 1, 4, C.plazaDark);
      if (hsh % 5 === 0) rect(ctx, Math.max(x0, x + 1), y + 1, 2, 2, C.plazaLight);
    }
    rect(ctx, x0, y, w, 1, C.plazaDark);
  }
}

/** A base's trampled ground: yard in front of the town center and paths to each work site. */
export function drawBaseGround(ctx, ox, oy, w, h, layout) {
  ctx.save();
  ctx.globalAlpha = 0.55;
  rect(ctx, ox + 6, oy + layout.yardY - 4, w - 12, 9, C.trodden);
  rect(ctx, ox + layout.gate.x - 4, oy + layout.yardY, 8, h - layout.yardY, C.trodden);
  for (const patch of layout.patches) rect(ctx, ox + patch[0], oy + patch[1], patch[2], patch[3], C.trodden);
  ctx.restore();
  drawPlaza(ctx, ox + layout.pen.x, oy + layout.pen.y, layout.pen.w, layout.pen.h);
}

/** One block of the waiting pen's low fence, its foot at (x, y): two rails and a post. */
export function drawFenceBlock(ctx, x, y, block) {
  const [x0, gy] = [Math.round(x) - 2, Math.round(y)];
  const rail = block.isAlongX ? C.woodLight : C.wood;
  rect(ctx, x0, gy - 4, 4, 1, rail);
  rect(ctx, x0, gy - 2, 4, 1, rail);
  if (block.isMerlon) rect(ctx, x0, gy - 5, 1, 5, C.woodDark);
}

// ---------- Buildings ----------

// ---------- Town center: era (how robust) x style (cities of Ragnarok Online) ----------

// The era is how big the repository's town center stands, as the ages of Age of Empires III.
export const ERAS = [
  { id: 1, name: 'Descobrimento', hint: 'Cabana de madeira' },
  { id: 2, name: 'Colonial', hint: 'Casa de alvenaria com telhado' },
  { id: 3, name: 'Fortaleza', hint: 'Ganha duas torres' },
  { id: 4, name: 'Industrial', hint: 'Bandeiras nas torres' },
  { id: 5, name: 'Imperial', hint: 'Acabamento em ouro e coroa maior' },
];

export const TOWN_STYLES = [
  { id: 'prontera', name: 'Prontera', hint: 'A capital: pedra cinza, torres com ameias' },
  { id: 'geffen', name: 'Geffen', hint: 'Cidade dos magos: ardósia, telhado agudo e cristal' },
  { id: 'payon', name: 'Payon', hint: 'Vila da montanha: madeira escura e telhados curvos' },
  { id: 'morroc', name: 'Morroc', hint: 'Deserto: arenito, cúpula e minaretes' },
  { id: 'aldebaran', name: 'Aldebaran', hint: 'Cidade do relógio: tijolo claro e torre do relógio' },
  { id: 'alberta', name: 'Alberta', hint: 'Porto mercante: tábuas caiadas, madeira azul e farol' },
  { id: 'lutie', name: 'Lutie', hint: 'Vila do Natal: neve no telhado, pingentes de gelo e pinheiro' },
  { id: 'einbroch', name: 'Einbroch', hint: 'Cidade do aço: tijolo escuro, telhado de fábrica e chaminés' },
  { id: 'juno', name: 'Juno', hint: 'Cidade dos sábios: mármore, colunas, frontão e cúpula' },
  { id: 'umbala', name: 'Umbala', hint: 'Aldeia da floresta: troncos, palha e a grande árvore' },
];

// The town center's proportions, in 2D and 3D; never wider or deeper than its era's, so it always
// fits the plot. Until the user picks one, the repository's name draws it, as the team color.
export const FORMS = [
  { id: 1, name: 'Padrão', hint: 'As proporções de sempre' },
  { id: 2, name: 'Comprido', hint: 'Salão raso e baixo, alongado' },
  { id: 3, name: 'Alto', hint: 'Sobrado estreito, com um andar a mais de janelas' },
  { id: 4, name: 'Atarracado', hint: 'Paredes baixas sob um telhadão' },
  { id: 5, name: 'Quadrado', hint: 'Planta quadrada, como um torreão' },
];

// How big the town center stands in the 3D view, at first from the repository's size and age.
export const SIZES = [
  { id: 1, name: 'Pequeno', hint: 'Centro da Cidade menor, sem muralha' },
  { id: 2, name: 'Médio', hint: 'O tamanho de sempre' },
  { id: 3, name: 'Grande', hint: 'Maior, com muralha e quatro torres atrás' },
  { id: 4, name: 'Colossal', hint: 'Muralha alta, torres maiores e torre de menagem' },
];

// The town center's free dimensions in the 3D view, in percent of what its form gives (100: as is).
export const DIMENSIONS = [
  { id: 'width', name: 'Largura', min: 70, max: 130 },
  { id: 'depth', name: 'Profundidade', min: 70, max: 130 },
  { id: 'height', name: 'Altura das paredes', min: 70, max: 160 },
];

export const DEFAULT_TOWN = { era: 2, style: 'prontera', size: 2, form: 1 };

// Everything a town center draws stays inside its 40 x 36 box, widened by this on each side and
// raised by TOWN_REACH_UP (spires, the clock tower, Geffen's crystal, Umbala's tree).
export const TOWN_REACH_SIDE = 5;
export const TOWN_REACH_UP = 18;

const ERA_SHAPES = [
  { bodyW: 24, bodyH: 13, windowDx: 7, roofH: 7, towerH: 0 },
  { bodyW: 30, bodyH: 17, windowDx: 10, roofH: 9, towerH: 0 },
  { bodyW: 32, bodyH: 18, windowDx: 10, roofH: 10, towerH: 26 },
  { bodyW: 34, bodyH: 19, windowDx: 11, roofH: 11, towerH: 29 },
  { bodyW: 36, bodyH: 20, windowDx: 12, roofH: 12, towerH: 32 },
];

// How each form changes the era's body in 2D (rows and columns added); Alto gets a second row of windows.
const FORM_SHAPES = {
  1: { w: 0, h: 0, roof: 0 },
  2: { w: 0, h: -3, roof: -2 },
  3: { w: -4, h: 5, roof: 1, isTall: true },
  4: { w: -2, h: -3, roof: 3 },
  5: { w: -6, h: 2, roof: 2 },
};
const MIN_BODY_W = 22; // a window each side of the door
// On grown land (design.growth, from plot.js: k 0 › 1) the town center grows with it, by these
// fractions at k = 1: taller walls and roof (the towers follow), a second row of windows past half
// again its height, and a wider body only while it spans no more than the imperial one with its
// towers, so the bell and the builders at its wall stay clear.
const GROW_2D = { w: 0.3, h: 0.6, roof: 0.4 };
const MAX_TOWN_SPAN = 48;
// A half-lot core's town center (design.growth.isSmall) stands at this fraction, spanning no more
// than SMALL_TOWN_SPAN with its towers, so its little mine and forge stay clear.
const SMALL_TOWN = 0.8;
const SMALL_TOWN_SPAN = 34;

const STYLE_ART = {
  prontera: { wall: C.stone, light: C.stoneLight, dark: C.stoneDark, trim: C.woodDark, texture: 'stone' },
  geffen: { wall: '#6d7192', light: '#9095b6', dark: '#4a4d68', trim: '#2f2b45', texture: 'slate' },
  payon: { wall: '#e4d6b2', light: '#f3ead2', dark: '#b3a07a', trim: '#4a2e1a', texture: 'timber' },
  morroc: { wall: '#d9b77e', light: '#efd6a4', dark: '#ae8c56', trim: '#7a5a30', texture: 'sand', isArched: true },
  aldebaran: { wall: '#ddd3bf', light: '#f2ecdd', dark: '#a59a84', trim: '#5e4b3a', texture: 'brick' },
  alberta: { wall: '#ece6d6', light: '#fbf8ef', dark: '#bdb39c', trim: '#2f5d7c', texture: 'clapboard' },
  lutie: { wall: '#b5654a', light: '#d1876a', dark: '#8a4634', trim: '#f4f4f0', texture: 'clapboard' },
  einbroch: { wall: '#7b5b4c', light: '#977563', dark: '#563e33', trim: '#3b3f4a', texture: 'brick' },
  juno: { wall: '#eeeae0', light: '#ffffff', dark: '#c4bdac', trim: '#8a7d5e', texture: 'marble' },
  umbala: { wall: '#7a5230', light: '#9b6c40', dark: '#553820', trim: '#3d2a17', texture: 'logs' },
};

/** The form a repository's name draws until the user picks one. */
export function formFor(project) {
  return pick(FORMS, hashString(project) >>> 11).id;
}

// The era's body stretched by the form and grown with the land. windowY is how high above the
// ground the windows start; lift is how much taller the land made it.
function townShape(design) {
  const index = Math.min(ERA_SHAPES.length - 1, Math.max(0, Math.round(Number(design.era) || DEFAULT_TOWN.era) - 1));
  const base = ERA_SHAPES[index];
  const form = FORM_SHAPES[design.form] ?? FORM_SHAPES[DEFAULT_TOWN.form];
  const isHut = index === 0;
  const { k = 0, isSmall = false } = design.growth ?? {};
  const shrink = (value) => (isSmall ? Math.round(value * SMALL_TOWN) : value);
  const span = (isSmall ? SMALL_TOWN_SPAN : MAX_TOWN_SPAN) - (base.towerH ? 12 : 2);
  const formW = Math.max(MIN_BODY_W, Math.min(Math.round(shrink(base.bodyW + form.w) / 2) * 2, span));
  const grownW = Math.max(0, Math.min(Math.round((formW * k * GROW_2D.w) / 2) * 2, span - formW));
  const formH = shrink(base.bodyH + form.h);
  const formRoof = shrink(base.roofH + form.roof);
  const grownH = Math.round(formH * k * GROW_2D.h);
  const grownRoof = Math.round(formRoof * k * GROW_2D.roof);
  const bodyW = formW + grownW;
  const bodyH = formH + grownH;
  const windowDx = Math.min(Math.max(base.windowDx + Math.round(form.w / 3) + Math.round(grownW / 3), isHut ? 7 : 8), Math.floor(bodyW / 2) - 4);
  const windowY = Math.min(isHut ? 10 : 12, bodyH - 2);
  const isTall = form.isTall || bodyH > shrink(base.bodyH) * 1.5;
  const upperY = isTall && windowY + 7 < bodyH ? windowY + 7 : 0;
  const towerH = base.towerH && shrink(base.towerH) + grownH + grownRoof;
  return { ...base, era: index + 1, bodyW, bodyH, roofH: formRoof + grownRoof, towerH, windowDx, windowY, upperY, lift: grownH + grownRoof };
}

function townArt(style) {
  return STYLE_ART[style] ?? STYLE_ART[DEFAULT_TOWN.style];
}

/** How far above the door's foot a town center's roof ridge stands (spires and towers aside). */
export function townCenterHeight(design = DEFAULT_TOWN) {
  const shape = townShape(design);
  return shape.bodyH + shape.roofH;
}

/** How much taller than its 40 x 36 box a town center stands on grown land. */
export function townCenterLift(design = DEFAULT_TOWN) {
  return townShape(design).lift;
}

/** Window lights of a town center, relative to its 40 x 36 box, for the night glow. */
export function townCenterLights(design = DEFAULT_TOWN) {
  const shape = townShape(design);
  const y = 36 - shape.windowY + 2.5;
  const lights = [-1, 1].map((side) => ({ x: 20 + side * shape.windowDx + 0.5, y, r: 9, color: '#fcd77a' }));
  if (shape.upperY) for (const dx of [-shape.windowDx, 0, shape.windowDx]) lights.push({ x: 20 + dx + 0.5, y: 36 - shape.upperY + 2.5, r: 8, color: '#fcd77a' });
  const roofTop = 36 - shape.bodyH + 1 - shape.roofH;
  if (design.style === 'alberta' && shape.era >= 2) {
    const lamp = albertaLamp(20, 36 - shape.bodyH + 1, shape);
    lights.push({ x: lamp.x + 2.5, y: lamp.y + 1.5, r: 14, color: '#fde68a' });
  }
  if (design.style === 'geffen' && shape.era >= 2) lights.push({ x: 20, y: roofTop - 5 - shape.era * 2, r: 12, color: '#7dd3fc' }); // the crystal
  if (design.style === 'payon' && shape.era >= 2) {
    for (const side of [-1, 1]) lights.push({ x: 20 + side * (shape.bodyW / 2 + 1), y: 36 - shape.bodyH + 4, r: 7, color: '#f87171' });
  }
  return lights;
}

/**
 * Town center in a 40 x 36 box at (ox, oy); the door's foot is at (ox + 20, oy + 36). The era sets
 * how robust it stands (hut, house, towers, flags, gold) and the style its city.
 */
export function drawTownCenter(ctx, ox, oy, team, isNight, rise = 1, design = DEFAULT_TOWN, t = 0) {
  const shape = townShape(design);
  const art = townArt(design.style);
  const style = STYLE_ART[design.style] ? design.style : DEFAULT_TOWN.style;
  const cx = ox + 20;
  const gy = oy + 36;
  ctx.save();
  if (rise < 1) {
    // being founded: rises from the ground
    const shown = Math.max(1, Math.round((36 + TOWN_REACH_UP + shape.lift) * rise));
    ctx.beginPath();
    ctx.rect(ox - TOWN_REACH_SIDE - 2, gy - shown, 40 + 2 * TOWN_REACH_SIDE + 4, shown + 2);
    ctx.clip();
  }
  const span = shape.bodyW + (shape.towerH ? 12 : 2);
  rect(ctx, cx - span / 2, gy - 1, span, 2, C.shadow);
  const roofBase = gy - shape.bodyH + 1;
  if (style === 'umbala' && shape.era >= 2) drawUmbalaTree(ctx, cx, roofBase - shape.roofH - 1, shape); // behind the hut
  drawTownBody(ctx, cx, gy, shape, art, isNight);
  TOWN_ROOFS[style](ctx, cx, roofBase, shape, art, team, t);
  if (shape.era >= 5) rect(ctx, cx - shape.bodyW / 2 - 1, roofBase - 1, shape.bodyW + 2, 1, C.gold);
  if (shape.towerH) {
    for (const side of [-1, 1]) drawTownTower(ctx, cx + side * (shape.bodyW / 2 + 1) - (side < 0 ? 5 : 2), gy, shape, art, style, team, isNight, t);
  }
  ctx.restore();
}

function drawTownBody(ctx, cx, gy, shape, art, isNight) {
  const isHut = shape.era === 1;
  const x0 = cx - shape.bodyW / 2;
  const y0 = gy - shape.bodyH;
  const w = shape.bodyW;
  const h = shape.bodyH;
  // A hut is planks, except in the desert, where it is mud brick.
  const wall = isHut && !art.isArched ? C.wood : art.wall;
  const light = isHut && !art.isArched ? C.woodLight : art.light;
  const dark = isHut && !art.isArched ? C.woodDark : art.dark;
  rect(ctx, x0, y0, w, h, wall);
  rect(ctx, x0, y0, w, 1, light);
  rect(ctx, x0 + w - 1, y0, 1, h, dark);
  rect(ctx, x0, gy - 2, w, 2, dark);
  if (isHut && !art.isArched) {
    for (let x = x0 + 3; x < x0 + w - 1; x += 4) rect(ctx, x, y0 + 1, 1, h - 3, dark);
  } else {
    drawWallTexture(ctx, art.texture, x0, y0, w, h, art);
  }
  const glass = isNight ? C.windowLit : C.windowDark;
  const drawWindow = (wx, wy) => {
    rect(ctx, wx, wy, 5, 5, art.trim);
    rect(ctx, wx + 1, wy + 1, 3, 3, glass);
    if (art.texture === 'timber') rect(ctx, wx + 2, wy + 1, 1, 3, art.trim);
  };
  for (const side of [-1, 1]) drawWindow(cx + side * shape.windowDx - 2, gy - shape.windowY);
  if (shape.upperY) for (const dx of [-shape.windowDx, 0, shape.windowDx]) drawWindow(cx + dx - 2, gy - shape.upperY);
  const dw = isHut ? 6 : 8;
  const dh = isHut ? 8 : 11;
  rect(ctx, cx - dw / 2 - 1, gy - dh - 1, dw + 2, dh + 1, art.trim);
  rect(ctx, cx - dw / 2, gy - dh, dw, dh, C.doorDark);
  rect(ctx, cx, gy - dh + 1, 1, dh - 1, '#2a1c10');
  if (art.isArched) {
    rect(ctx, cx - dw / 2 - 1, gy - dh - 1, 2, 1, wall);
    rect(ctx, cx + dw / 2 - 1, gy - dh - 1, 2, 1, wall);
    rect(ctx, cx - dw / 2, gy - dh, 1, 1, art.trim);
    rect(ctx, cx + dw / 2 - 1, gy - dh, 1, 1, art.trim);
  }
}

function drawWallTexture(ctx, texture, x0, y0, w, h, art) {
  if (texture === 'stone') {
    for (let i = 0; i < Math.round((w * h) / 70); i++) {
      const hsh = ihash(i + 11);
      rect(ctx, x0 + 2 + (hsh % (w - 6)), y0 + 3 + ((hsh >>> 5) % (h - 6)), 3, 1, art.dark);
    }
    rect(ctx, x0, y0 + 1, 1, h - 3, C.woodDark);
    rect(ctx, x0 + w - 1, y0 + 1, 1, h - 3, C.woodDark);
    rect(ctx, x0, y0 + 5, w, 1, C.woodDark);
  } else if (texture === 'slate') {
    for (let y = y0 + 4; y < y0 + h - 2; y += 4) {
      rect(ctx, x0 + 1, y, w - 2, 1, art.dark);
      for (let x = x0 + ((y - y0) % 8 ? 3 : 6); x < x0 + w - 1; x += 7) rect(ctx, x, y + 1, 1, 3, art.dark);
    }
  } else if (texture === 'timber') {
    rect(ctx, x0, y0 + 1, w, 2, art.trim);
    for (let x = x0; x < x0 + w; x += 7) rect(ctx, x, y0 + 1, 2, h - 3, art.trim);
    rect(ctx, x0 + w - 2, y0 + 1, 2, h - 3, art.trim);
  } else if (texture === 'sand') {
    rect(ctx, x0 + 1, y0 + 3, w - 2, 1, art.light);
    for (let i = 0; i < Math.round((w * h) / 60); i++) {
      const hsh = ihash(i + 47);
      rect(ctx, x0 + 2 + (hsh % (w - 4)), y0 + 5 + ((hsh >>> 5) % (h - 8)), 1, 1, art.dark);
    }
  } else if (texture === 'brick') {
    for (let y = y0 + 3; y < y0 + h - 2; y += 3) {
      rect(ctx, x0 + 1, y, w - 2, 1, art.dark);
      for (let x = x0 + ((y - y0) % 6 ? 2 : 5); x < x0 + w - 1; x += 6) rect(ctx, x, y + 1, 1, 2, art.dark);
    }
  } else if (texture === 'clapboard') {
    // lapped boards, corner boards in the trim color
    for (let y = y0 + 3; y < y0 + h - 2; y += 3) rect(ctx, x0 + 1, y, w - 2, 1, art.dark);
    rect(ctx, x0, y0 + 1, 2, h - 3, art.trim);
    rect(ctx, x0 + w - 2, y0 + 1, 2, h - 3, art.trim);
  } else if (texture === 'marble') {
    // pilasters under a cornice
    rect(ctx, x0, y0 + 2, w, 1, art.dark);
    for (let x = x0 + 2; x < x0 + w - 2; x += 6) {
      rect(ctx, x, y0 + 3, 2, h - 5, art.light);
      rect(ctx, x + 2, y0 + 3, 1, h - 5, art.dark);
    }
  } else if (texture === 'logs') {
    // stacked logs, their round ends past the corners
    for (let y = y0 + 1; y < y0 + h - 2; y += 3) {
      rect(ctx, x0, y, w, 1, art.light);
      rect(ctx, x0, y + 2, w, 1, art.dark);
      for (const x of [x0 - 1, x0 + w - 1]) rect(ctx, x, y, 2, 2, art.trim);
    }
  }
}

// A gabled roof, `height` rows over baseY, narrowing from `width` at the eave to `width * top`.
function drawGableRoof(ctx, cx, baseY, width, height, team, top) {
  const [roof, shade] = team;
  const light = mix(roof, '#ffffff', 0.35);
  for (let i = 0; i < height; i++) {
    const f = height === 1 ? 1 : i / (height - 1);
    const w = Math.max(2, 2 * Math.round((width * (top + (1 - top) * f)) / 2));
    const y = baseY - height + i;
    const isStripe = i > 0 && (height - i) % 3 === 0;
    rect(ctx, cx - w / 2, y, w, 1, i === 0 ? light : isStripe ? shade : roof);
    const side = Math.max(1, Math.round(w / 6));
    rect(ctx, cx + w / 2 - side, y, side, 1, shade);
  }
  rect(ctx, cx - width / 2, baseY - 1, width, 1, shade);
  return baseY - height;
}

// One tier of a Payon roof: eave with upturned tips, then rows narrowing to the ridge.
function drawPagodaTier(ctx, cx, baseY, width, team) {
  const [roof, shade] = team;
  rect(ctx, cx - width / 2, baseY - 1, width, 1, shade);
  rect(ctx, cx - width / 2 - 1, baseY - 3, 1, 2, roof);
  rect(ctx, cx + width / 2, baseY - 3, 1, 2, roof);
  rect(ctx, cx - width / 2, baseY - 2, width, 1, roof);
  rect(ctx, cx - width / 2 + 2, baseY - 3, width - 4, 1, roof);
  if (width <= 12) return baseY - 3;
  rect(ctx, cx - width / 2 + 4, baseY - 4, width - 8, 1, roof);
  rect(ctx, cx - width / 2 + 7, baseY - 5, width - 14, 1, mix(roof, '#ffffff', 0.3));
  rect(ctx, cx + width / 2 - 8, baseY - 4, 4, 1, shade);
  return baseY - 5;
}

function drawDome(ctx, cx, baseY, radius, team) {
  const [roof, shade] = team;
  for (let dy = 0; dy < radius; dy++) {
    const half = Math.max(1, Math.round(Math.sqrt(radius * radius - dy * dy)));
    const y = baseY - 1 - dy;
    rect(ctx, cx - half, y, half * 2, 1, roof);
    rect(ctx, cx + half - Math.max(1, Math.round(half / 2)), y, Math.max(1, Math.round(half / 2)), 1, shade);
    if (dy > 1) rect(ctx, cx - half + 1, y, 1, 1, mix(roof, '#ffffff', 0.4));
  }
  rect(ctx, cx, baseY - radius - 3, 1, 3, C.gold);
  return baseY - radius - 3;
}

function drawChimneySmoke(ctx, x, y, t) {
  rect(ctx, x, y, 4, 5, C.stoneDark);
  rect(ctx, x, y, 4, 1, C.stoneLight);
  for (let i = 0; i < 2; i++) {
    const rise = (t * 4 + i * 5) % 10;
    rect(ctx, x + 1 + Math.round(Math.sin(t * 2 + i) * 1.2), y - 2 - Math.floor(rise), 2, 2, `rgba(210, 210, 210, ${0.45 - rise / 25})`);
  }
}

// Alberta's lighthouse stands behind the ridge, right of center; its lamp room (5 x 3) is here.
function albertaLamp(cx, baseY, shape) {
  return { x: cx + Math.round(shape.bodyW / 4) - 2, y: baseY - shape.roofH - shape.era * 2 - 3 };
}

// A factory smokestack, `h` rows down from `top`, puffing dark smoke.
function drawSmokestack(ctx, x, top, h, t) {
  rect(ctx, x, top, 4, h, '#4a4f5c');
  rect(ctx, x, top, 1, h, '#6b7180');
  for (let y = top + 4; y < top + h; y += 5) rect(ctx, x, y, 4, 1, '#2d3039');
  rect(ctx, x - 1, top, 6, 1, '#2d3039');
  for (let i = 0; i < 3; i++) {
    const rise = (t * 5 + i * 4 + x) % 12;
    const size = 2 + Math.floor(rise / 5);
    rect(ctx, x + 1 + Math.round(Math.sin(t * 1.5 + i + x) * 1.5) - (size - 2) / 2, top - 2 - Math.floor(rise), size, size, `rgba(70, 70, 76, ${0.55 - rise / 24})`);
  }
}

// Umbala's great tree: the trunk hides behind the hut, the crown spreads over the ridge at `ridgeY`.
function drawUmbalaTree(ctx, cx, ridgeY, shape) {
  const r = 5 + shape.era;
  const cy = ridgeY + 4 - r;
  rect(ctx, cx - 2, cy, 4, ridgeY - cy + 4, C.trunk);
  for (const [dx, dy, k] of [[-r * 0.6, 2, 0.7], [r * 0.6, 2, 0.7], [0, 0, 1]]) {
    const rr = Math.round(r * k);
    const bx = Math.round(cx + dx);
    for (let y = -rr; y <= rr; y++) {
      const half = Math.round(Math.sqrt(rr * rr - y * y)) + (ihash(bx * 31 + y) % 2);
      const row = cy + dy + y;
      rect(ctx, bx - half, row, half * 2, 1, y < -rr / 3 ? C.leafLight : y > rr / 3 ? C.leafDark : C.leaf);
      if (half > 2 && ihash(bx + y * 7) % 3 === 0) rect(ctx, bx - half + 1 + (ihash(y + bx) % (half * 2 - 2)), row, 1, 1, C.leafLight);
    }
  }
}

// Thatch: straw with a tint of the team color (the ridge cap carries the color itself).
function thatchOf(team) {
  return [mix(team[0], C.hay, 0.8), mix(team[1], C.hayDark, 0.8)];
}

// Recolors the top `rows` of a roof drawGableRoof drew (snow, a ridge cap), on the same slope.
function drawGableCap(ctx, cx, roofTop, width, height, top, rows, colors) {
  const capW = 2 * Math.round((width * (top + (1 - top) * ((rows - 1) / (height - 1)))) / 2);
  drawGableRoof(ctx, cx, roofTop + rows, capW, rows, colors, (width * top) / capW);
}

const SNOW = ['#f4f4f0', '#cfd8e3'];

const TOWN_ROOFS = {
  prontera(ctx, cx, baseY, shape, art, team, t) {
    if (shape.era >= 2) drawChimneySmoke(ctx, cx + Math.round(shape.bodyW / 4), baseY - shape.roofH - 3, t);
    const top = drawGableRoof(ctx, cx, baseY, shape.bodyW + 6, shape.roofH, team, 0.55);
    if (shape.era < 5) return;
    // Imperial: a crowned turret on the ridge
    rect(ctx, cx - 3, top - 5, 6, 6, art.wall);
    rect(ctx, cx - 3, top - 5, 6, 1, art.light);
    for (let x = cx - 3; x < cx + 3; x += 2) rect(ctx, x, top - 7, 1, 2, art.light);
    rect(ctx, cx - 1, top - 3, 2, 3, C.windowDark);
    rect(ctx, cx, top - 12, 1, 5, C.woodDark);
    rect(ctx, cx + 1, top - 12, 4, 3, team[0]);
  },
  geffen(ctx, cx, baseY, shape, art, team, t) {
    const purple = [mix(team[0], '#5b3fa0', 0.25), mix(team[1], '#3b2370', 0.35)];
    const top = drawGableRoof(ctx, cx, baseY, shape.bodyW + 4, shape.roofH + 3, purple, 0.06);
    if (shape.era < 2) return;
    // the mages' spire with its crystal, glowing brighter the bigger the town
    const spire = shape.era * 2;
    rect(ctx, cx - 2, top - spire, 4, spire + 3, art.wall);
    rect(ctx, cx - 2, top - spire, 1, spire + 3, art.light);
    rect(ctx, cx + 1, top - spire, 1, spire + 3, art.dark);
    const pulse = 0.55 + 0.45 * Math.sin(t * 3);
    const cy = top - spire - 4;
    rect(ctx, cx - 1, cy, 2, 4, '#7dd3fc');
    rect(ctx, cx - 2, cy + 1, 4, 2, '#38bdf8');
    ctx.save();
    ctx.globalAlpha = pulse;
    rect(ctx, cx - 1, cy + 1, 1, 1, '#e0f2fe');
    ctx.restore();
  },
  payon(ctx, cx, baseY, shape, art, team) {
    const tiers = shape.era <= 2 ? 1 : shape.era <= 4 ? 2 : 3;
    let width = shape.bodyW + 8;
    let y = drawPagodaTier(ctx, cx, baseY, width, team);
    for (let i = 1; i < tiers; i++) {
      width -= 10;
      rect(ctx, cx - width / 2 + 3, y - 3, width - 6, 4, art.trim);
      rect(ctx, cx - 2, y - 2, 4, 2, C.windowDark);
      y = drawPagodaTier(ctx, cx, y - 2, width, team);
    }
    rect(ctx, cx, y - 2, 1, 2, C.gold);
    if (shape.era < 2) return;
    // red lanterns under the eaves
    for (const side of [-1, 1]) {
      const lx = cx + side * (shape.bodyW / 2 + 1) - 1;
      rect(ctx, lx + 1, baseY, 1, 2, C.outline);
      rect(ctx, lx, baseY + 2, 3, 4, '#dc2626');
      rect(ctx, lx, baseY + 2, 3, 1, C.gold);
      rect(ctx, lx + 1, baseY + 3, 1, 2, '#fca5a5');
    }
  },
  morroc(ctx, cx, baseY, shape, art, team) {
    const x0 = cx - shape.bodyW / 2;
    // flat roof with a parapet
    for (let x = x0; x < x0 + shape.bodyW; x += 4) rect(ctx, x, baseY - 3, 2, 2, art.light);
    rect(ctx, x0, baseY - 1, shape.bodyW, 1, art.dark);
    if (shape.era < 2) return;
    const radius = [0, 6, 7, 8, 9][shape.era - 1];
    rect(ctx, cx - radius, baseY - 4, radius * 2, 3, art.wall);
    rect(ctx, cx - radius, baseY - 4, radius * 2, 1, art.light);
    drawDome(ctx, cx, baseY - 4, radius, team);
    if (shape.era < 3) return;
    // striped awnings over the windows
    for (const side of [-1, 1]) {
      const ax = cx + side * shape.windowDx - 3;
      for (let i = 0; i < 7; i++) rect(ctx, ax + i, baseY + 4, 1, 2, i % 2 ? C.white : team[0]);
    }
  },
  aldebaran(ctx, cx, baseY, shape, art, team, t) {
    const roofTop = drawGableRoof(ctx, cx, baseY, shape.bodyW + 4, shape.roofH + 1, team, 0.12);
    if (shape.era < 2) return;
    // the clock tower rises through the ridge
    const extra = [0, 2, 4, 6, 7][shape.era - 1];
    const top = roofTop - extra;
    rect(ctx, cx - 5, top, 10, baseY - top, art.wall);
    rect(ctx, cx - 5, top, 1, baseY - top, art.light);
    rect(ctx, cx + 4, top, 1, baseY - top, art.dark);
    rect(ctx, cx - 3, top + 2, 6, 6, C.outline);
    rect(ctx, cx - 2, top + 3, 4, 4, C.white);
    rect(ctx, cx - 3, top + 3, 1, 4, C.white);
    rect(ctx, cx + 2, top + 3, 1, 4, C.white);
    rect(ctx, cx - 2, top + 2, 4, 1, C.white);
    rect(ctx, cx - 2, top + 7, 4, 1, C.white);
    rect(ctx, cx - 1, top + 3, 1, 2, C.outline); // hour hand
    const tick = Math.floor(t / 2) % 4; // minute hand sweeps around
    const hands = [[-1, 3, 1, 2], [0, 4, 2, 1], [-1, 5, 1, 2], [-3, 4, 2, 1]];
    const [hx, hy, hw, hh] = hands[tick];
    rect(ctx, cx + hx, top + hy, hw, hh, '#b91c1c');
    drawGableRoof(ctx, cx, top + 1, 12, 6, team, 0.08);
    if (shape.era >= 5) rect(ctx, cx - 1, top - 8, 1, 3, C.gold);
  },
  alberta(ctx, cx, baseY, shape, art, team, t) {
    if (shape.era >= 2) {
      // the harbor's lighthouse behind the ridge: red and white bands, the lamp turning
      const lamp = albertaLamp(cx, baseY, shape);
      for (let y = lamp.y + 3; y < baseY - 2; y++) rect(ctx, lamp.x, y, 5, 1, Math.floor((y - lamp.y - 3) / 3) % 2 ? '#c0392b' : C.white);
      rect(ctx, lamp.x + 4, lamp.y + 3, 1, baseY - lamp.y - 5, 'rgba(0, 0, 0, 0.18)');
      rect(ctx, lamp.x - 1, lamp.y + 3, 7, 1, art.trim);
      rect(ctx, lamp.x, lamp.y, 5, 3, art.trim);
      rect(ctx, lamp.x + 1, lamp.y, 3, 3, '#fde68a');
      rect(ctx, lamp.x + 1 + (Math.floor(t * 4) % 3), lamp.y + 1, 1, 1, C.white);
      drawTowerCap(ctx, lamp.x - 1, lamp.y, [7, 5, 3], team);
    }
    drawGableRoof(ctx, cx, baseY, shape.bodyW + 6, shape.roofH, team, 0.4);
  },
  lutie(ctx, cx, baseY, shape, art, team, t) {
    if (shape.era >= 2) drawChimneySmoke(ctx, cx - Math.round(shape.bodyW / 4) - 2, baseY - shape.roofH - 2, t);
    const width = shape.bodyW + 6;
    const height = shape.roofH + 2;
    const top = drawGableRoof(ctx, cx, baseY, width, height, team, 0.1);
    // snow over the upper rows of the roof, icicles under the eave
    drawGableCap(ctx, cx, top, width, height, 0.1, Math.ceil(height * 0.45), SNOW);
    for (let x = cx - width / 2 + 1; x < cx + width / 2 - 1; x += 3) rect(ctx, x, baseY, 1, 1 + (ihash(x) % 2), '#e0f2fe');
    if (shape.era < 5) return;
    // Imperial: a gold star on the ridge
    rect(ctx, cx - 1, top - 2, 3, 1, C.gold);
    rect(ctx, cx, top - 3, 1, 3, C.gold);
  },
  einbroch(ctx, cx, baseY, shape, art, team, t) {
    const x0 = cx - shape.bodyW / 2;
    // smokestacks behind a sawtooth factory roof, glass on each tooth's upright face
    const stackH = 4 + shape.era * 2;
    const stacks = shape.era >= 3 ? [x0 + 3, x0 + shape.bodyW - 7] : [x0 + shape.bodyW - 7];
    for (const sx of stacks) drawSmokestack(ctx, sx, baseY - 4 - stackH, stackH + 2, t);
    rect(ctx, x0 - 1, baseY - 2, shape.bodyW + 2, 2, art.trim);
    const [roof, shade] = team;
    const teeth = Math.floor(shape.bodyW / 6);
    for (let k = 0, x = x0 + Math.floor((shape.bodyW - teeth * 6) / 2); k < teeth; k++, x += 6) {
      for (let j = 0; j < 3; j++) rect(ctx, x + j * 2, baseY - 3 - j, 5 - j * 2, 1, j ? roof : shade);
      rect(ctx, x + 5, baseY - 5, 1, 3, '#6b8fb0');
    }
  },
  juno(ctx, cx, baseY, shape, art, team) {
    if (shape.era >= 3) {
      // the sages' dome rises behind the pediment
      const radius = shape.era + 3;
      rect(ctx, cx - radius, baseY - 6, radius * 2, 5, art.wall);
      rect(ctx, cx - radius, baseY - 6, radius * 2, 1, art.light);
      for (let x = cx - radius + 2; x < cx + radius - 1; x += 3) rect(ctx, x, baseY - 5, 1, 4, art.dark);
      drawDome(ctx, cx, baseY - 6, radius, [team[1], mix(team[1], '#000000', 0.2)]);
    }
    const width = shape.bodyW + 4;
    drawGableRoof(ctx, cx, baseY, width, Math.max(4, shape.roofH - 3), team, 0.04);
    rect(ctx, cx - width / 2, baseY - 1, width, 1, art.light);
    rect(ctx, cx - width / 2, baseY, width, 1, art.dark);
  },
  umbala(ctx, cx, baseY, shape, art, team) {
    const width = shape.bodyW + 8;
    const top = drawGableRoof(ctx, cx, baseY, width, shape.roofH + 1, thatchOf(team), 0.2);
    drawGableCap(ctx, cx, top, width, shape.roofH + 1, 0.2, 3, team);
    // ragged straw along the eave
    for (let x = cx - width / 2; x < cx + width / 2; x += 2) rect(ctx, x, baseY, 1, 1 + (ihash(x * 5) % 2), C.hayDark);
  },
};

// Pointed or round cap over a 7-wide tower: one centered row per width, from the bottom up.
function drawTowerCap(ctx, tx, top, widths, team) {
  const [roof, shade] = team;
  widths.forEach((w, i) => {
    const x = tx + (7 - w) / 2;
    rect(ctx, x, top - 1 - i, w, 1, i === widths.length - 1 ? mix(roof, '#ffffff', 0.35) : roof);
    if (w > 2) rect(ctx, x + w - 1, top - 1 - i, 1, 1, shade);
  });
  return top - widths.length - 1;
}

// Corner tower, 7 wide, from the ground up to the era's height, capped in the city's style.
function drawTownTower(ctx, tx, gy, shape, art, style, team, isNight, t) {
  const top = gy - shape.towerH;
  rect(ctx, tx, top, 7, shape.towerH, art.wall);
  rect(ctx, tx, top, 1, shape.towerH, art.light);
  rect(ctx, tx + 6, top, 1, shape.towerH, art.dark);
  rect(ctx, tx, gy - 2, 7, 2, art.dark);
  if (art.texture === 'timber') rect(ctx, tx, top + 4, 7, 1, art.trim);
  if (['brick', 'clapboard', 'logs'].includes(art.texture)) for (let y = top + 3; y < gy - 2; y += 3) rect(ctx, tx + 1, y, 5, 1, art.dark);
  rect(ctx, tx + 3, top + 6, 1, 3, isNight ? C.windowLit : C.windowDark);
  rect(ctx, tx + 3, top + 14, 1, 3, isNight ? C.windowLit : C.windowDark);
  let capTop = top;
  const [roof, shade] = team;
  if (style === 'prontera') {
    for (let x = tx; x < tx + 7; x += 2) rect(ctx, x, top - 2, 1, 2, art.light);
    capTop = top - 2;
  } else if (style === 'geffen') {
    capTop = drawTowerCap(ctx, tx, top, [9, 7, 7, 5, 5, 3, 3, 1], team);
  } else if (style === 'payon') {
    capTop = drawPagodaTier(ctx, tx + 3.5, top + 1, 9, team) - 1;
  } else if (style === 'morroc') {
    rect(ctx, tx - 1, top + 3, 9, 2, art.trim);
    capTop = drawTowerCap(ctx, tx, top, [7, 7, 5, 3], team);
    rect(ctx, tx + 3, capTop - 3, 1, 3, C.gold);
    capTop -= 3;
  } else if (style === 'lutie') {
    capTop = drawTowerCap(ctx, tx, top, [9, 7, 7, 5, 5, 3, 3, 1], team);
    drawTowerCap(ctx, tx, top - 5, [3, 3, 1], SNOW);
  } else if (style === 'einbroch') {
    // a flat iron top with a stack of its own
    rect(ctx, tx - 1, top - 2, 9, 2, art.trim);
    rect(ctx, tx + 2, top - 6, 3, 4, '#4a4f5c');
    capTop = top - 6;
  } else if (style === 'juno') {
    rect(ctx, tx - 1, top - 1, 9, 1, art.light);
    capTop = drawTowerCap(ctx, tx, top - 1, [7, 7, 5, 3], team);
  } else if (style === 'umbala') {
    capTop = drawTowerCap(ctx, tx, top, [9, 9, 7, 5, 3, 1], thatchOf(team));
  } else {
    capTop = drawTowerCap(ctx, tx, top, [7, 7, 5, 5, 3, 1], team);
  }
  if (shape.era >= 5 && style !== 'morroc') rect(ctx, tx + 3, capTop - 2, 1, 2, C.gold);
  if (shape.era >= 4) {
    // flags on the towers
    const flap = Math.floor(t * 3 + tx) % 2;
    const poleTop = capTop - 8;
    rect(ctx, tx + 3, poleTop, 1, 8, C.woodDark);
    rect(ctx, tx + 4, poleTop, 4, 3, roof);
    rect(ctx, tx + 8, poleTop + flap, 1, 2, roof);
    rect(ctx, tx + 4, poleTop + 3, 4, 1, shade);
  }
}

/** Team banner on a pole; (x, y) is the pole's foot. */
export function drawBanner(ctx, x, y, team, t, isLowered = false) {
  const [color, shade] = team;
  rect(ctx, x - 1, y - 1, 3, 2, C.shadow);
  rect(ctx, x, y - 28, 1, 28, C.woodDark);
  rect(ctx, x, y - 29, 1, 1, C.gold);
  if (isLowered) {
    // a quiet base: the flag hangs limp at the foot of the pole
    rect(ctx, x + 1, y - 13, 3, 8, color);
    rect(ctx, x + 1, y - 5, 2, 1, color);
    rect(ctx, x + 3, y - 13, 1, 7, shade);
    return;
  }
  const flap = Math.floor(t * 3) % 2;
  rect(ctx, x + 1, y - 27, 7, 5, color);
  rect(ctx, x + 1, y - 22, 7, 1, shade);
  rect(ctx, x + 8, y - 27 + flap, 1, 4, color);
  rect(ctx, x + 3, y - 25, 3, 1, C.white);
}

/**
 * Town bell on its own post beside the town center: swings and rings while an agent of this base
 * is blocked on you. (x, y) is the post's foot.
 */
export function drawBell(ctx, x, y, t, isRinging) {
  rect(ctx, x - 6, y - 1, 13, 2, C.shadow);
  rect(ctx, x - 6, y - 20, 1, 20, C.woodDark);
  rect(ctx, x + 6, y - 20, 1, 20, C.woodDark);
  rect(ctx, x - 7, y - 21, 15, 2, C.wood);
  rect(ctx, x - 7, y - 21, 15, 1, C.woodLight);
  const swing = isRinging ? [0, 1, 0, -1][Math.floor(t * 8) % 4] : 0;
  const bx = Math.round(x) + swing;
  const by = y - 18;
  rect(ctx, bx - 2, by, 5, 1, C.outline);
  rect(ctx, bx - 3, by + 1, 7, 4, C.outline);
  rect(ctx, bx - 4, by + 5, 9, 2, C.outline);
  rect(ctx, bx - 1, by + 1, 3, 1, C.gold);
  rect(ctx, bx - 2, by + 2, 5, 3, C.gold);
  rect(ctx, bx - 3, by + 5, 7, 1, C.goldDark);
  rect(ctx, bx - 1, by + 2, 1, 2, C.goldGlint);
  rect(ctx, bx, by + 6, 1, 2, C.woodDark);
  if (!isRinging || Math.floor(t * 4) % 2) return;
  rect(ctx, x - 9, by + 2, 1, 3, '#fecaca');
  rect(ctx, x + 9, by + 2, 1, 3, '#fecaca');
  rect(ctx, x - 11, by + 1, 1, 5, '#f87171');
  rect(ctx, x + 11, by + 1, 1, 5, '#f87171');
}

/** Small queue bar over the town center while a deployed agent is on its way (AoE training). */
export function drawTrainingBar(ctx, x, y, progress) {
  rect(ctx, x - 11, y - 1, 22, 4, C.outline);
  rect(ctx, x - 10, y, 20, 2, '#3a2c1a');
  rect(ctx, x - 10, y, Math.max(1, Math.round(20 * progress)), 2, '#4ade80');
}

/** Dashed foundation where a reserved base will rise. */
export function drawFoundation(ctx, ox, oy, w, h, color, t) {
  ctx.save();
  ctx.globalAlpha = 0.5 + 0.3 * (Math.sin(t * 3) + 1) / 2;
  const dash = Math.floor(t * 6) % 4;
  for (let x = 0; x < w; x++) {
    if ((x + dash) % 4 < 2) {
      rect(ctx, ox + x, oy, 1, 1, color);
      rect(ctx, ox + x, oy + h - 1, 1, 1, color);
    }
  }
  for (let y = 0; y < h; y++) {
    if ((y + dash) % 4 < 2) {
      rect(ctx, ox, oy + y, 1, 1, color);
      rect(ctx, ox + w - 1, oy + y, 1, 1, color);
    }
  }
  ctx.restore();
  rect(ctx, ox + 4, oy + h - 5, w - 8, 3, C.stoneDark);
  rect(ctx, ox + 4, oy + h - 5, w - 8, 1, C.stone);
}

/** Territory border in the team color; it pulses when the base needs the user. */
export function drawTerritory(ctx, x, y, w, h, color, alertColor, t) {
  ctx.save();
  ctx.globalAlpha = 0.85;
  for (let i = 0; i < w; i += 4) {
    rect(ctx, x + i, y, 2, 1, color);
    rect(ctx, x + i, y + h - 1, 2, 1, color);
  }
  for (let i = 0; i < h; i += 4) {
    rect(ctx, x, y + i, 1, 2, color);
    rect(ctx, x + w - 1, y + i, 1, 2, color);
  }
  if (alertColor) {
    ctx.globalAlpha = 0.06 + 0.1 * (Math.sin(t * 7) + 1) / 2;
    rect(ctx, x, y, w, h, alertColor);
    ctx.globalAlpha = 0.9;
    rect(ctx, x, y, w, 1, alertColor);
    rect(ctx, x, y + h - 1, w, 1, alertColor);
    rect(ctx, x, y, 1, h, alertColor);
    rect(ctx, x + w - 1, y, 1, h, alertColor);
  }
  ctx.restore();
}

/** Glow over a plot (the agent hovered in the panel, or its base). */
export function drawPlotGlow(ctx, x, y, w, h, color, t) {
  ctx.save();
  ctx.globalAlpha = 0.07 + 0.08 * (Math.sin(t * 6) + 1) / 2;
  rect(ctx, x, y, w, h, color);
  ctx.restore();
}

// A quiet base (no editor window open, nobody working): its land in shade, its border in stone,
// so the active ones stand out at a glance.
export const QUIET_BORDER = C.stoneDark;
export const PLOT_SHADE = { color: '#1a1208', alpha: 0.3 };

export function drawPlotShade(ctx, x, y, w, h) {
  ctx.save();
  ctx.globalAlpha = PLOT_SHADE.alpha;
  rect(ctx, x, y, w, h, PLOT_SHADE.color);
  ctx.restore();
}

// ---------- A base's grown land (plot.js) ----------

/** Trodden ground, flat: the village street and the bailey's paths. */
export function drawTrodden(ctx, x, y, w, h) {
  ctx.save();
  ctx.globalAlpha = 0.55;
  rect(ctx, x, y, w, h, C.trodden);
  ctx.restore();
}

const CROPS = [[C.hay, C.hayDark], [C.leafLight, C.leaf], ['#9bb84a', '#6f8a32']];

/** A field, flat: tilled earth under rows of wheat, greens or young shoots, picked by its seed. */
export function drawField(ctx, x, y, w, h, seed) {
  const [crop, shade] = pick(CROPS, seed >>> 3);
  rect(ctx, x, y, w, h, C.dirtDark);
  rect(ctx, x + 1, y + 1, w - 2, h - 2, C.dirt);
  for (let row = y + 2; row < y + h - 2; row += 3) {
    rect(ctx, x + 2, row, w - 4, 1, crop);
    for (let k = x + 3 + (row % 4); k < x + w - 3; k += 4) rect(ctx, k, row + 1, 1, 1, shade);
  }
}

const WOOD_ART = { wall: C.wood, light: C.woodLight, dark: C.woodDark, trim: C.woodDark };
const BARN_ART = { wall: '#9a4630', light: '#b85c42', dark: '#6e2f20', trim: C.white };
// Village roofs: the team's, terracotta or grey shingle, so the houses don't look cloned.
const VILLAGE_ROOFS = [null, ['#a34e34', '#7d3a26'], ['#7a6a58', '#5a4c3e']];
const WALL_H = 7;

/** The bailey is a wooden palisade before Fortaleza, unless the user picked stone walls. */
export function isPalisade(design) {
  return (design.era ?? DEFAULT_TOWN.era) <= 2 && !design.hasStoneWalls;
}

// The bailey stands in the town center's stone, or as a wooden palisade (as in 3D).
function wallArt(design) {
  if (isPalisade(design)) return { ...WOOD_ART, isPalisade: true };
  return townArt(design.style);
}

/** One block of the bailey's wall, its foot at (x, y): the face along x, the side down y, merlons on top. */
export function drawWallBlock(ctx, x, y, block, team, design) {
  const art = wallArt(design);
  const [x0, gy] = [Math.round(x) - 2, Math.round(y)];
  rect(ctx, x0, gy - WALL_H, 4, WALL_H, block.isAlongX ? art.wall : art.dark);
  if (art.isPalisade) {
    rect(ctx, x0 + 1, gy - WALL_H - 1, 2, 1, art.wall); // the stakes' points
    rect(ctx, x0 + (block.isMerlon ? 0 : 2), gy - WALL_H + 1, 1, WALL_H - 2, art.dark);
    return;
  }
  rect(ctx, x0, gy - WALL_H, 4, 1, art.light);
  rect(ctx, x0, gy - 1, 4, 1, art.dark);
  if (block.isMerlon) rect(ctx, x0, gy - WALL_H - 2, 3, 2, block.isAlongX ? art.light : art.wall);
}

/** A round tower on the bailey's wall, its foot at (x, y), capped in the team color (thatch on a palisade). */
export function drawWallTower(ctx, x, y, team, design) {
  const art = wallArt(design);
  const [tx, gy] = [Math.round(x) - 4, Math.round(y)];
  const h = art.isPalisade ? 12 : 15;
  rect(ctx, tx - 1, gy - 1, 11, 2, C.shadow);
  rect(ctx, tx, gy - h, 9, h, art.wall);
  rect(ctx, tx, gy - h, 2, h, art.light);
  rect(ctx, tx + 7, gy - h, 2, h, art.dark);
  rect(ctx, tx + 4, gy - h + 5, 1, 3, C.windowDark); // arrow slit
  drawTowerCap(ctx, tx + 1, gy - h, [11, 9, 7, 5, 3, 1], art.isPalisade ? thatchOf(team) : team);
}

/** A building the land grew (plot.js), its footprint at (x, y): the keep, a hall, a house or a barn. */
export function drawPlotBuilding(ctx, x, y, building, team, design, isNight, t) {
  if (building.kind === 'keep') {
    drawKeep(ctx, x, y, building, team, wallArt(design), isNight, t);
    return;
  }
  const { kind, w, h, axis, seed } = building;
  const isHut = (design.era ?? DEFAULT_TOWN.era) <= 1;
  const art = kind === 'barn' ? BARN_ART : isHut ? WOOD_ART : townArt(design.style);
  const gy = y + h;
  const bodyH = kind === 'barn' ? 9 : kind === 'hall' ? 8 : 7;
  const top = gy - bodyH;
  const cx = x + w / 2;
  const glass = isNight ? C.windowLit : C.windowDark;
  rect(ctx, x - 1, gy - 1, w + 2, 2, C.shadow);
  rect(ctx, x, top, w, bodyH, art.wall);
  rect(ctx, x, top, w, 1, art.light);
  rect(ctx, x, top, 1, bodyH, art.dark);
  rect(ctx, x + w - 1, top, 1, bodyH, art.dark);
  if (kind === 'barn') {
    // a wide door with its cross brace
    rect(ctx, cx - 3, gy - 6, 6, 6, art.dark);
    rect(ctx, cx - 3, gy - 6, 6, 1, art.trim);
    for (let k = 0; k < 5; k++) rect(ctx, cx - 3 + k + 0.5, gy - 5 + k, 1, 1, art.trim);
  } else {
    const doorX = kind === 'hall' ? cx - 1.5 : x + 3 + (seed % Math.max(1, w - 9));
    rect(ctx, Math.round(doorX), gy - 5, 3, 5, C.doorDark);
    for (let wx = x + 3; wx + 2 <= x + w - 2; wx += 6) {
      if (wx + 2 >= doorX - 1 && wx <= doorX + 4) continue;
      rect(ctx, wx, top + 2, 2, 2, glass);
    }
  }
  // the ridge runs along the long front (a trapezoid) or front to back (the gable end shows)
  const roof = kind === 'hall' ? team : isHut ? thatchOf(team) : (pick(VILLAGE_ROOFS, seed >>> 5) ?? team);
  const roofH = axis === 'y' ? Math.max(5, Math.round(w * 0.45)) : Math.max(4, Math.round(h * 0.55));
  const roofTop = drawGableRoof(ctx, cx, top + 1, w + 2, roofH, roof, axis === 'y' ? 0.12 : 0.5);
  if (kind === 'house' && seed % 3 === 0) {
    const chimney = x + w - 5;
    rect(ctx, chimney, roofTop + 1, 2, 3, C.stoneDark);
    drawChimneySmoke(ctx, chimney, roofTop - 1, t);
  }
}

// The keep: a square tower over the bailey, crenellated, the team's flag on top.
function drawKeep(ctx, x, y, b, team, art, isNight, t) {
  const gy = y + b.h;
  const bodyH = 20 + Math.round(b.h / 2);
  const top = gy - bodyH;
  const mid = x + b.w / 2;
  rect(ctx, x - 1, gy - 1, b.w + 2, 2, C.shadow);
  rect(ctx, x, top, b.w, bodyH, art.wall);
  rect(ctx, x, top, 2, bodyH, art.light);
  rect(ctx, x + b.w - 2, top, 2, bodyH, art.dark);
  rect(ctx, x, top, b.w, 1, art.dark);
  for (let k = x; k < x + b.w - 1; k += 3) rect(ctx, k, top - 2, 2, 2, art.wall);
  const glass = isNight ? C.windowLit : C.windowDark;
  for (const wy of [top + 5, top + 12]) rect(ctx, mid - 1, wy, 2, 4, glass);
  rect(ctx, mid - 2, gy - 6, 4, 6, C.doorDark);
  const [color, shade] = team;
  const flap = Math.floor(t * 3 + x) % 2;
  rect(ctx, mid, top - 11, 1, 9, C.woodDark);
  rect(ctx, mid + 1, top - 11, 5, 3, color);
  rect(ctx, mid + 6, top - 11 + flap, 1, 2, color);
  rect(ctx, mid + 1, top - 8, 5, 1, shade);
}

/** Gold mine, 28 x 20 at (ox, oy): rocks, a timbered entrance and glinting veins. */
export function drawMine(ctx, ox, oy, t, isActive) {
  rect(ctx, ox, oy + 19, 28, 2, C.shadow);
  rect(ctx, ox + 5, oy + 1, 18, 6, C.rock);
  rect(ctx, ox + 2, oy + 5, 24, 8, C.rock);
  rect(ctx, ox, oy + 11, 28, 9, C.rockDark);
  rect(ctx, ox + 6, oy + 1, 6, 1, C.rockLight);
  rect(ctx, ox + 3, oy + 5, 3, 1, C.rockLight);
  rect(ctx, ox + 19, oy + 6, 4, 1, C.rockLight);
  rect(ctx, ox + 10, oy + 8, 8, 12, '#1a1410');
  rect(ctx, ox + 9, oy + 7, 1, 13, C.wood);
  rect(ctx, ox + 18, oy + 7, 1, 13, C.wood);
  rect(ctx, ox + 9, oy + 7, 10, 1, C.woodLight);
  const veins = [[4, 9], [6, 14], [22, 9], [24, 15], [14, 3], [20, 3], [2, 16]];
  veins.forEach(([vx, vy], i) => {
    rect(ctx, ox + vx, oy + vy, 2, 1, C.gold);
    rect(ctx, ox + vx, oy + vy + 1, 1, 1, C.goldDark);
    const isGlinting = Math.floor(t * (isActive ? 3 : 1) + i * 1.7) % 6 === 0;
    if (isGlinting) rect(ctx, ox + vx + 1, oy + vy - 1, 1, 1, C.goldGlint);
  });
  // ore pile by the entrance
  rect(ctx, ox + 20, oy + 17, 6, 3, C.goldDark);
  rect(ctx, ox + 21, oy + 16, 4, 2, C.gold);
}

/** Forge, 28 x 24 at (ox, oy): furnace, chimney smoke and an anvil. */
export function drawForge(ctx, ox, oy, t, isActive) {
  rect(ctx, ox, oy + 23, 28, 2, C.shadow);
  // shelter posts and roof
  rect(ctx, ox + 1, oy + 6, 1, 17, C.woodDark);
  rect(ctx, ox + 26, oy + 6, 1, 17, C.woodDark);
  rect(ctx, ox, oy + 4, 28, 3, C.wood);
  rect(ctx, ox, oy + 4, 28, 1, C.woodLight);
  rect(ctx, ox, oy + 7, 28, 1, C.woodDark);
  // furnace
  rect(ctx, ox + 3, oy + 9, 13, 14, C.stoneDark);
  rect(ctx, ox + 3, oy + 9, 13, 1, C.stone);
  rect(ctx, ox + 6, oy - 1, 6, 6, C.stoneDark);
  rect(ctx, ox + 6, oy - 1, 6, 1, C.stone);
  const flicker = Math.floor(t * (isActive ? 10 : 4)) % 3;
  rect(ctx, ox + 6, oy + 15, 7, 6, '#2a1410');
  rect(ctx, ox + 7, oy + 17 - (flicker === 1 ? 1 : 0), 5, 4, isActive ? C.fire : '#9a3412');
  rect(ctx, ox + 8 + flicker % 2, oy + 18, 3, 2, isActive ? C.fireHot : C.fire);
  // smoke
  for (let i = 0; i < 3; i++) {
    const rise = (t * (isActive ? 9 : 4) + i * 4) % 12;
    rect(ctx, ox + 8 + Math.round(Math.sin(t * 2 + i) * 1.5), oy - 3 - Math.floor(rise), 2, 2, `rgba(200, 200, 200, ${0.5 - rise / 30})`);
  }
  // anvil and bucket
  rect(ctx, ox + 18, oy + 16, 8, 2, '#3b3f4a');
  rect(ctx, ox + 18, oy + 16, 8, 1, '#5d6372');
  rect(ctx, ox + 16, oy + 16, 2, 1, '#3b3f4a');
  rect(ctx, ox + 20, oy + 18, 4, 4, '#2a2e37');
  rect(ctx, ox + 19, oy + 22, 6, 1, '#2a2e37');
  if (isActive && Math.floor(t * 6) % 2) rect(ctx, ox + 21, oy + 15, 2, 1, C.fireHot);
}

/** A half-lot base's little mine, 14 x 13 at (ox, oy): a rock with its timbered mouth and gold. */
export function drawSmallMine(ctx, ox, oy, t, isActive) {
  rect(ctx, ox, oy + 12, 14, 2, C.shadow);
  rect(ctx, ox + 3, oy + 1, 8, 4, C.rock);
  rect(ctx, ox + 1, oy + 4, 12, 4, C.rock);
  rect(ctx, ox, oy + 7, 14, 6, C.rockDark);
  rect(ctx, ox + 3, oy + 1, 3, 1, C.rockLight);
  rect(ctx, ox + 5, oy + 6, 4, 7, '#1a1410');
  rect(ctx, ox + 4, oy + 5, 1, 8, C.wood);
  rect(ctx, ox + 9, oy + 5, 1, 8, C.wood);
  rect(ctx, ox + 4, oy + 5, 6, 1, C.woodLight);
  [[2, 6], [11, 8], [8, 2]].forEach(([vx, vy], i) => {
    rect(ctx, ox + vx, oy + vy, 1, 1, C.gold);
    if (Math.floor(t * (isActive ? 3 : 1) + i * 1.7) % 6 === 0) rect(ctx, ox + vx, oy + vy - 1, 1, 1, C.goldGlint);
  });
  rect(ctx, ox + 10, oy + 11, 3, 2, C.gold);
}

/** A half-lot base's little forge, 14 x 15 at (ox, oy): a furnace under a lean-to and an anvil. */
export function drawSmallForge(ctx, ox, oy, t, isActive) {
  rect(ctx, ox, oy + 14, 14, 2, C.shadow);
  rect(ctx, ox + 1, oy + 5, 7, 9, C.stoneDark);
  rect(ctx, ox + 1, oy + 5, 7, 1, C.stone);
  rect(ctx, ox + 3, oy - 1, 3, 6, C.stoneDark);
  rect(ctx, ox, oy + 3, 14, 2, C.wood);
  rect(ctx, ox, oy + 3, 14, 1, C.woodLight);
  rect(ctx, ox + 13, oy + 5, 1, 9, C.woodDark);
  const flicker = Math.floor(t * (isActive ? 10 : 4)) % 3;
  rect(ctx, ox + 3, oy + 9, 3, 4, '#2a1410');
  rect(ctx, ox + 3, oy + 10 - (flicker === 1 ? 1 : 0), 3, 3, isActive ? C.fire : '#9a3412');
  for (let i = 0; i < 2; i++) {
    const rise = (t * (isActive ? 9 : 4) + i * 5) % 10;
    rect(ctx, ox + 4, oy - 3 - Math.floor(rise), 1, 1, `rgba(200, 200, 200, ${0.5 - rise / 25})`);
  }
  rect(ctx, ox + 9, oy + 10, 4, 1, '#5d6372');
  rect(ctx, ox + 10, oy + 11, 2, 3, '#2a2e37');
}

/** A half-lot base's bench for those who wait on you, w wide, its foot at (x, y). */
export function drawBench(ctx, x, y, w) {
  rect(ctx, x, y, w, 1, C.shadow);
  rect(ctx, x + 1, y - 3, 1, 3, C.woodDark);
  rect(ctx, x + w - 2, y - 3, 1, 3, C.woodDark);
  rect(ctx, x, y - 4, w, 2, C.wood);
  rect(ctx, x, y - 4, w, 1, C.woodLight);
}

/** A village pond on its footprint at (x, y), flat on the ground, a ripple drifting across. */
export function drawPond(ctx, x, y, w, h, seed, t) {
  rect(ctx, x + 2, y - 1, w - 4, h + 2, C.grassLight);
  rect(ctx, x - 1, y + 2, w + 2, h - 4, C.grassLight);
  rect(ctx, x + 2, y, w - 4, h, C.water);
  rect(ctx, x, y + 2, w, h - 4, C.water);
  rect(ctx, x + 3, y + 1, w - 6, 1, '#2f5d8c');
  rect(ctx, x + 3 + (Math.floor(t * 1.5 + (seed % 7)) % Math.max(1, w - 9)), y + Math.floor(h / 2), 3, 1, C.waterLight);
}

/**
 * What else the village grew, on its footprint at (x, y), standing on its front edge: a haystack, a
 * woodpile, a market stall in the team's stripes or a windmill turning its sails.
 */
export function drawPlotProp(ctx, x, y, prop, team, t) {
  const { w, h } = prop;
  const gy = y + h; // the foot
  rect(ctx, x, gy - 1, w, 2, C.shadow);
  if (prop.kind === 'haystack') {
    rect(ctx, x + 1, gy - 6, w - 2, 5, C.hay);
    rect(ctx, x + 2, gy - 8, w - 4, 2, C.hay);
    rect(ctx, x + 2, gy - 8, w - 4, 1, '#f0d78a');
    rect(ctx, x + 1, gy - 2, w - 2, 1, '#b8963a');
  } else if (prop.kind === 'woodpile') {
    for (let row = 0; row < 2; row++) {
      for (let lx = x + row * 2; lx + 3 <= x + w - row * 2; lx += 3) {
        rect(ctx, lx, gy - 4 - row * 3, 3, 3, C.wood);
        rect(ctx, lx + 1, gy - 3 - row * 3, 1, 1, C.woodLight);
      }
    }
  } else if (prop.kind === 'stall') {
    rect(ctx, x + 1, gy - 10, 1, 10, C.woodDark);
    rect(ctx, x + w - 2, gy - 10, 1, 10, C.woodDark);
    for (let i = 0; i < w; i += 3) rect(ctx, x + i, gy - 13, Math.min(3, w - i), 3, (i / 3) % 2 ? C.white : team[0]);
    rect(ctx, x + 1, gy - 4, w - 2, 4, C.wood);
    rect(ctx, x + 1, gy - 4, w - 2, 1, C.woodLight);
    rect(ctx, x + 3, gy - 5, 2, 1, '#c0504d');
    rect(ctx, x + 7, gy - 5, 2, 1, C.gold);
  } else if (prop.kind === 'windmill') {
    rect(ctx, x + 3, gy - 18, 6, 18, C.plaster);
    rect(ctx, x + 2, gy - 6, 8, 6, C.plaster);
    rect(ctx, x + 8, gy - 18, 1, 18, '#b8a47e');
    rect(ctx, x + 5, gy - 5, 2, 5, C.doorDark);
    rect(ctx, x + 2, gy - 21, 8, 3, team[0]);
    rect(ctx, x + 4, gy - 23, 4, 2, team[0]);
    // the sails turn in quarter steps: a plus, then a cross
    const [hx, hy] = [x + 6, gy - 17];
    const isCross = Math.floor(t * 2 + (prop.seed % 4)) % 2 === 1;
    for (let k = 1; k <= 7; k++) {
      for (const [dx, dy] of isCross ? [[1, 1], [-1, 1], [1, -1], [-1, -1]] : [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        rect(ctx, hx + dx * k, hy + dy * k, 1, 1, C.woodDark);
        if (k > 2) rect(ctx, hx + dx * k + (isCross ? 0 : dy), hy + dy * k + dx, 1, 1, C.white); // the sail beside its arm
      }
    }
    rect(ctx, hx - 1, hy - 1, 2, 2, C.woodDark);
  }
}

// ---------- Wonders and the age-up beam ----------

/** Wonder for a thousand commits: a stone obelisk with a gold tip. (x, y) is its foot. */
export function drawObelisk(ctx, x, y) {
  rect(ctx, x - 6, y - 1, 12, 2, C.shadow);
  rect(ctx, x - 5, y - 4, 10, 4, C.stoneDark);
  rect(ctx, x - 5, y - 4, 10, 1, C.stone);
  rect(ctx, x - 3, y - 28, 6, 24, C.stone);
  rect(ctx, x - 3, y - 28, 1, 24, C.stoneLight);
  rect(ctx, x + 2, y - 28, 1, 24, C.stoneDark);
  for (let k = 0; k < 4; k++) rect(ctx, x - 1, y - 24 + k * 5, 2, 1, C.stoneDark);
  rect(ctx, x - 3, y - 30, 6, 2, C.gold);
  rect(ctx, x - 2, y - 32, 4, 2, C.gold);
  rect(ctx, x - 1, y - 34, 2, 2, C.goldGlint);
}

/** Wonder for a full day of agent work: a stone beacon with its fire burning. (x, y) is its foot. */
export function drawBeacon(ctx, x, y, t) {
  rect(ctx, x - 6, y - 1, 12, 2, C.shadow);
  rect(ctx, x - 4, y - 22, 8, 22, C.stone);
  rect(ctx, x - 4, y - 22, 1, 22, C.stoneLight);
  rect(ctx, x + 3, y - 22, 1, 22, C.stoneDark);
  for (let k = 0; k < 8; k += 2) rect(ctx, x - 4 + k, y - 24, 1, 2, C.stoneLight);
  rect(ctx, x - 1, y - 14, 2, 4, C.windowDark);
  const flicker = Math.floor(t * 8) % 3;
  rect(ctx, x - 3, y - 28 - (flicker === 1 ? 1 : 0), 6, 4, C.fire);
  rect(ctx, x - 2, y - 30, 4, 3, C.fireHot);
  rect(ctx, x - 1, y - 31 - (flicker % 2), 2, 2, C.fireCore);
}

/** A base advanced an era: a gold beam over its town center with sparkles rising. k runs 0 → 1. */
export function drawAgeUp(ctx, cx, groundY, t, k) {
  const strength = Math.sin(Math.PI * Math.min(1, Math.max(0, k)));
  ctx.save();
  ctx.globalAlpha = 0.3 * strength;
  rect(ctx, cx - 12, groundY - 96, 24, 96, C.goldGlint);
  ctx.globalAlpha = 0.55 * strength;
  rect(ctx, cx - 4, groundY - 96, 8, 96, '#fff8d0');
  ctx.globalAlpha = strength;
  for (let i = 0; i < 12; i++) {
    const h = ihash(i * 37 + 5);
    const rise = (t * 34 + (h % 70)) % 80;
    rect(ctx, cx - 16 + (h % 32), groundY - 8 - rise, 2, 2, i % 2 ? C.gold : C.goldGlint);
  }
  ctx.restore();
}

// ---------- Square (where long-idle agents go) ----------

export function drawWell(ctx, x, y, t) {
  rect(ctx, x, y + 17, 18, 2, C.shadow);
  rect(ctx, x + 1, y + 8, 16, 9, C.stone);
  rect(ctx, x + 1, y + 8, 16, 1, C.stoneLight);
  rect(ctx, x + 3, y + 9, 12, 3, C.water);
  rect(ctx, x + 4 + (Math.floor(t * 2) % 6), y + 10, 2, 1, C.waterLight);
  rect(ctx, x + 2, y, 1, 9, C.woodDark);
  rect(ctx, x + 15, y, 1, 9, C.woodDark);
  rect(ctx, x, y - 2, 18, 3, C.wood);
  rect(ctx, x, y - 2, 18, 1, C.woodLight);
  rect(ctx, x + 8, y + 1, 1, 4, '#c8b28a');
  rect(ctx, x + 7, y + 5, 3, 3, C.woodLight);
}

export function drawMarket(ctx, x, y, t) {
  rect(ctx, x, y + 25, 40, 2, C.shadow);
  rect(ctx, x + 1, y + 8, 1, 17, C.woodDark);
  rect(ctx, x + 38, y + 8, 1, 17, C.woodDark);
  for (let i = 0; i < 40; i += 4) {
    rect(ctx, x + i, y, 4, 8, (i / 4) % 2 ? C.white : '#c0504d');
    rect(ctx, x + i, y + 8, 4, 2, (i / 4) % 2 ? '#d8d4c8' : '#9a3b38');
  }
  rect(ctx, x + 2, y + 16, 36, 9, C.wood);
  rect(ctx, x + 2, y + 16, 36, 1, C.woodLight);
  const goods = ['#d94a3a', '#e0b04a', '#8bc34a', '#c27a3a', '#e6d2a8'];
  for (let i = 0; i < 9; i++) rect(ctx, x + 4 + i * 4, y + 14, 3, 2, goods[i % goods.length]);
  if (Math.floor(t * 0.5) % 2) rect(ctx, x + 30, y + 12, 3, 2, '#7a4fbd');
}

export function drawCampfire(ctx, x, y, t) {
  rect(ctx, x - 6, y - 1, 13, 2, C.shadow);
  rect(ctx, x - 5, y - 2, 11, 2, C.woodDark);
  rect(ctx, x - 3, y - 3, 7, 1, C.wood);
  const f = Math.floor(t * 8) % 3;
  rect(ctx, x - 3, y - 6, 7, 3, C.fire);
  rect(ctx, x - 2 + (f === 2 ? 1 : 0), y - 9 + (f === 1 ? 1 : 0), 4, 3, C.fireHot);
  rect(ctx, x - (f === 0 ? 0 : 1), y - 11 + f % 2, 2, 2, C.fireCore);
  for (let i = 0; i < 2; i++) {
    const rise = (t * 6 + i * 5) % 10;
    rect(ctx, x + Math.round(Math.sin(t * 2 + i * 3) * 2), y - 13 - Math.floor(rise), 1, 1, `rgba(220, 220, 220, ${0.6 - rise / 18})`);
  }
}

export function drawLogSeat(ctx, x, y) {
  rect(ctx, x - 6, y - 1, 12, 2, C.shadow);
  rect(ctx, x - 6, y - 4, 12, 4, C.wood);
  rect(ctx, x - 6, y - 4, 12, 1, C.woodLight);
  rect(ctx, x - 6, y - 4, 2, 4, '#c9a26a');
}

export function drawHayCart(ctx, x, y) {
  rect(ctx, x, y + 15, 28, 2, C.shadow);
  rect(ctx, x + 2, y + 4, 22, 8, C.wood);
  rect(ctx, x + 2, y + 4, 22, 1, C.woodLight);
  rect(ctx, x + 3, y, 20, 5, C.hay);
  rect(ctx, x + 5, y - 2, 14, 3, C.hay);
  rect(ctx, x + 6, y - 1, 3, 1, C.hayDark);
  rect(ctx, x + 14, y + 1, 4, 1, C.hayDark);
  rect(ctx, x + 24, y + 9, 4, 1, C.woodDark);
  rect(ctx, x + 4, y + 10, 6, 6, C.woodDark);
  rect(ctx, x + 6, y + 12, 2, 2, C.woodLight);
  rect(ctx, x + 16, y + 10, 6, 6, C.woodDark);
  rect(ctx, x + 18, y + 12, 2, 2, C.woodLight);
}

// ---------- Light and weather ----------

const SKY_NIGHT = ['#0a1030', '#131c45', '#1d2a5c'];
const SKY_DAWN = ['#8fb3e8', '#f5b6c8', '#fcd9a0'];
const SKY_DAY = ['#5ea8ec', '#7cc4f5', '#a9dcfb'];
const SKY_DUSK = ['#5b3f8c', '#e0719a', '#f6a55c'];
// [hour, sky bands, map darkness]: colors and light blend between neighbouring keys.
const SKY_KEYS = [
  [0, SKY_NIGHT, 0.48],
  [5, SKY_NIGHT, 0.48],
  [6.25, SKY_DAWN, 0.2],
  [7.5, SKY_DAY, 0],
  [16.5, SKY_DAY, 0],
  [18, SKY_DUSK, 0.17],
  [19.5, SKY_NIGHT, 0.48],
  [24, SKY_NIGHT, 0.48],
];

export function skyFor(hour) {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (h > SKY_KEYS[i + 1][0]) i++;
  const [h0, bands0, dark0] = SKY_KEYS[i];
  const [h1, bands1, dark1] = SKY_KEYS[i + 1];
  const f = (h - h0) / (h1 - h0);
  const darkness = dark0 + (dark1 - dark0) * f;
  return { bands: bands0.map((c, k) => mixHex(c, bands1[k], f)), darkness, isNight: darkness > 0.25 };
}

function mixHex(a, b, f) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift) => Math.round(((pa >> shift) & 255) * (1 - f) + ((pb >> shift) & 255) * f);
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

function mix(hex, other, f) {
  return mixHex(hex, other, f);
}

/** Warm halo drawn over the night overlay (windows, fires, torches). */
export function drawGlow(ctx, x, y, radius, color, strength) {
  ctx.save();
  const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
  glow.addColorStop(0, color);
  glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.globalAlpha = strength;
  ctx.fillStyle = glow;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  ctx.restore();
}


// ---------- O Batedor: the village's hero, a knight on a barded horse ----------

// Slack's four colors and its aubergine: the shield's mark and the horse's cloth.
export const SLACK = { blue: '#36c5f0', green: '#2eb67d', yellow: '#ecb22e', red: '#e01e5a', aubergine: '#4a154b', aubergineLight: '#6b2a6d' };
// The pennant is ChatJurídico's logo: the blue speech bubble, its tail at the bottom-left, with the
// white mark (a Λ over a bowl). 7 x 8; '#' blue, 'w' white.
const CJ_BLUE = '#3a5d9d';
const CJ_FLAG = [
  '.#####.',
  '###w###',
  '##w#w##',
  '#w###w#',
  '#wwwww#',
  '##www##',
  '######.',
  '#......',
];
// The mark at twice the detail, for the panel's portrait and the 3D pennant: thin legs, a shallow bowl.
const CJ_MARK_FINE = [
  '....ww....',
  '...w..w...',
  '...w..w...',
  '..w....w..',
  '..w....w..',
  '.w......w.',
  'wwwwwwwwww',
  '..wwwwww..',
  '....ww....',
];
// The hash in a 5 x 5 grid, four arms turning around the middle: [x, y, color].
const SLACK_MARK = [
  [1, 0, 'blue'], [0, 1, 'blue'], [1, 1, 'blue'], [2, 1, 'blue'],
  [3, 0, 'green'], [3, 1, 'green'], [4, 1, 'green'], [3, 2, 'green'],
  [2, 3, 'yellow'], [3, 3, 'yellow'], [4, 3, 'yellow'], [3, 4, 'yellow'],
  [1, 2, 'red'], [0, 3, 'red'], [1, 3, 'red'], [1, 4, 'red'],
];
// Armor by experience: leather, iron, steel, then gold.
export const KNIGHT_ARMOR = [
  { base: '#8a5a32', shade: '#5e3c20', light: '#b07a48' },
  { base: '#9aa3ad', shade: '#6b7280', light: '#c4cad1' },
  { base: '#d6dbe3', shade: '#9aa3ad', light: '#f3f5f8' },
  { base: '#f2c84b', shade: '#c99a2e', light: '#fff3b0' },
];

export function knightTier(level) {
  return level >= 7 ? 3 : level >= 5 ? 2 : level >= 3 ? 1 : 0;
}

/** Heater shield, 7 x 9 from its top-left corner, white with the Slack mark; never mirrored. */
export function drawSlackShield(ctx, x, y, rim = '#3b2a1a') {
  const left = Math.round(x);
  const top = Math.round(y);
  rect(ctx, left, top, 7, 7, rim);
  rect(ctx, left + 1, top + 7, 5, 1, rim);
  rect(ctx, left + 2, top + 8, 3, 1, rim);
  rect(ctx, left + 1, top + 1, 5, 6, '#f6f3ec');
  rect(ctx, left + 2, top + 7, 3, 1, '#f6f3ec');
  for (const [mx, my, color] of SLACK_MARK) rect(ctx, left + 1 + mx, top + 1 + my, 1, 1, SLACK[color]);
}

/**
 * The ChatJurídico pennant, 7 x 8 from its top-left corner (14 x 16 when `isFine`, with the finer
 * mark). Mirrored, the tail stays by the pole (the mark is symmetric); `flap` drops the far edge.
 */
export function drawChatJuridicoFlag(ctx, x, y, { isMirrored = false, flap = 0, isFine = false } = {}) {
  const left = Math.round(x);
  const top = Math.round(y);
  const size = isFine ? 2 : 1;
  CJ_FLAG.forEach((line, row) => [...line].forEach((cell, col) => {
    if (cell === '.') return;
    const drop = col === 6 ? flap : 0;
    const color = cell === 'w' && !isFine ? '#ffffff' : CJ_BLUE;
    rect(ctx, left + (isMirrored ? 6 - col : col) * size, top + (row + drop) * size, size, size, color);
  }));
  if (!isFine) return;
  CJ_MARK_FINE.forEach((line, row) => [...line].forEach((cell, col) => {
    if (cell === 'w') rect(ctx, left + 2 + col, top + 2 + row, 1, 1, '#ffffff');
  }));
}

/**
 * The scout on its barded horse, seen from the side, 24 px wide and 31 tall from the hooves at
 * (ax, ay). The lance carries the ChatJurídico pennant; the armor follows its level.
 */
export function drawKnight(ctx, look, ax, ay, facing, isMoving, frame, t, level = 1) {
  const x0 = Math.round(ax) - 12;
  const by = Math.round(ay);
  const isFlipped = facing === 'w';
  const P = (c, r, w, h, color) => rect(ctx, isFlipped ? x0 + 24 - c - w : x0 + c, by + r, w, h, color);
  const [coat, coatShade, mane] = look.horse;
  const armor = KNIGHT_ARMOR[knightTier(level)];
  const lift = isMoving ? frame % 2 : 0;
  // legs and hooves, trotting in diagonal pairs
  for (const col of [5, 7, 15, 17]) {
    const kick = col === 5 || col === 17 ? lift : isMoving ? 1 - lift : 0;
    P(col, -5 + kick, 1, 4 - kick, col % 2 ? coat : coatShade);
    P(col, -1, 1, 1, '#2a1d12');
  }
  // tail, body, neck and head
  P(1, -11, 3, 1, mane);
  P(1, -10, 2, 4 + (isMoving ? frame % 2 : 0), mane);
  P(4, -12, 15, 6, coat);
  P(16, -16, 3, 6, coat);
  P(18, -18, 4, 3, coat);
  P(21, -16, 2, 2, coat);
  P(22, -15, 1, 1, '#2a1d12');
  P(19, -19, 1, 1, coat);
  P(15, -17, 2, 7, mane);
  P(20, -17, 1, 1, C.eye);
  // barding: the aubergine cloth with a gold hem, in scallops
  P(4, -12, 12, 6, SLACK.aubergine);
  P(4, -12, 12, 1, SLACK.aubergineLight);
  P(4, -6, 12, 1, SLACK.yellow);
  for (let col = 4; col < 16; col += 3) P(col + 1, -5, 1, 1, SLACK.yellow);
  P(16, -15, 2, 4, SLACK.aubergine);
  // rider: boot, body, tabard, helm, plume
  P(10, -11, 2, 3, armor.shade);
  P(9, -19, 5, 8, armor.base);
  P(9, -19, 1, 8, armor.shade);
  P(12, -19, 1, 3, armor.light);
  P(10, -17, 3, 5, SLACK.aubergine);
  P(10, -13, 3, 1, SLACK.yellow);
  P(13, -17, 2, 2, armor.base);
  P(9, -24, 5, 5, armor.base);
  P(9, -24, 1, 5, armor.shade);
  P(10, -25, 3, 1, armor.light);
  P(11, -22, 3, 1, '#1f2937');
  P(12, -20, 1, 1, armor.shade);
  const sway = Math.round(Math.sin(t * 6) * (isMoving ? 1 : 0.6));
  P(10, -28, 2, 3, SLACK.red);
  P(9 - sway, -29, 2, 2, SLACK.red);
  // lance held high, the pennant flapping off it above the horse's head; the pole runs over its edge
  drawChatJuridicoFlag(ctx, isFlipped ? x0 : x0 + 17, by - 29, { isMirrored: isFlipped, flap: Math.floor(t * 8) % 2 });
  for (let i = 0; i < 16; i++) P(14 + Math.floor(i / 4), -16 - i, 1, 1, i >= 14 ? '#e5e7eb' : C.wood);
  // the shield on the near side, its mark always read the right way round
  const shieldCol = 3;
  drawSlackShield(ctx, isFlipped ? x0 + 24 - shieldCol - 7 : x0 + shieldCol, by - 17);
}

/** A rolled parchment with a red seal: missions the scout brought back. Centered on x, bottom at y. */
export function drawMissionScroll(ctx, x, y, t = 0) {
  const left = Math.round(x) - 5;
  const top = Math.round(y) - 8 + (Math.floor(t * 2) % 2);
  rect(ctx, left + 1, top, 8, 1, '#a07c3c');
  rect(ctx, left, top + 1, 10, 5, '#f3e2b3');
  rect(ctx, left + 1, top + 6, 8, 1, '#a07c3c');
  rect(ctx, left + 2, top + 2, 5, 1, '#b08d4f');
  rect(ctx, left + 2, top + 4, 4, 1, '#b08d4f');
  rect(ctx, left + 7, top + 4, 2, 2, '#c2262e');
  rect(ctx, left + 7, top + 6, 1, 1, '#8b1a20');
}

/**
 * The hero's aura, always on: a gold glow and a ring on the ground, pulsing, with sparks going round
 * and motes rising. At night (darkness 0 to 1) it is drawn again over the dark, glowing brighter.
 */
export function drawKnightAura(ctx, x, y, t, darkness = 0, scale = 1) {
  const cx = Math.round(x);
  const cy = Math.round(y);
  const pulse = 0.5 + 0.5 * Math.sin(t * 3);
  const [rx, ry] = [14 * scale, 5 * scale];
  drawGlow(ctx, cx, cy - 8 * scale, (24 + darkness * 10) * scale, SLACK.yellow, 0.18 + 0.12 * pulse + darkness * 0.9);
  ctx.save();
  ctx.globalAlpha = 0.45 + 0.35 * pulse;
  const points = 48 * scale;
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * Math.PI * 2;
    rect(ctx, cx + Math.round(Math.cos(angle) * rx), cy + Math.round(Math.sin(angle) * ry), 1, 1, SLACK.yellow);
  }
  ctx.globalAlpha = 1;
  for (let k = 0; k < 3; k++) {
    const angle = t * 1.6 + (k * Math.PI * 2) / 3;
    rect(ctx, cx + Math.round(Math.cos(angle) * rx), cy + Math.round(Math.sin(angle) * ry), scale, scale, '#fff3b0');
  }
  for (let k = 0; k < 4; k++) {
    const rise = (t * 0.6 + k / 4) % 1;
    ctx.globalAlpha = 1 - rise;
    rect(ctx, cx + Math.round(Math.cos(k * 1.7) * 11 * scale), cy - Math.round(rise * 20 * scale), 1, 1, SLACK.yellow);
  }
  ctx.restore();
}

// ---------- Outlines: pixel art that reads sharp on any ground ----------

const OUTLINE = '#120c07';
let outlineBuffers = null; // the sprite and its silhouette, reused frame after frame

/**
 * Draws a sprite with a 1 px dark outline around its silhouette. `box` ({ x, y, w, h }, integers) is
 * where the sprite lands; draw(c, dx, dy) paints it into a buffer, shifted by (dx, dy).
 */
export function drawOutlined(ctx, box, draw, color = OUTLINE) {
  const w = box.w + 2;
  const h = box.h + 2;
  outlineBuffers ??= [document.createElement('canvas'), document.createElement('canvas')];
  for (const canvas of outlineBuffers) {
    if (canvas.width !== w || canvas.height !== h) [canvas.width, canvas.height] = [w, h];
    else canvas.getContext('2d').clearRect(0, 0, w, h);
  }
  const [sprite, edge] = outlineBuffers;
  const spriteCtx = sprite.getContext('2d');
  spriteCtx.imageSmoothingEnabled = false;
  draw(spriteCtx, 1 - box.x, 1 - box.y);
  const edgeCtx = edge.getContext('2d');
  edgeCtx.globalCompositeOperation = 'source-over';
  edgeCtx.drawImage(sprite, 0, 0);
  edgeCtx.globalCompositeOperation = 'source-in';
  edgeCtx.fillStyle = color;
  edgeCtx.fillRect(0, 0, w, h);
  edgeCtx.globalCompositeOperation = 'source-over';
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) ctx.drawImage(edge, box.x - 1 + dx, box.y - 1 + dy);
  ctx.drawImage(sprite, box.x - 1, box.y - 1);
}

/** The map's knight, outlined. */
export function drawKnightOutlined(ctx, look, ax, ay, facing, isMoving, frame, t, level = 1) {
  const x = Math.round(ax);
  const y = Math.round(ay);
  drawOutlined(ctx, { x: x - 13, y: y - 31, w: 26, h: 32 }, (c, dx, dy) => drawKnight(c, look, x + dx, y + dy, facing, isMoving, frame, t, level));
}

/**
 * The scout at twice the detail, for its panel: the map sprite at 2x, then the finer pixels (glints,
 * the eye slit glowing, rivets, the rein, mane strands, the hash on the tabard, the barding's gold
 * diamonds), all outlined. Faces east; (ax, ay) is between the hooves, in its own pixels.
 */
export function drawKnightPortrait(ctx, look, ax, ay, t, level = 1) {
  const x = Math.round(ax);
  const y = Math.round(ay);
  const armor = KNIGHT_ARMOR[knightTier(level)];
  const mane = look.horse[2];
  drawOutlined(ctx, { x: x - 26, y: y - 62, w: 52, h: 64 }, (c, dx, dy) => {
    c.save();
    c.translate(x + dx, y + dy);
    c.scale(2, 2);
    drawKnight(c, look, 0, 0, 'e', false, 0, t, level);
    c.restore();
    // columns and rows from the point between the hooves; a map pixel (col, row) is (2 col - 24, 2 row) here
    const D = (col, row, w, h, color) => rect(c, x + dx + col, y + dy + row, w, h, color);
    // helm: a glint, the eye slit thinner with a gold glow, breathing holes and a rivet
    D(-4, -47, 2, 1, armor.light);
    D(-4, -46, 1, 1, armor.light);
    D(-2, -43, 6, 1, armor.base);
    D(1, -44, 1, 1, SLACK.yellow);
    D(1, -41, 1, 1, armor.shade);
    D(3, -41, 1, 1, armor.shade);
    D(-5, -41, 1, 1, armor.shade);
    // plume strands
    D(-3, -55, 1, 3, '#b8164a');
    D(-2, -52, 1, 2, '#ff5c8a');
    // shoulder, the hash on the tabard, the belt buckle, a knuckle
    D(-5, -37, 2, 1, armor.light);
    D(-2, -31, 1, 1, SLACK.blue);
    D(-1, -31, 1, 1, SLACK.green);
    D(-2, -30, 1, 1, SLACK.red);
    D(-1, -30, 1, 1, SLACK.yellow);
    D(-2, -26, 2, 2, '#fff3b0');
    D(4, -32, 1, 1, armor.light);
    // horse: eye glint, inner ear, cheek strap and the rein to the rider's hand, mane strands, a lit back
    D(16, -34, 1, 1, '#ffffff');
    D(14, -37, 1, 1, look.horse[1]);
    D(13, -34, 1, 4, '#5e3c20');
    D(5, -31, 8, 1, '#5e3c20');
    for (const [col, row] of [[7, -33], [8, -29], [7, -25]]) D(col, row, 1, 2, '#4a4238');
    D(8, -24, 6, 1, '#f3efe6');
    D(6, -34, 1, 1, mane);
    // barding: gold diamonds on the cloth
    for (const col of [-13, -8, 3]) {
      D(col, -20, 1, 1, SLACK.yellow);
      D(col - 1, -19, 3, 1, SLACK.yellow);
      D(col, -18, 1, 1, SLACK.yellow);
    }
    // the pennant with the finer mark, the pole back over its corner
    drawChatJuridicoFlag(c, x + dx + 10, y + dy - 58, { flap: Math.floor(t * 8) % 2, isFine: true });
    D(10, -56, 2, 2, C.wood);
    // lance: the steel tip shining, a lit edge along the shaft
    D(11, -62, 1, 1, '#ffffff');
    for (let i = 0; i < 14; i++) D(2 * (14 + Math.floor(i / 4)) - 24, 2 * (-16 - i), 1, 2, '#a8773f');
    // shield: gold studs on the rim
    D(-17, -33, 1, 1, '#c99a2e');
    D(-6, -33, 1, 1, '#c99a2e');
  });
}
