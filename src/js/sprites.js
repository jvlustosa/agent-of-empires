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
];
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

const ICONS = {
  terminal: ['#....', '.#...', '..#..', '.#...', '#.###'],
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
  return pick(TEAM_COLORS, hashString(project))[0];
}

export function teamShade(project) {
  return pick(TEAM_COLORS, hashString(project))[1];
}

// Villagers wear the repository's color (teams read at a glance); face, hair and hat vary per
// session. kind 'scout' is the observer that rides between the bases.
export function makeLook(id, project, kind = 'villager') {
  const h = hashString(id);
  const [tunic, tunicShade] = pick(TEAM_COLORS, hashString(project));
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
export function drawEmote(ctx, tipX, tipY, kind, t) {
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
    const isBig = Math.floor(t * 2.5) % 2 === 0;
    if (isBig) bitmap(ctx, x + 2, y + 2, SPARK_5, { '#': C.claude });
    else rect(ctx, x + 4, y + 4, 1, 1, C.claude);
    return;
  }
  if (!icon) return;
  bitmap(ctx, x + 2, y + 2, icon, { '#': filled?.fg ?? darken(kindInfo(kind).color) });
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
];

// How big the town center stands in the 3D view, at first from the repository's size and age.
export const SIZES = [
  { id: 1, name: 'Pequeno', hint: 'Centro da Cidade menor, sem muralha' },
  { id: 2, name: 'Médio', hint: 'O tamanho de sempre' },
  { id: 3, name: 'Grande', hint: 'Maior, com muralha e quatro torres atrás' },
  { id: 4, name: 'Colossal', hint: 'Muralha alta, torres maiores e torre de menagem' },
];

export const DEFAULT_TOWN = { era: 2, style: 'prontera', size: 2 };

// Everything a town center draws stays inside its 40 x 36 box, widened by this on each side and
// raised by TOWN_REACH_UP (spires, the clock tower, Geffen's crystal).
export const TOWN_REACH_SIDE = 5;
export const TOWN_REACH_UP = 16;

const ERA_SHAPES = [
  { bodyW: 24, bodyH: 13, windowDx: 7, roofH: 7, towerH: 0 },
  { bodyW: 30, bodyH: 17, windowDx: 10, roofH: 9, towerH: 0 },
  { bodyW: 32, bodyH: 18, windowDx: 10, roofH: 10, towerH: 26 },
  { bodyW: 34, bodyH: 19, windowDx: 11, roofH: 11, towerH: 29 },
  { bodyW: 36, bodyH: 20, windowDx: 12, roofH: 12, towerH: 32 },
];

const STYLE_ART = {
  prontera: { wall: C.stone, light: C.stoneLight, dark: C.stoneDark, trim: C.woodDark, texture: 'stone' },
  geffen: { wall: '#6d7192', light: '#9095b6', dark: '#4a4d68', trim: '#2f2b45', texture: 'slate' },
  payon: { wall: '#e4d6b2', light: '#f3ead2', dark: '#b3a07a', trim: '#4a2e1a', texture: 'timber' },
  morroc: { wall: '#d9b77e', light: '#efd6a4', dark: '#ae8c56', trim: '#7a5a30', texture: 'sand', isArched: true },
  aldebaran: { wall: '#ddd3bf', light: '#f2ecdd', dark: '#a59a84', trim: '#5e4b3a', texture: 'brick' },
};

function townShape(era) {
  const index = Math.min(ERA_SHAPES.length - 1, Math.max(0, Math.round(Number(era) || DEFAULT_TOWN.era) - 1));
  return { era: index + 1, ...ERA_SHAPES[index] };
}

function townArt(style) {
  return STYLE_ART[style] ?? STYLE_ART[DEFAULT_TOWN.style];
}

/** How far above the door's foot a town center's roof ridge stands (spires and towers aside). */
export function townCenterHeight(design = DEFAULT_TOWN) {
  const shape = townShape(design.era);
  return shape.bodyH + shape.roofH;
}

/** Window lights of a town center, relative to its 40 x 36 box, for the night glow. */
export function townCenterLights(design = DEFAULT_TOWN) {
  const shape = townShape(design.era);
  const y = 36 - (shape.era === 1 ? 10 : 12) + 2.5;
  const lights = [-1, 1].map((side) => ({ x: 20 + side * shape.windowDx + 0.5, y, r: 9, color: '#fcd77a' }));
  const roofTop = 36 - shape.bodyH + 1 - shape.roofH;
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
  const shape = townShape(design.era);
  const art = townArt(design.style);
  const style = STYLE_ART[design.style] ? design.style : DEFAULT_TOWN.style;
  const cx = ox + 20;
  const gy = oy + 36;
  ctx.save();
  if (rise < 1) {
    // being founded: rises from the ground
    const shown = Math.max(1, Math.round((36 + TOWN_REACH_UP) * rise));
    ctx.beginPath();
    ctx.rect(ox - TOWN_REACH_SIDE - 2, gy - shown, 40 + 2 * TOWN_REACH_SIDE + 4, shown + 2);
    ctx.clip();
  }
  const span = shape.bodyW + (shape.towerH ? 12 : 2);
  rect(ctx, cx - span / 2, gy - 1, span, 2, C.shadow);
  drawTownBody(ctx, cx, gy, shape, art, isNight);
  const roofBase = gy - shape.bodyH + 1;
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
  const wy = gy - (isHut ? 10 : 12);
  const glass = isNight ? C.windowLit : C.windowDark;
  for (const side of [-1, 1]) {
    const wx = cx + side * shape.windowDx - 2;
    rect(ctx, wx, wy, 5, 5, art.trim);
    rect(ctx, wx + 1, wy + 1, 3, 3, glass);
    if (art.texture === 'timber') rect(ctx, wx + 2, wy + 1, 1, 3, art.trim);
  }
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
  if (art.texture === 'brick') for (let y = top + 3; y < gy - 2; y += 3) rect(ctx, tx + 1, y, 5, 1, art.dark);
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
export function drawBanner(ctx, x, y, team, t) {
  const [color, shade] = team;
  rect(ctx, x - 1, y - 1, 3, 2, C.shadow);
  rect(ctx, x, y - 28, 1, 28, C.woodDark);
  rect(ctx, x, y - 29, 1, 1, C.gold);
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

