// How the world is drawn: straight from above (the classic map) or isometric, Ragnarok-style, with
// the ground as a diamond and every sprite standing up on it. A projection is one affine map from
// world pixels to canvas pixels, so roads, paths and placement work the same in both views.

export const VIEW_MODES = ['top', 'iso'];

// 2:1 isometric: one world pixel along a road is 1 px across and 0.5 px down the screen.
const ISO_K = 1;
// Room around the ground diamond for the tallest sprites (towers, spires) at its corners.
const ISO_PAD = { side: 24, top: 72, bottom: 24 };
// The camera turns in quarter turns, as Q/E do in the game: [r00, r01, r10, r11].
const ROTATIONS = [
  [1, 0, 0, 1],
  [0, -1, 1, 0],
  [-1, 0, 0, -1],
  [0, 1, -1, 0],
];

/** { a, b, c, d, e, f } (as canvas setTransform takes them) plus the canvas size it needs. */
export function makeProjection(mode, rotation, worldW, worldH) {
  if (mode !== 'iso') return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, width: worldW, height: worldH };
  const [r00, r01, r10, r11] = ROTATIONS[((rotation % 4) + 4) % 4];
  const a = ISO_K * (r00 - r10);
  const c = ISO_K * (r01 - r11);
  const b = (ISO_K / 2) * (r00 + r10);
  const d = (ISO_K / 2) * (r01 + r11);
  const groundW = ISO_K * (worldW + worldH);
  const groundH = groundW / 2;
  const width = Math.ceil(groundW + 2 * ISO_PAD.side);
  const height = Math.ceil(groundH + ISO_PAD.top + ISO_PAD.bottom);
  // The world's center lands in the middle of the ground area, whatever the rotation.
  const [cx, cy] = [worldW / 2, worldH / 2];
  const e = width / 2 - (a * cx + c * cy);
  const f = ISO_PAD.top + groundH / 2 - (b * cx + d * cy);
  return { a, b, c, d, e, f, width, height };
}

export function project(p, x, y) {
  return { x: p.a * x + p.c * y + p.e, y: p.b * x + p.d * y + p.f };
}

export function unproject(p, sx, sy) {
  const det = p.a * p.d - p.b * p.c;
  const x = sx - p.e;
  const y = sy - p.f;
  return { x: (p.d * x - p.c * y) / det, y: (-p.b * x + p.a * y) / det };
}

/** A step in the world as seen on screen (no translation): to face sprites the way they walk. */
export function projectStep(p, dx, dy) {
  return { x: p.a * dx + p.c * dy, y: p.b * dx + p.d * dy };
}
