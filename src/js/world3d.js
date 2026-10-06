// The map in 3D, Age of Empires III style: a sunlit, shadowed diorama of the same world the 2D map
// simulates. The Empire keeps running everything (paths, bases, villagers, orders); this only draws
// it, moves the camera, and turns clicks on the scene back into world coordinates.
// World (x, y) maps to three.js (x, z), y up; one world pixel is one unit.
import * as THREE from '../vendor/three/three.module.min.js';
import * as S from './sprites.js';
import { kindInfo } from './kinds.js';
import { horseModel, modelParts, modelsReady, villagerModel } from './models.js';
import { CORE_WALLS } from './plot.js';
import { mergeGeometries } from '../vendor/three/addons/utils/BufferGeometryUtils.js';

// A narrow lens from far away: close to isometric, as in Ragnarok Online and AoE's diamond maps.
const FOV = 20;
// The camera looks down steeply over the whole map and lowers as it zooms in, like AoE III's.
const PITCH_FAR = 0.98; // ~56°
const PITCH_NEAR = 0.72; // ~41°
// The world is seen on the diagonal (a diamond), and opens a little closer than the whole map.
const START_YAW = Math.PI / 4;
const START_ZOOM = 1.8;
const ZOOM_MAX = 8;
const MARGIN = 140; // forest and hills around the playable land
// A river across the woods north of the land, where the empire never grows: it flows west to east
// winding around z, about `width` wide, at `level` over the flat valley the hills open `valley` units
// to each side of it; its ripples drift downstream by `flow` texture repeats a second.
const RIVER = { z: -62, width: 24, valley: 40, level: 0.4, flow: 0.08 };
const RIPPLE_TILE = 48; // world units along the river per repeat of the ripple texture
const GROUND_RES = 4; // texture pixels per world unit
// Grass tones (sRGB): the floor under the woods, deep and light meadow, and sun-dried patches.
const GRASS = { forest: [40, 70, 30], deep: [58, 100, 38], light: [116, 152, 62], dry: [156, 156, 82] };
const TONE_CELL = 6; // world units per sample of the broad grass tones, scaled up smooth
const EARTH_CELL = 3; // the same for the patches of bare earth, finer so their edges stay ragged
const BLADE_TILE = 40; // world units of the repeating pattern of painted blades
const TUFT_SPACING = 7; // about one 3D tuft of grass per this many world units, on open land
const ROTATE_MS = 320;
const LINK_COLOR = '#facc15';
// The emote's canvas, wide enough for "MERGE", at 6/7 of a world unit per pixel: its balloon comes
// out ~13, about the villager's height.
const FEELING_CANVAS = 40;
const FEELING_SIZE = (FEELING_CANVAS * 6) / 7;
// A villager picked up with the mouse hangs from the hand at its head, this far over its feet. It is in
// the hand, in front of everything: drawn a second time over the frame (its own layer, depth cleared),
// so no building hides it.
const HOLD_GRIP = 12;
const HELD_LAYER = 1;
// Behind the map is the app's dark background (--bg in style.css), day and night: no sky blue.
const MAP_BACKGROUND = '#14110c';
const ERA_3D = [
  { w: 24, d: 18, wall: 9, roof: 8, tower: 0 },
  { w: 30, d: 22, wall: 12, roof: 10, tower: 0 },
  { w: 32, d: 24, wall: 13, roof: 11, tower: 21 },
  { w: 34, d: 26, wall: 14, roof: 12, tower: 24 },
  { w: 36, d: 28, wall: 15, roof: 13, tower: 27 },
];
const STYLE_3D = {
  prontera: { wall: '#b7ae9c', trim: '#5e3c20' },
  geffen: { wall: '#6d7192', trim: '#2f2b45' },
  payon: { wall: '#e4d6b2', trim: '#4a2e1a' },
  morroc: { wall: '#d9b77e', trim: '#7a5a30' },
  aldebaran: { wall: '#ddd3bf', trim: '#5e4b3a' },
  alberta: { wall: '#ece6d6', trim: '#2f5d7c' },
  lutie: { wall: '#b5654a', trim: '#f4f4f0' },
  einbroch: { wall: '#7b5b4c', trim: '#3b3f4a' },
  juno: { wall: '#eeeae0', trim: '#8a7d5e' },
  umbala: { wall: '#7a5230', trim: '#3d2a17' },
};
// The town center's form (Padrão › Quadrado) stretches the era's body; it is never wider or deeper
// than the era's, so the castle keeps clear of the mine, the forge and the walls.
const FORM_3D = {
  1: { w: 1, d: 1, wall: 1, roof: 1 },
  2: { w: 1, d: 0.7, wall: 0.85, roof: 0.8 },
  3: { w: 0.82, d: 0.85, wall: 1.55, roof: 1.1 },
  4: { w: 0.92, d: 1, wall: 0.7, roof: 1.35 },
  5: { w: 0.78, d: 1, wall: 1.2, roof: 1.2 },
};
const SNOW = '#f4f4f0';
// The castle's size (Pequeno › Colossal): Grande and Colossal raise curtain walls with corner
// towers behind the town center, as the castles of Age of Empires; Colossal adds a keep on the back wall.
const SIZE_3D = [
  { scale: 0.8, wall: 0, tower: 0, keep: 0 },
  { scale: 1, wall: 0, tower: 0, keep: 0 },
  { scale: 1.12, wall: 7, tower: 13, keep: 0 },
  { scale: 1.22, wall: 10, tower: 18, keep: 40 },
];
function sizeOf(design) {
  return SIZE_3D[Math.min(3, Math.max(0, (design.size ?? 2) - 1))];
}
// Stretched by the free dimensions, a town center spans no more across the yard, nor runs deeper, than
// the biggest the sizes already build (era 5, Colossal): it keeps clear of the mine, the forge and the
// villagers at its walls, whatever its turn. Walls stay taller than the villagers.
const MAX_SPAN = ERA_3D[4].w * SIZE_3D[3].scale;
const MAX_DEPTH = ERA_3D[4].d * SIZE_3D[3].scale;
const MIN_WALL = 6;
// On grown land (design.growth, from plot.js: k 0 › 1) the town center grows with it, by these
// fractions at k = 1: deeper into the bailey, as far as the room plot.js keeps clear behind it,
// taller under a taller roof, and wider only as far as MAX_SPAN lets it.
const GROW_3D = { span: 0.3, depth: 1, wall: 0.6, roof: 0.4 };
// A half-lot core (design.growth.isSmall) has its town center at this scale, and its little mine
// and forge at SMALL_SITE, so they keep to their corners.
const SMALL_TC_3D = 0.7;
const SMALL_SITE = 0.5;

// The era's town center as the form, the free dimensions and the land shape it; corner towers stay
// taller than the walls they flank.
function bodyOf(design) {
  const era = ERA_3D[Math.min(4, Math.max(0, design.era - 1))];
  const form = FORM_3D[design.form] ?? FORM_3D[1];
  const scale = sizeOf(design).scale;
  const isTurned = (design.rotation ?? 0) % 2 === 1; // its width runs front to back
  const { k = 0, room = 0 } = design.growth ?? {};
  const [span, deep, maxDeep] = [1 + k * GROW_3D.span, 1 + k * GROW_3D.depth, MAX_DEPTH + room];
  const stretch = (value, percent, cap) => Math.min((value * percent) / 100, Math.max(value, cap / scale));
  const w = stretch(era.w * form.w, (design.width ?? 100) * (isTurned ? deep : span), isTurned ? maxDeep : MAX_SPAN);
  const d = stretch(era.d * form.d, (design.depth ?? 100) * (isTurned ? span : deep), isTurned ? MAX_SPAN : maxDeep);
  const wall = Math.max(MIN_WALL, (era.wall * form.wall * (design.height ?? 100) * (1 + k * GROW_3D.wall)) / 100);
  const roof = era.roof * form.roof * (1 + k * GROW_3D.roof);
  const tower = era.tower ? Math.max(era.tower, wall + roof / 2 + 4) : 0;
  // plan: how much deeper than the era's it is for its width (square roofs follow it)
  return { w, d, wall, roof, tower, windowY: Math.min(wall, era.wall) * 0.42, plan: d / era.d / (w / era.w), isTall: wall / era.wall > 1.5 };
}

// The geometries a build made for itself: primitives and merged kit pieces, not the models' own nor
// the shared pane.
function disposeOwn(group) {
  group.traverse((node) => {
    if (node.geometry && node.geometry !== PANE_BOX && (node.geometry.type !== 'BufferGeometry' || node.geometry.userData.isOwn)) node.geometry.dispose();
  });
}

// Straw with a tint of the team color, as Umbala's 2D thatch (the ridge cap carries the color itself).
function thatchOf(color) {
  return `#${new THREE.Color(color).lerp(new THREE.Color('#d2ad5c'), 0.8).getHexString()}`;
}

// Einbroch's works: the gear turns, smoke puffs rise from the stacks, swell and fade.
function animateWorks(node, t) {
  if (node.userData.isGear) node.rotation.z = t * 0.6;
  if (!node.userData.isSmoke) return;
  const k = (t * 0.35 + node.userData.phase) % 1;
  node.position.set(Math.sin(t + node.userData.phase * 9) * 1.2 + k * 3, node.userData.baseY + k * 14, 0);
  node.scale.setScalar(0.8 + k * 1.8);
  node.material.opacity = 0.5 * (1 - k);
}

// Behind the town center (base-local), clear of the mine, the forge and the yard's work spots.
const WALL_BOX = { x0: CORE_WALLS.x0, x1: CORE_WALLS.x1, z0: CORE_WALLS.y0, z1: CORE_WALLS.y1 };
// A big castle on the smallest land walls three sides of WALL_BOX, a tower on each corner; grown land
// brings its own walls (plot.js).
const BOX_WALLS = (({ x0, x1, z0, z1 }) => {
  const path = [[x0, z1], [x0, z0], [x1, z0], [x1, z1]];
  return { path, towers: path, keep: null };
})(WALL_BOX);
// The grown land's buildings (plot.js): body height per kind, village roofs (null: the team's) and crops.
const BODY_3D = { hall: 8, house: 7, barn: 9 };
const VILLAGE_ROOFS_3D = [null, '#a34e34', '#7a6a58'];
const CROPS_3D = ['#e0c060', '#3f8a40', '#9bb84a'];
// A base whose land is being resized rebuilds live, but no more often than this (a big one is ~500 meshes).
const RESIZE_REBUILD_MS = 80;
const WALL_THICK = 3;
const MERLON_STEP = 4;
// The stone wall round the map (Configurações › Borda do mapa), taller and thicker than a bailey's, on
// a wider footing. The gatehouse's lintel clears the Batedor on horseback; its towers stand taller.
const BORDER_WALL_3D = { height: 17, thick: 6, footH: 3, towerH: 28, radius: 6.5, roofH: 11 };
const BORDER_GATE_3D = { clear: 24, lintelH: 7, towerScale: [1.15, 1.35, 1.15], bar: 2.5 };
const ESCORT = [[-10, 2], [10, 2], [-15, -3], [15, -3], [-6, 7], [6, 7]];
// The 2D work fronts in 3D: the tool, one swing in seconds, the shoulder angles (0 hangs, -π points
// straight up), how far the body leans into the blow and what flies off where it lands.
const WORK_3D = {
  mine: { tool: 'pickaxe', period: 0.8, raised: -3.3, strike: -1, lean: 0.25, chips: '#facc15', spread: 4 },
  forge: { tool: 'hammer', period: 0.5, raised: -2.7, strike: -1.25, lean: 0.12, chips: '#ffb547', spread: 6 },
  build: { tool: 'hammer', period: 0.65, raised: -2.9, strike: -1.6, lean: 0.1, chips: '#d8c7a2', spread: 3 },
};
// The villager model's clip for each tool, and how far into it the blow lands.
const WORK_CLIPS = {
  pickaxe: { clip: '2H_Melee_Attack_Chop', strikeAt: 0.5 },
  hammer: { clip: '1H_Melee_Attack_Chop', strikeAt: 0.58 },
};
// The tower lookout's spyglass, and the hand on the chin while thinking: the moment of Use_Item the
// hand is up at the face.
const HAND_AT_FACE = 0.43;
const CLIP_FADE = 0.15; // seconds blending one clip into the next
// Ready-made models (models.js) are about 2 units across: these sizes match the procedural props
// they replace and keep the mine and the forge clear of the yard where villagers work them. A
// villager stands about as tall as the procedural one, 14 units.
const MODEL_SCALE = { tree: 15, mine: 16, forge: 20, villager: 6.5, horse: 4.2 };
// Where a rider sits on the horse (horse units, about its torso bone) and how high its hips stand
// above its feet (villager units): the seat drops it onto the horse's back.
const SADDLE = { y: 3.2, z: -0.35, seat: 0.36 };
// The Batedor's barding over the horse's back (horse units): the aubergine cloth, a gold band at its hem.
const BARDING = [
  { w: 1.62, h: 0.9, d: 2.2, color: S.SLACK.aubergine },
  { w: 1.66, h: 0.12, d: 2.24, color: S.SLACK.yellow },
];
const BARDING_AT = { y: 2.45, z: -0.35 };
// The forge model's furnace mouth (model units, front +z): the fire glows in it, its light in front.
const FORGE_MOUTH = { x: 0.21, y: 0.065, z: 0.33 };
// Gold at the foot of the mine model's rock face, clear of its rails and crates (mine-local).
const MINE_NUGGETS = [[-12, 10], [-7, 11], [-2.5, 10], [9, 10], [12, 8]];
// A light tint per tree over the model's own greens, so the woods don't look cloned.
const TREE_TINTS = ['#ffffff', '#dfeccf', '#f2f7e4', '#cfe0c4', '#e8f0d0'];
const UP = new THREE.Vector3(0, 1, 0);
// The town kit's pieces fill a 1-unit cell, a wall on the cell's +x side. The gable roof's extent
// (ridge along its x), and the pane set behind a window's opening, which is a hole in the wall.
const KIT_GABLE = { x: 1.1, y: 0.571, z: 1.07 };
const PANE = new THREE.Matrix4().compose(new THREE.Vector3(0.43, 0.5, 0), new THREE.Quaternion(), new THREE.Vector3(0.02, 0.44, 0.24));
const PANE_BOX = new THREE.BoxGeometry(1, 1, 1);
const STRIKE_AT = 0.72; // share of a swing spent winding up and coming down
const CHIP_LIFE = 0.5; // in swings
const CHIPS = 5;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function latticeValue(x, y, seed) {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

// Smooth value noise in [0, 1): a seeded lattice blended with smoothstep.
function valueNoise(x, y, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const u = (x - x0) * (x - x0) * (3 - 2 * (x - x0));
  const v = (y - y0) * (y - y0) * (3 - 2 * (y - y0));
  const top = latticeValue(x0, y0, seed) * (1 - u) + latticeValue(x0 + 1, y0, seed) * u;
  const bottom = latticeValue(x0, y0 + 1, seed) * (1 - u) + latticeValue(x0 + 1, y0 + 1, seed) * u;
  return top * (1 - v) + bottom * v;
}

// Four octaves of value noise: broad shapes with ragged, natural edges.
function fbm(x, y, seed) {
  let sum = 0;
  let amplitude = 0.5;
  for (let octave = 0, freq = 1; octave < 4; octave++, freq *= 2, amplitude /= 2) sum += amplitude * valueNoise(x * freq, y * freq, seed + octave);
  return sum / 0.9375;
}

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// The river's middle and half-width at x: two slow bends and a gentle swell, never straight.
function riverAt(x) {
  return {
    z: RIVER.z + 14 * Math.sin(x * 0.0075 + 1.3) + 5 * Math.sin(x * 0.021),
    half: RIVER.width / 2 + 2.5 * Math.sin(x * 0.013 + 0.7),
  };
}

// How far (x, z) is from the nearer bank of the river: negative on the water.
function riverBankDistance(x, z) {
  const { z: middle, half } = riverAt(x);
  return Math.abs(z - middle) - half;
}

// The river every few units, from the west edge of the woods to the east one.
function riverPath(w) {
  const xs = [];
  for (let x = -MARGIN; x < w + MARGIN; x += 6) xs.push(x);
  xs.push(w + MARGIN);
  return xs.map((x) => ({ x, ...riverAt(x) }));
}

// Waiting villagers wave for ~1.2 s every 6 s (every 2.5 s when blocked), staggered by seed, as in 2D.
function isWaving(t, seed, isUrgent) {
  return (t + (seed % 6)) % (isUrgent ? 2.5 : 6) < 1.2;
}

// Blends into clip `name` and holds it `at` that share of its length: the map's own clocks drive
// every clip (walk, swing, wave), so a model stays in step with the procedural poses it replaces.
function playClip(model, name, at, dt) {
  const clip = model.clips[name];
  const action = model.mixer.clipAction(clip);
  if (model.action !== action) {
    action.reset().setEffectiveTimeScale(0).play();
    model.action?.crossFadeTo(action, CLIP_FADE, false);
    model.action = action;
  }
  action.time = (at - Math.floor(at)) * clip.duration;
  model.mixer.update(dt);
}

// The rig rests in a T, arms along ±x and legs straight down: a bone is turned from there about a
// model axis, over what the clip did to it. Each limb bone's rest, kept when the villager is built.
const LIMB_BONES = ['upperarmr', 'lowerarmr', 'upperarml', 'lowerarml', 'upperlegr', 'lowerlegr', 'upperlegl', 'lowerlegl'];
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const DOWN = new THREE.Vector3(0, -1, 0);
const turn = new THREE.Quaternion();

function limbRests(root) {
  root.updateMatrixWorld(true);
  const rootInv = root.getWorldQuaternion(new THREE.Quaternion()).invert();
  const inModel = (node) => rootInv.clone().multiply(node.getWorldQuaternion(new THREE.Quaternion()));
  return Object.fromEntries(LIMB_BONES.map((name) => {
    const bone = root.getObjectByName(name);
    return [name, { bone, world: inModel(bone), parentInv: inModel(bone.parent).invert() }];
  }));
}

// An arm out to the side, a little above the T's level, the forearm up by `angle`: a wave whose hand
// clears the big head from the camera above. side: 'r' | 'l'. The mixer only writes a bone when its
// clip moves it, so what the clip had is kept and put back next frame (`model.undo`).
function raiseArm(model, side, angle) {
  const sign = side === 'r' ? -1 : 1;
  for (const [name, bend] of [[`upperarm${side}`, 0.4], [`lowerarm${side}`, angle]]) {
    const { bone, world, parentInv } = model.rest[name];
    model.undo.push([bone, bone.quaternion.clone()]);
    bone.quaternion.copy(parentInv).multiply(turn.setFromAxisAngle(Z_AXIS, sign * bend)).multiply(world);
  }
}

// Points a leg bone along `dir` (model space) from its rest straight down; `parentAim`, the turn
// given to its parent bone, is taken back out so the two add up. Returns this bone's turn.
function aimLeg(model, name, dir, parentAim) {
  const { bone, world, parentInv } = model.rest[name];
  model.undo.push([bone, bone.quaternion.clone()]);
  const aim = new THREE.Quaternion().setFromUnitVectors(DOWN, dir.normalize());
  bone.quaternion.copy(parentInv);
  if (parentAim) bone.quaternion.multiply(parentAim.clone().invert());
  bone.quaternion.multiply(aim).multiply(world);
  return aim;
}

// Astride: thighs out and forward around the horse's back, shins down its flanks. The chibi legs
// are short, so the knees open wide to clear the horse.
function sitAstride(model) {
  for (const [side, x] of [['l', 1], ['r', -1]]) {
    const thigh = aimLeg(model, `upperleg${side}`, new THREE.Vector3(0.8 * x, -0.35, 0.45));
    aimLeg(model, `lowerleg${side}`, new THREE.Vector3(0.25 * x, -1, 0.1), thigh);
  }
}

export class World3D {
  constructor(container, empire, layout) {
    this.empire = empire;
    this.L = layout;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'world-3d';
    container.insertBefore(this.canvas, container.querySelector('.world-overlay'));
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.isSimple = empire.isSimple;
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.shadowMap.enabled = !this.isSimple;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    // A GPU hang resets the context (i915 does it to WebKit) and three.js stops drawing: without this
    // the 3D map stays blank until the app restarts, so the empire carries on in 2D meanwhile.
    this.isContextLost = false;
    this.canvas.addEventListener('webglcontextlost', () => {
      this.isContextLost = true;
      empire.onContextLost();
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.isContextLost = false;
      this.markStatic();
    });
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(MAP_BACKGROUND);
    this.scene.fog = new THREE.Fog(MAP_BACKGROUND, 900, 2200);
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 4, 5000);
    this.cam = { target: new THREE.Vector3(), distance: 900, yaw: START_YAW, zoom: START_ZOOM, fitDistance: 900 };
    this.yawTween = null;
    this.cameraVersion = 0;
    this.materials = new Map();
    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.staticGroup = new THREE.Group();
    this.scene.add(this.staticGroup);
    this.bases = new Map(); // project -> { group, key, parts }
    this.units = new Map(); // id -> { group, parts, last }
    this.bots = new Map(); // bot id -> group
    this.pickables = [];
    this.staticKey = '';
    this.emoteTextures = new Map();
    this.addLights();
    this.ghost = this.buildGhosts();
    // the ready-made models take over from the procedural props as soon as they load
    modelsReady.then(() => {
      this.markStatic();
      for (const entry of this.bases.values()) entry.key = '';
      if (this.preview) this.preview.key = '';
      if (this.heroPreview) this.heroPreview.key = '';
      for (const entry of this.units.values()) this.dropUnit(entry); // dressed again as models
      this.units.clear();
    });
  }

  // ---------- Setup ----------

  addLights() {
    this.hemi = new THREE.HemisphereLight('#cfe4ff', '#55602f', 1.1);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#ffe2b0', 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.6;
    this.scene.add(this.sun, this.sun.target);
    for (const light of [this.hemi, this.sun]) light.layers.enable(HELD_LAYER); // they light the villager in the hand too
  }

  mat(color, options = {}) {
    const key = `${color}|${JSON.stringify(options)}`;
    if (!this.materials.has(key)) this.materials.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...options }));
    return this.materials.get(key);
  }

  mesh(geometry, material, { cast = true, receive = true } = {}) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    return mesh;
  }

  box(w, h, d, color, x = 0, y = 0, z = 0) {
    const mesh = this.mesh(new THREE.BoxGeometry(w, h, d), typeof color === 'string' ? this.mat(color) : color);
    mesh.position.set(x, y + h / 2, z);
    return mesh;
  }

  // A gabled roof w wide, h tall and d deep, the ridge from front to back: the town kit's once it has
  // loaded, its gable ends and eaves painted as the walls under it (`paint`), else all `color`.
  gable(w, h, d, color, paint = null) {
    const kit = modelParts('gable', { wall: color, trim: color, ...paint, roof: color });
    if (kit) {
      const roof = this.mesh(kit.geometry, kit.material);
      roof.rotation.y = Math.PI / 2; // the kit's ridge runs along its x
      roof.scale.set(d / KIT_GABLE.x, h / KIT_GABLE.y, w / KIT_GABLE.z);
      return roof;
    }
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2, 0);
    shape.lineTo(w / 2, 0);
    shape.lineTo(0, h);
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
    geometry.translate(0, 0, -d / 2);
    return this.mesh(geometry, this.mat(color));
  }

  pyramid(radius, h, color) {
    const mesh = this.mesh(new THREE.ConeGeometry(radius, h, 4), this.mat(color));
    mesh.rotation.y = Math.PI / 4;
    mesh.position.y = h / 2;
    return mesh;
  }

  dome(radius, color) {
    return this.mesh(new THREE.SphereGeometry(radius, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), this.mat(color, { roughness: 0.5 }));
  }

  // Snow on the upper third of a cone of this radius and height standing at `base` (Lutie's towers).
  snowTip(radius, height, base) {
    const tip = this.mesh(new THREE.ConeGeometry(radius * 0.36, height * 0.34, 12), this.mat(SNOW), { cast: false });
    tip.position.y = base + height * 0.83 + 0.1;
    return tip;
  }

  pixelRatio() {
    return this.isSimple ? 1 : Math.min(window.devicePixelRatio || 1, 2);
  }

  /** Simplified map: no shadows, 1x pixels, no grass, woods, border wall or grown villages. */
  setSimple(isOn) {
    this.isSimple = isOn;
    this.renderer.shadowMap.enabled = !isOn;
    this.renderer.setPixelRatio(this.pixelRatio());
    this.scene.traverse((object) => {
      for (const material of [object.material ?? []].flat()) material.needsUpdate = true; // shadows on or off take a recompile
    });
    this.markStatic(); // the bases rebuild on their own: the mode is part of their key
  }

  setActive(isActive) {
    this.canvas.style.display = isActive ? 'block' : 'none';
    this.isActive = isActive;
  }

  resize(width, height) {
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.fitCamera(false);
  }

  // ---------- Camera ----------

  get worldSize() {
    return { w: this.L.WORLD_W, h: this.empire.worldH };
  }

  // Distance that shows the whole map; zoom 1 is that, ZOOM_MAX is a close look at one base.
  fitCamera(isRecentered = true) {
    const { w, h } = this.worldSize;
    const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const radius = Math.hypot(w, h) / 2; // whatever the rotation, the map fits in this circle
    const byHeight = (radius * 0.72 + 40) / tan;
    const byWidth = (radius + 30) / (tan * this.camera.aspect);
    this.cam.fitDistance = Math.max(byHeight, byWidth);
    if (isRecentered || !this.hasCamera) {
      this.cam.target.set(w / 2, 0, h / 2 + 10);
      this.hasCamera = true;
    }
    this.applyZoom(this.cam.zoom);
  }

  applyZoom(zoom) {
    this.cam.zoom = Math.min(ZOOM_MAX, Math.max(1, zoom));
    this.cam.distance = this.cam.fitDistance / this.cam.zoom;
    if (this.cam.zoom === 1) {
      const { w, h } = this.worldSize;
      this.cam.target.set(w / 2, 0, h / 2 + 10);
    }
    this.updateCamera();
  }

  get pitch() {
    const k = Math.log(this.cam.zoom) / Math.log(ZOOM_MAX);
    return PITCH_FAR + (PITCH_NEAR - PITCH_FAR) * k;
  }

  updateCamera() {
    const { target, distance, yaw } = this.cam;
    const pitch = this.pitch;
    const { w, h } = this.worldSize;
    target.x = Math.min(w + 40, Math.max(-40, target.x));
    target.z = Math.min(h + 40, Math.max(-40, target.z));
    this.camera.position.set(
      target.x + Math.sin(yaw) * Math.cos(pitch) * distance,
      Math.sin(pitch) * distance,
      target.z + Math.cos(yaw) * Math.cos(pitch) * distance,
    );
    this.camera.lookAt(target);
    // Haze only far behind what is in view (never a cloud over the map), and nothing clipped.
    this.scene.fog.near = distance * 1.4;
    this.scene.fog.far = distance * 3.5;
    this.camera.far = distance * 4 + 600;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.cameraVersion++;
  }

  /** Zooms keeping the ground under the pointer still (or the middle of the view). */
  zoomTo(zoom, clientX = null, clientY = null) {
    const before = clientX === null ? null : this.groundAtClient(clientX, clientY);
    this.applyZoom(zoom);
    if (!before || this.cam.zoom === 1) return this.cam.zoom;
    const after = this.groundAtClient(clientX, clientY);
    if (after) {
      this.cam.target.x += before.x - after.x;
      this.cam.target.z += before.y - after.y;
      this.updateCamera();
    }
    return this.cam.zoom;
  }

  /** Moves the view by screen pixels, like scrolling the 2D map. */
  panBy(dx, dy) {
    if (this.cam.zoom === 1) return;
    const unitsPerPx = (2 * this.cam.distance * Math.tan(THREE.MathUtils.degToRad(FOV / 2))) / this.height;
    const { yaw } = this.cam;
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const ahead = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    this.cam.target.addScaledVector(right, dx * unitsPerPx);
    this.cam.target.addScaledVector(ahead, (-dy * unitsPerPx) / Math.sin(this.pitch));
    this.updateCamera();
  }

  lookAt(x, y) {
    this.cam.target.set(x, 0, y);
    this.updateCamera();
  }

  /** Q / E: the camera turns 45°, smoothly. */
  rotate(step) {
    const from = this.cam.yaw;
    this.yawTween = { from, to: from + (step * Math.PI) / 4, start: performance.now() };
  }

  // ---------- Screen and ground ----------

  screenOf(x, y, height = 0) {
    const v = new THREE.Vector3(x, height, y).project(this.camera);
    return { x: ((v.x + 1) / 2) * this.width, y: ((1 - v.y) / 2) * this.height, isBehind: v.z > 1 };
  }

  /** Just over a base's town center roof, on screen; null until the base is built. */
  balloonPoint(project) {
    const entry = this.bases.get(project);
    if (!entry) return null;
    const { x, y, z } = entry.parts.balloonAt;
    return this.screenOf(entry.group.position.x + x, entry.group.position.z + z, y + 3);
  }

  /** The world point under the screen point, on the ground or on a level `height` above it. */
  groundAtLocal(sx, sy, height = 0) {
    const ndc = new THREE.Vector2((sx / this.width) * 2 - 1, 1 - (sy / this.height) * 2);
    this.raycaster.setFromCamera(ndc, this.camera);
    const point = new THREE.Vector3();
    const plane = height ? new THREE.Plane(UP, -height) : this.groundPlane;
    return this.raycaster.ray.intersectPlane(plane, point) ? { x: point.x, y: point.z } : null;
  }

  groundAtClient(clientX, clientY, height = 0) {
    const box = this.canvas.getBoundingClientRect();
    return this.groundAtLocal(clientX - box.left, clientY - box.top, height);
  }

  /** Where the feet are of a villager held `lift` off the ground by the head, the head under the pointer. */
  heldFeetAtClient(clientX, clientY, lift) {
    return this.groundAtClient(clientX, clientY, lift + HOLD_GRIP);
  }

  /** The first villager, soldier or building under the pointer: { id } | { id, botId } | { project }. */
  pick(clientX, clientY) {
    const box = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - box.left) / this.width) * 2 - 1, 1 - ((clientY - box.top) / this.height) * 2);
    this.raycaster.setFromCamera(ndc, this.camera);
    for (const hit of this.raycaster.intersectObjects(this.pickables, true)) {
      for (let node = hit.object; node; node = node.parent) {
        if (node.userData.hit && node.visible) return node.userData.hit;
      }
    }
    return null;
  }

  // ---------- Static scene: terrain, roads, woods, square ----------

  markStatic() {
    this.staticKey = '';
  }

  rebuildStatic() {
    const e = this.empire;
    const key = `${e.layoutKey}|${e.worldH}`;
    if (key === this.staticKey) return;
    this.staticKey = key;
    this.staticGroup.clear();
    const { w, h } = this.worldSize;
    this.staticGroup.add(this.buildTerrain(w, h));
    if (!this.isSimple) {
      this.staticGroup.add(this.buildGrass(w, h));
      this.staticGroup.add(this.buildWoods(w, h));
      if (this.empire.borderWall) this.staticGroup.add(this.buildBorderWall(this.empire.borderWall));
    }
    this.staticGroup.add(this.buildRiver(w));
    this.staticGroup.add(this.buildSquare());
    this.staticGroup.add(this.buildFog());
    const half = Math.max(w, h) * 0.75;
    Object.assign(this.sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 10, far: 2400 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.position.set(w / 2 - 420, 760, h / 2 + 300);
    this.sun.target.position.set(w / 2, 0, h / 2);
    this.fitCamera(false);
  }

  // The ground: soft grass, dirt roads from the path grid, trodden yards, the paved square and the
  // fog band, painted once into a texture; hills rise only outside the playable land.
  buildTerrain(w, h) {
    const L = this.L;
    const e = this.empire;
    const fullW = w + 2 * MARGIN;
    const fullH = h + 2 * MARGIN;
    const canvas = document.createElement('canvas');
    // the land grows with the empire: past the GPU's largest texture, the ground gets a bit coarser
    const res = Math.min(GROUND_RES, this.renderer.capabilities.maxTextureSize / Math.max(fullW, fullH));
    canvas.width = Math.round(fullW * res);
    canvas.height = Math.round(fullH * res);
    const ctx = canvas.getContext('2d');
    ctx.scale(res, res);
    ctx.translate(MARGIN, MARGIN);
    const random = rng(7);
    this.paintGrass(ctx, w, h, res);
    // the river's banks: dry sand fading into the grass, then wet mud where the water meets them,
    // wider and narrower along each side so they never read as a road
    const river = riverPath(w);
    for (const [grow, color] of [[8, 'rgba(150, 132, 92, 0.35)'], [5, 'rgba(160, 140, 96, 0.8)'], [2.5, '#6e5c3e']]) {
      ctx.fillStyle = color;
      ctx.beginPath();
      for (const { x, z, half } of river) ctx.lineTo(x, z - half - grow * (1 + 0.5 * Math.sin(x * 0.05)));
      for (const { x, z, half } of [...river].reverse()) ctx.lineTo(x, z + half + grow * (1 + 0.5 * Math.sin(x * 0.037 + 2)));
      ctx.fill();
    }
    const soft = (x, y, r, color) => {
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
      gradient.addColorStop(0, color);
      gradient.addColorStop(0.7, color);
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
    };
    // open land as in Age of Empires: worn patches of bare earth here and there in the grass
    this.paintEarth(ctx, L.MAP_X0, L.MAP_Y0, L.LAND_X1, e.landBottom);
    const roundRect = (x, y, w, h, r) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
      ctx.fill();
    };
    // flagstones in staggered rows: the square's paving and each base's waiting pen
    const pave = (x0, y0, pw, ph) => {
      ctx.fillStyle = '#9c927c';
      ctx.fillRect(x0, y0, pw, ph);
      for (let py = y0, row = 0; py < y0 + ph; py += 4, row++) {
        for (let px = x0 + (row % 2) * 3; px < x0 + pw; px += 6) {
          ctx.fillStyle = random() < 0.5 ? '#aaa08a' : '#8d8370';
          ctx.fillRect(px + 0.4, py + 0.4, Math.min(5.2, x0 + pw - px - 0.4), Math.min(3.2, y0 + ph - py - 0.4));
        }
      }
    };
    // trodden yards of each base: soft-edged earth
    for (const base of e.bases.values()) {
      const { x, y } = base.pos;
      const { core, yards } = e.planOf(base);
      const lay = e.layoutOf(base);
      const { ground } = lay;
      const local = [...ground.patches, [6, ground.yardY - 4, lay.w - 12, 9], [ground.gate.x - 4, ground.yardY, 8, lay.h - ground.yardY]];
      const patches = [...local.map(([px, py, pw, ph]) => [core.x + px, core.y + py, pw, ph]), ...yards.map((yard) => [yard.x, yard.y, yard.w, yard.h])];
      for (const [grow, alpha] of [[4, 0.1], [2.5, 0.14], [1, 0.2], [0, 0.32]]) {
        ctx.fillStyle = `rgba(150, 126, 82, ${alpha})`;
        for (const [px, py, pw, ph] of patches) roundRect(x + px - grow, y + py - grow, pw + 2 * grow, ph + 2 * grow, 4 + grow);
      }
      const { pen } = ground;
      pave(x + core.x + pen.x, y + core.y + pen.y, pen.w, pen.h);
    }
    // roads from the path grid: a darker edge everywhere first, then the worn middle, then pebbles
    const { isRoad, cols } = e.nav;
    const roadCells = [];
    isRoad.forEach((road, cell) => {
      if (!road) return;
      const col = cell % cols;
      roadCells.push([col * L.CELL + L.CELL / 2, ((cell - col) / cols) * L.CELL + L.CELL / 2]);
    });
    for (const [radius, color] of [[8, 'rgba(120, 96, 58, 0.18)'], [6.6, 'rgba(128, 100, 62, 0.9)'], [5.2, '#b08e5e']]) {
      ctx.fillStyle = color;
      for (const [cx, cy] of roadCells) {
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    for (const [cx, cy] of roadCells) {
      for (let k = 0; k < 3; k++) {
        ctx.fillStyle = random() < 0.5 ? '#8f7148' : '#c9a873';
        ctx.fillRect(cx - 4 + random() * 8, cy - 4 + random() * 8, 0.8, 0.8);
      }
    }
    // the square: paving and the earth around the campfire
    const sq = e.square;
    pave(sq.x + 6, sq.y + 6, L.SQUARE_W - 12, 58);
    soft(sq.x + L.CAMPFIRE.x, sq.y + L.CAMPFIRE.y - 8, 26, 'rgba(150, 118, 76, 0.85)');
    soft(sq.x + 34, sq.y + 160, 18, 'rgba(150, 118, 76, 0.7)');
    // the fog band: dim, unexplored land
    if (e.fogNames.length > 0) {
      ctx.fillStyle = 'rgba(40, 52, 38, 0.85)';
      ctx.fillRect(L.MAP_X0, e.landBottom, L.LAND_X1 - L.MAP_X0, L.FOG_H);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const geometry = new THREE.PlaneGeometry(fullW, fullH, 160, 130);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(w / 2, 0, h / 2);
    const position = geometry.attributes.position;
    for (let i = 0; i < position.count; i++) position.setY(i, this.hillAt(position.getX(i), position.getZ(i)));
    geometry.computeVertexNormals();
    const ground = this.mesh(geometry, new THREE.MeshStandardMaterial({ map: texture, roughness: 0.95 }), { cast: false });
    return ground;
  }

  // Grass color at a world point: broad meadows of deeper and lighter green, sun-dried patches and the
  // darker floor of the woods past the edge of the land. The ground and the 3D tufts share it.
  grassTone(x, y, w, h) {
    const meadow = smoothstep(0.28, 0.72, fbm(x / 170, y / 170, 3));
    const dry = smoothstep(0.6, 0.78, fbm(x / 95 + 40, y / 95, 11)) * 0.55;
    const outside = Math.max(this.L.MAP_X0 - x, x - (w - 4), this.L.MAP_Y0 - y, y - (h - 4), 0);
    const woods = smoothstep(0, 45, outside);
    const grain = 1 + (valueNoise(x / 9, y / 9, 7) - 0.5) * 0.14;
    return [0, 1, 2].map((c) => {
      let value = GRASS.deep[c] + (GRASS.light[c] - GRASS.deep[c]) * meadow;
      value += (GRASS.dry[c] - value) * dry;
      value += (GRASS.forest[c] - value) * woods;
      return value * grain;
    });
  }

  // Grass as in Age of Empires III: the broad tones painted coarse and scaled up smooth, a deeper green
  // under each tree, then painted blades, laid twice at different angles so the pattern never shows.
  paintGrass(ctx, w, h, res) {
    const cols = Math.ceil((w + 2 * MARGIN) / TONE_CELL) + 1;
    const rows = Math.ceil((h + 2 * MARGIN) / TONE_CELL) + 1;
    const tones = document.createElement('canvas');
    tones.width = cols;
    tones.height = rows;
    const tonesCtx = tones.getContext('2d');
    const image = tonesCtx.createImageData(cols, rows);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const [r, g, b] = this.grassTone(col * TONE_CELL - MARGIN, row * TONE_CELL - MARGIN, w, h);
        image.data.set([r, g, b, 255], (row * cols + col) * 4);
      }
    }
    tonesCtx.putImageData(image, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(tones, -MARGIN - TONE_CELL / 2, -MARGIN - TONE_CELL / 2, cols * TONE_CELL, rows * TONE_CELL);
    for (const prop of this.empire.props) {
      if (prop.kind !== 'tree') continue;
      const shade = ctx.createRadialGradient(prop.x + 2, prop.y + 2, 0, prop.x + 2, prop.y + 2, 11);
      shade.addColorStop(0, 'rgba(24, 46, 18, 0.32)');
      shade.addColorStop(1, 'rgba(24, 46, 18, 0)');
      ctx.fillStyle = shade;
      ctx.fillRect(prop.x - 9, prop.y - 9, 22, 22);
    }
    const tile = this.bladeTile(res);
    for (const [degrees, scale, alpha] of [[0, 1, 0.6], [37, 1.37, 0.45]]) {
      const pattern = ctx.createPattern(tile, 'repeat');
      pattern.setTransform(new DOMMatrix().rotate(degrees).scale(scale / res)); // tile pixels to world units
      ctx.globalAlpha = alpha;
      ctx.fillStyle = pattern;
      ctx.fillRect(-MARGIN, -MARGIN, w + 2 * MARGIN, h + 2 * MARGIN);
    }
    ctx.globalAlpha = 1;
  }

  // Bare earth in [0, 1] at a world point: rare patches where the noise peaks, ragged like the meadows.
  wornEarth(x, y) {
    return smoothstep(0.63, 0.79, fbm(x / 55, y / 55, 31) + (valueNoise(x / 8, y / 8, 37) - 0.5) * 0.06);
  }

  // The earth patches inside the land (x0, y0)–(x1, y1), painted coarse and scaled up smooth, fading
  // out near the edge of the land so none is cut straight.
  paintEarth(ctx, x0, y0, x1, y1) {
    const cols = Math.ceil((x1 - x0) / EARTH_CELL) + 1;
    const rows = Math.ceil((y1 - y0) / EARTH_CELL) + 1;
    const patches = document.createElement('canvas');
    patches.width = cols;
    patches.height = rows;
    const patchesCtx = patches.getContext('2d');
    const image = patchesCtx.createImageData(cols, rows);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = x0 + col * EARTH_CELL;
        const y = y0 + row * EARTH_CELL;
        const edge = smoothstep(0, 24, Math.min(x - x0, x1 - x, y - y0, y1 - y));
        const earth = this.wornEarth(x, y) * edge;
        image.data.set([146 + earth * 14, 120 + earth * 12, 78 + earth * 8, Math.round(earth * 175)], (row * cols + col) * 4);
      }
    }
    patchesCtx.putImageData(image, 0, 0);
    ctx.drawImage(patches, x0 - EARTH_CELL / 2, y0 - EARTH_CELL / 2, cols * EARTH_CELL, rows * EARTH_CELL);
  }

  // One seamless square of grass blades in texture pixels: short strokes, the shadowed ones first and
  // the sunlit tips on top. Blades crossing an edge continue on the opposite side.
  bladeTile(res) {
    const size = Math.round(BLADE_TILE * res);
    const tile = document.createElement('canvas');
    tile.width = size;
    tile.height = size;
    const ctx = tile.getContext('2d');
    const random = rng(19);
    const colors = ['rgba(26, 54, 18, 0.5)', 'rgba(44, 80, 28, 0.45)', 'rgba(146, 182, 88, 0.4)', 'rgba(184, 200, 112, 0.32)'];
    const perColor = Math.round((BLADE_TILE * BLADE_TILE * 0.9) / colors.length);
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1, 0.32 * res);
    for (const color of colors) {
      ctx.strokeStyle = color;
      ctx.beginPath();
      for (let i = 0; i < perColor; i++) {
        const x = random() * size;
        const y = random() * size;
        const length = (0.9 + random() * 1.6) * res;
        const lean = (random() - 0.5) * 1.2 * length;
        for (const dx of [-size, 0, size]) {
          for (const dy of [0, size]) {
            ctx.moveTo(x + dx, y + dy);
            ctx.lineTo(x + dx + lean, y + dy - length);
          }
        }
      }
      ctx.stroke();
    }
    return tile;
  }

  // Tufts of grass standing on open land (never on roads, bases, the square or the fog), tinted like
  // the ground under them and swaying in the wind; render() moves grassWind.
  buildGrass(w, h) {
    const e = this.empire;
    const L = this.L;
    const blocked = [...e.bases.values()].map((base) => e.plotRect(base));
    blocked.push({ ...e.square, w: L.SQUARE_W, h: L.SQUARE_H });
    const { isRoad, cols } = e.nav;
    const isNearRoad = (x, y) => {
      const col = Math.floor(x / L.CELL);
      const row = Math.floor(y / L.CELL);
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) if (col + dx >= 0 && col + dx < cols && isRoad[(row + dy) * cols + col + dx]) return true;
      }
      return false;
    };
    const random = rng(23);
    const spots = [];
    for (let y = 4; y < e.landBottom - 2; y += TUFT_SPACING) {
      for (let x = 4; x < w - 4; x += TUFT_SPACING) {
        const px = x + (random() - 0.5) * TUFT_SPACING * 1.4;
        const py = y + (random() - 0.5) * TUFT_SPACING * 1.4;
        if (random() < 0.3 || this.wornEarth(px, py) > 0.35) continue; // gaps and bare earth, never a lawn grid
        if (blocked.some((a) => px > a.x - 2 && px < a.x + a.w + 2 && py > a.y - 2 && py < a.y + a.h + 2)) continue;
        if (!isNearRoad(px, py)) spots.push([px, py]);
      }
    }
    this.grassWind ??= { value: 0 };
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uWind = this.grassWind;
      shader.vertexShader = `uniform float uWind;\n${shader.vertexShader}`.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec2 root = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
        float gust = sin(uWind * 1.6 + root.x * 0.045 + root.y * 0.06) * 0.6 + sin(uWind * 2.7 + root.x * 0.13) * 0.25;
        transformed.xz += vec2(0.55, 0.3) * gust * position.y * 0.22;`,
      );
    };
    const tufts = new THREE.InstancedMesh(this.tuftGeometry(), material, Math.max(1, spots.length));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const color = new THREE.Color();
    spots.forEach(([x, z], i) => {
      const s = 0.7 + random() * 0.7;
      m.compose(new THREE.Vector3(x, 0, z), q.setFromAxisAngle(up, random() * Math.PI * 2), new THREE.Vector3(s, s * (0.8 + random() * 0.5), s));
      tufts.setMatrixAt(i, m);
      const [r, g, b] = this.grassTone(x, z, w, h);
      tufts.setColorAt(i, color.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace));
    });
    tufts.count = spots.length;
    tufts.receiveShadow = true;
    tufts.frustumCulled = false;
    return tufts;
  }

  // Seven blades fanning out from one root, darker at the foot. Normals point up so a tuft takes the
  // light like the ground it grows from; each blade is laid twice, once per winding, because a
  // DoubleSide material would flip the normal of the back face and turn half the blades black.
  tuftGeometry() {
    const random = rng(5);
    const positions = [];
    const colors = [];
    const blades = 7;
    for (let i = 0; i < blades; i++) {
      const angle = (i / blades) * Math.PI * 2 + random();
      const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
      const spread = 0.3 + random() * 0.9;
      const half = 0.35 + random() * 0.2;
      const height = 1.6 + random() * 1.6;
      const lean = 0.4 + random() * 0.6;
      const [bx, bz] = [cos * spread, sin * spread];
      const left = [bx + sin * half, 0, bz - cos * half];
      const right = [bx - sin * half, 0, bz + cos * half];
      const tip = [bx + cos * lean, height, bz + sin * lean];
      positions.push(...left, ...right, ...tip, ...right, ...left, ...tip);
      for (let face = 0; face < 2; face++) colors.push(0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 1.15, 1.15, 1.02);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(Array.from({ length: positions.length / 3 }, () => [0, 1, 0]).flat(), 3));
    return geometry;
  }

  // Trees, bushes and rocks: the props the 2D map places, plus deep forest on the hills around.
  buildWoods(w, h) {
    const group = new THREE.Group();
    const trees = [];
    const bushes = [];
    const rocks = [];
    for (const prop of this.empire.props) {
      if (prop.kind === 'tree') trees.push({ x: prop.x, z: prop.y, s: 0.9 + prop.size * 0.18 });
      else if (prop.kind === 'bush') bushes.push({ x: prop.x, z: prop.y });
      else if (prop.kind === 'rock') rocks.push({ x: prop.x, z: prop.y, s: 1 + prop.size * 0.3 });
    }
    const random = rng(42);
    // the deep forest grows only round a forest edge: the stone wall stands in open country
    for (let i = 0; i < (this.empire.borderWall ? 0 : 520); i++) {
      const x = -MARGIN + random() * (w + 2 * MARGIN);
      const z = -MARGIN + random() * (h + 2 * MARGIN);
      const isOutside = x < 4 || x > w - 4 || z < 4 || z > h - 2;
      if (isOutside && riverBankDistance(x, z) > 8) trees.push({ x, z, s: 0.9 + random() * 0.7, y: this.hillAt(x, z) });
    }
    const pine = modelParts('pine');
    const fir = modelParts('fir');
    for (const mesh of pine && fir ? this.modelTrees(trees, [pine, fir]) : this.primitiveTrees(trees)) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const bushMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(2.8, 1), this.mat('#3a7a35', { flatShading: true }), Math.max(1, bushes.length));
    bushes.forEach((bush, i) => bushMesh.setMatrixAt(i, m.compose(new THREE.Vector3(bush.x, 1.6, bush.z), q, new THREE.Vector3(1, 0.75, 1))));
    bushMesh.count = bushes.length;
    const rockMesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(2.2, 0), this.mat('#8d8f96', { flatShading: true }), Math.max(1, rocks.length));
    rocks.forEach((rock, i) => rockMesh.setMatrixAt(i, m.compose(new THREE.Vector3(rock.x, 0.8, rock.z), q, new THREE.Vector3(rock.s, rock.s * 0.7, rock.s))));
    rockMesh.count = rocks.length;
    for (const mesh of [bushMesh, rockMesh]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    return group;
  }

  // The stone wall round the map (empire.borderWall, world pixels): the runs, their footing and the
  // gatehouse merged into one mesh, the merlons, the towers and the portcullis instanced, so the whole
  // ring costs a handful of draw calls. The path is the ring opened at the gate: its two ends flank the
  // main road, and so do its first and last towers.
  buildBorderWall({ path, towers, roof }) {
    const { height, thick, footH, towerH, radius, roofH } = BORDER_WALL_3D;
    const { clear, lintelH, towerScale, bar } = BORDER_GATE_3D;
    const stone = this.mat(STYLE_3D.prontera.wall);
    const group = new THREE.Group();
    const parts = [];
    const merlons = [];
    const slab = (w, h, d, x, y, z, angle = 0) => parts.push(new THREE.BoxGeometry(w, h, d).rotateY(angle).translate(x, y + h / 2, z));
    for (let i = 1; i < path.length; i++) {
      const [ax, az] = path[i - 1];
      const [bx, bz] = path[i];
      const length = Math.hypot(bx - ax, bz - az);
      const angle = -Math.atan2(bz - az, bx - ax);
      const [mx, mz] = [(ax + bx) / 2, (az + bz) / 2];
      slab(length + thick, height, thick, mx, 0, mz, angle);
      slab(length + thick + 2, footH, thick + 2, mx, 0, mz, angle);
      for (let k = MERLON_STEP / 2; k < length; k += MERLON_STEP) merlons.push({ x: ax + ((bx - ax) * k) / length, y: height + 1, z: az + ((bz - az) * k) / length, angle });
    }
    const [gateX0, gateZ] = path.at(-1);
    const [gateX1] = path[0];
    slab(gateX1 - gateX0, lintelH, thick + 2, (gateX0 + gateX1) / 2, clear, gateZ);
    for (let x = gateX0 + MERLON_STEP / 2; x < gateX1; x += MERLON_STEP) merlons.push({ x, y: clear + lintelH + 1, z: gateZ, angle: 0 });
    const wall = this.mesh(mergeGeometries(parts), stone);
    parts.forEach((part) => part.dispose());
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const merlonMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(2, 2.4, thick + 0.4), stone, merlons.length);
    merlons.forEach(({ x, y, z, angle }, i) => merlonMesh.setMatrixAt(i, m.compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(UP, angle), one)));
    // the portcullis drawn up against the lintel's outer face (the one the camera opens on), its
    // teeth showing under it
    const grille = [];
    const [gridZ, gridH] = [gateZ + thick / 2 + 1.4, lintelH + 3];
    for (let x = gateX0 + bar; x < gateX1 - bar / 2; x += bar) grille.push([x, clear - 3 + gridH / 2, 0.6, gridH]);
    for (const y of [clear - 1, clear + lintelH - 2]) grille.push([(gateX0 + gateX1) / 2, y, gateX1 - gateX0 - 2 * bar, 0.6]);
    const portcullis = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 0.5), this.mat('#3b3f4a'), grille.length);
    grille.forEach(([x, y, w, h], i) => portcullis.setMatrixAt(i, m.compose(new THREE.Vector3(x, y, gridZ), q.identity(), new THREE.Vector3(w, h, 1))));
    const body = new THREE.CylinderGeometry(radius, radius + 0.6, towerH, 12).translate(0, towerH / 2, 0);
    const cap = new THREE.ConeGeometry(radius + 1.4, roofH, 12).translate(0, towerH + roofH / 2, 0);
    const gateScale = new THREE.Vector3(...towerScale);
    const towerMeshes = [[body, stone], [cap, this.mat(roof[0])]].map(([geometry, material]) => {
      const mesh = new THREE.InstancedMesh(geometry, material, towers.length);
      q.identity();
      towers.forEach(([x, z], i) => mesh.setMatrixAt(i, m.compose(new THREE.Vector3(x, 0, z), q, i === 0 || i === towers.length - 1 ? gateScale : one)));
      return mesh;
    });
    group.add(wall);
    for (const mesh of [merlonMesh, portcullis, ...towerMeshes]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    return group;
  }

  // The pine and the fir models, alternating, one InstancedMesh each.
  modelTrees(trees, kinds) {
    const meshes = kinds.map(({ geometry, material }, k) => {
      const count = Math.ceil((trees.length - k) / kinds.length);
      const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, count));
      mesh.count = count;
      return mesh;
    });
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const color = new THREE.Color();
    trees.forEach((tree, i) => {
      const mesh = meshes[i % kinds.length];
      const index = Math.floor(i / kinds.length);
      const s = MODEL_SCALE.tree * tree.s;
      m.compose(new THREE.Vector3(tree.x, tree.y ?? 0, tree.z), q.setFromAxisAngle(UP, i * 1.7), new THREE.Vector3(s, s, s));
      mesh.setMatrixAt(index, m);
      mesh.setColorAt(index, color.set(TREE_TINTS[i % TREE_TINTS.length]));
    });
    return meshes;
  }

  // A trunk and two leafy crowns per tree, while the models load.
  primitiveTrees(trees) {
    const trunkGeometry = new THREE.CylinderGeometry(0.9, 1.3, 7, 6);
    const crownGeometry = new THREE.IcosahedronGeometry(5.5, 1);
    const trunks = new THREE.InstancedMesh(trunkGeometry, this.mat('#5a3d22'), trees.length);
    const crowns = new THREE.InstancedMesh(crownGeometry, this.mat('#ffffff', { flatShading: true }), trees.length * 2);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const color = new THREE.Color();
    const greens = ['#2f6b33', '#3f8a40', '#24512a', '#4c7f2e', '#356f3a'];
    trees.forEach((tree, i) => {
      const base = tree.y ?? 0;
      m.compose(new THREE.Vector3(tree.x, base + 3.5 * tree.s, tree.z), q, new THREE.Vector3(tree.s, tree.s, tree.s));
      trunks.setMatrixAt(i, m);
      for (let k = 0; k < 2; k++) {
        const lift = base + (8 + k * 4.5) * tree.s;
        const size = tree.s * (k === 0 ? 1 : 0.72);
        q.setFromEuler(new THREE.Euler(0, (i * 1.7 + k) % Math.PI, 0));
        m.compose(new THREE.Vector3(tree.x + (k ? 0.8 : 0), lift, tree.z), q, new THREE.Vector3(size, size * 1.05, size));
        crowns.setMatrixAt(i * 2 + k, m);
        crowns.setColorAt(i * 2 + k, color.set(greens[(i + k) % greens.length]));
      }
      q.identity();
    });
    return [trunks, crowns];
  }

  hillAt(x, z) {
    const { w, h } = this.worldSize;
    const outside = Math.max(this.L.MAP_X0 - x, x - (w - 4), this.L.MAP_Y0 - z, z - (h - 4), 0);
    const hills = 6 * Math.sin(x * 0.031) * Math.cos(z * 0.027) + 4 * Math.sin((x + z) * 0.017) + 7;
    // flat ground a little past the banks (wider than a cell of the ground mesh, so no slope covers the water)
    const valley = smoothstep(10, RIVER.valley, riverBankDistance(x, z));
    return smoothstep(0, 60, outside) * hills * 2.2 * valley;
  }

  // The river's water: a strip over the flat valley, its ripples drifting east (render() moves them).
  buildRiver(w) {
    const positions = [];
    const uvs = [];
    const index = [];
    riverPath(w).forEach(({ x, z, half }, i) => {
      positions.push(x, RIVER.level, z - half, x, RIVER.level, z + half);
      uvs.push(x / RIPPLE_TILE, 0, x / RIPPLE_TILE, 1);
      if (i > 0) index.push(2 * i - 2, 2 * i - 1, 2 * i, 2 * i - 1, 2 * i + 1, 2 * i);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    this.water ??= new THREE.MeshStandardMaterial({ map: this.rippleTexture(), roughness: 0.3 });
    return this.mesh(geometry, this.water, { cast: false });
  }

  // One small tile of water, along the current by across it: shallow at the banks, deep in the
  // middle, with light streaks that continue past the tile's ends.
  rippleTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    const depth = ctx.createLinearGradient(0, 0, 0, 32);
    for (const [stop, color] of [[0, '#6d9a9e'], [0.25, '#3b6fa8'], [0.5, '#2e5d94'], [0.75, '#3b6fa8'], [1, '#6d9a9e']]) depth.addColorStop(stop, color);
    ctx.fillStyle = depth;
    ctx.fillRect(0, 0, 64, 32);
    const random = rng(29);
    ctx.fillStyle = 'rgba(160, 200, 236, 0.55)';
    for (let i = 0; i < 14; i++) {
      const x = random() * 64;
      const y = 4 + Math.floor(random() * 24);
      const length = 6 + random() * 10;
      ctx.fillRect(x, y, length, 1);
      ctx.fillRect(x - 64, y, length, 1);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    return texture;
  }

  // Built square-local and placed where the user put the square; pressing on it drags it.
  buildSquare() {
    const L = this.L;
    const sq = { x: 0, y: 0 };
    const group = new THREE.Group();
    group.position.set(this.empire.square.x, 0, this.empire.square.y);
    group.userData.hit = { square: true };
    this.squareGroup = group;
    // well
    const well = new THREE.Group();
    well.add(this.mesh(new THREE.CylinderGeometry(6, 6.5, 4, 16, 1, true), this.mat('#9a9286', { side: THREE.DoubleSide })));
    well.children[0].position.y = 2;
    well.add(this.box(1, 11, 1, '#5e3c20', -5, 0, 0), this.box(1, 11, 1, '#5e3c20', 5, 0, 0));
    const wellRoof = this.gable(14, 4, 7, '#8a5a32');
    wellRoof.position.y = 11;
    well.add(wellRoof);
    well.add(this.mesh(new THREE.CircleGeometry(5.6, 16), this.mat('#2b4a6e', { roughness: 0.2 })));
    well.children.at(-1).rotation.x = -Math.PI / 2;
    well.children.at(-1).position.y = 1;
    well.position.set(sq.x + 27, 0, sq.y + 36);
    // market stall with a striped awning
    const market = new THREE.Group();
    market.add(this.box(30, 5, 9, '#a8773f', 0, 0, 0));
    for (const [px, pz] of [[-14, -4], [14, -4], [-14, 4], [14, 4]]) market.add(this.box(1, 13, 1, '#5e3c20', px, 0, pz));
    const stripes = document.createElement('canvas');
    stripes.width = 64;
    stripes.height = 8;
    const stripeCtx = stripes.getContext('2d');
    for (let i = 0; i < 8; i++) {
      stripeCtx.fillStyle = i % 2 ? '#f4f4f0' : '#c0392b';
      stripeCtx.fillRect(i * 8, 0, 8, 8);
    }
    const stripeTexture = new THREE.CanvasTexture(stripes);
    stripeTexture.colorSpace = THREE.SRGBColorSpace;
    const awning = this.mesh(new THREE.BoxGeometry(34, 1, 13), new THREE.MeshStandardMaterial({ map: stripeTexture, roughness: 0.8 }));
    awning.position.set(0, 14, 0);
    awning.rotation.x = 0.18;
    market.add(awning);
    for (let i = 0; i < 5; i++) market.add(this.box(3, 2, 3, ['#e0ae4f', '#c0392b', '#3f8a40', '#f08a3c', '#9b6be0'][i], -11 + i * 5.5, 5, 0));
    market.position.set(sq.x + 85, 0, sq.y + 34);
    // campfire with its logs and seats
    const fire = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const log = this.mesh(new THREE.CylinderGeometry(0.8, 0.8, 9, 6), this.mat('#5a3d22'));
      log.rotation.z = Math.PI / 2;
      log.rotation.y = (i * Math.PI) / 3;
      log.position.y = 1;
      fire.add(log);
    }
    this.flame = this.mesh(new THREE.ConeGeometry(2.6, 7, 8), new THREE.MeshStandardMaterial({ color: '#f97316', emissive: '#f97316', emissiveIntensity: 2 }), { cast: false });
    this.flame.position.y = 4.5;
    fire.add(this.flame);
    this.fireLight = new THREE.PointLight('#ff8a3c', 0, 120, 1.6);
    this.fireLight.position.y = 8;
    fire.add(this.fireLight);
    fire.position.set(L.CAMPFIRE.x, 0, L.CAMPFIRE.y);
    for (const poi of L.POIS.filter((p) => p.id.startsWith('log'))) {
      const seat = this.mesh(new THREE.CylinderGeometry(1.6, 1.6, 12, 8), this.mat('#6b4a2a'));
      seat.rotation.z = Math.PI / 2;
      seat.position.set(poi.x, 1.6, poi.y + 3);
      group.add(seat);
    }
    // hay cart
    const cart = new THREE.Group();
    cart.add(this.box(18, 4, 10, '#8a5a32', 0, 3, 0));
    cart.add(this.box(16, 5, 9, '#e0c060', 0, 7, 0));
    for (const side of [-1, 1]) {
      const wheel = this.mesh(new THREE.CylinderGeometry(3.5, 3.5, 1, 12), this.mat('#5e3c20'));
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(-3, 3.5, side * 5.5);
      cart.add(wheel);
    }
    cart.position.set(sq.x + 30, 0, sq.y + 158);
    cart.rotation.y = 0.3;
    // barrels and crates of the market corner
    for (const [x, y] of [[sq.x + 109, sq.y + 38], [sq.x + 61, sq.y + 40]]) {
      const barrel = this.mesh(new THREE.CylinderGeometry(2.6, 2.6, 6, 10), this.mat('#8a5a32'));
      barrel.position.set(x, 3, y);
      group.add(barrel);
    }
    group.add(this.box(5, 5, 5, '#a8773f', sq.x + 110, 0, sq.y + 47));
    group.add(well, market, fire, cart);
    return group;
  }

  // Under the fog: dark ruins of the unexplored repositories on dim ground (no clouds).
  buildFog() {
    const e = this.empire;
    const group = new THREE.Group();
    for (const prop of e.props.filter((p) => p.kind === 'ruin')) {
      const h = prop.size;
      const ruin = new THREE.Group();
      if (h % 3 === 0) {
        ruin.add(this.mesh(new THREE.CylinderGeometry(4, 4.5, 16 + (h % 5), 8), this.mat('#2b332a')));
        ruin.children[0].position.y = 8;
      } else {
        ruin.add(this.box(14, 6 + (h % 4), 2, '#2b332a', 0, 0, -4), this.box(2, 9, 10, '#2b332a', -6, 0, 0), this.box(5, 4, 5, '#323b30', 4, 0, 2));
      }
      ruin.position.set(prop.x + 8, 0, prop.y - 4);
      ruin.rotation.y = (h % 7) * 0.4;
      group.add(ruin);
    }
    return group;
  }

  // ---------- Bases ----------

  buildTownCenter(design, team) {
    const era = bodyOf(design);
    const style = STYLE_3D[design.style] ? design.style : 'prontera';
    const colors = STYLE_3D[style];
    const isHut = design.era === 1;
    const wallColor = isHut && style !== 'morroc' ? '#8a5a32' : colors.wall;
    const [roof, roofShade] = team;
    const group = new THREE.Group();
    // the town kit's walls once it has loaded, in the style's colors (wooden planks for huts and
    // Umbala); the main roofs share their paint, so the gable ends match the walls
    const isWood = (isHut && style !== 'morroc') || style === 'umbala';
    const paint = { wall: wallColor, trim: colors.trim, planks: isWood ? wallColor : null, roof };
    const kitWalls = this.kitWalls(era, paint, isWood);
    if (kitWalls) group.add(...kitWalls);
    else {
      group.add(this.box(era.w, era.wall, era.d, wallColor));
      // timber frame and corner posts
      for (const sx of [-1, 1]) group.add(this.box(1.2, era.wall, 1.2, colors.trim, sx * (era.w / 2 - 0.4), 0, era.d / 2 - 0.4));
      group.add(this.box(era.w + 0.4, 1, 0.6, colors.trim, 0, era.wall - 3, era.d / 2));
      // door and windows on the front (+z); a tall form gets a second floor of windows
      const doorH = Math.min(8, era.wall - 1.5);
      group.add(this.box(6, doorH, 0.8, '#3a2716', 0, 0, era.d / 2 + 0.1));
      const glass = new THREE.MeshStandardMaterial({ color: '#2a1d12', emissive: '#fcd77a', emissiveIntensity: 0.05 });
      const upperY = era.wall - 7.6;
      const windows = [-1, 1].map((sx) => [sx * era.w * 0.3, era.windowY]);
      if (era.isTall && upperY > era.windowY + 4.6) windows.push([-era.w * 0.3, upperY], [0, upperY], [era.w * 0.3, upperY]);
      for (const [wx, wy] of windows) {
        const win = this.box(3.6, 3.6, 0.6, glass, wx, wy, era.d / 2 + 0.2);
        win.userData.isWindow = true;
        group.add(win);
      }
    }
    const top = era.wall;
    // square pyramids (Geffen, Payon) keep to a long or deep form's plan
    const roofPlan = new THREE.Group();
    roofPlan.scale.z = era.plan;
    group.add(roofPlan);
    if (style === 'prontera' || style === 'aldebaran') {
      const gable = this.gable(era.w + 4, era.roof * (style === 'aldebaran' ? 1.35 : 1), era.d + 4, roof, paint);
      gable.position.y = top;
      group.add(gable);
      if (style === 'prontera' && design.era >= 2) group.add(this.box(3, 9, 3, '#7d7362', era.w * 0.25, top + era.roof * 0.4, 0));
      if (style === 'aldebaran' && design.era >= 2) {
        const towerH = era.roof + 6 + design.era * 3;
        group.add(this.box(9, towerH, 9, colors.wall, 0, top, 0));
        const face = this.mesh(new THREE.CircleGeometry(3, 20), this.mat('#f4f4f0'), { cast: false });
        face.position.set(0, top + towerH - 5, 4.6);
        group.add(face);
        const hand = this.box(0.5, 2.6, 0.3, '#b91c1c', 0, 0, 0);
        hand.geometry.translate(0, -0.2, 0);
        const pivot = new THREE.Group();
        pivot.position.set(0, top + towerH - 5, 4.9);
        pivot.add(hand);
        pivot.userData.isClockHand = true;
        group.add(pivot);
        const cap = this.pyramid(8, 8, roofShade);
        cap.position.y += top + towerH;
        group.add(cap);
      }
    } else if (style === 'geffen') {
      const cone = this.pyramid((Math.max(era.w, era.d) / 2) * 1.35, era.roof * 2, roofShade);
      cone.position.y += top;
      roofPlan.add(cone);
      if (design.era >= 2) {
        const spireH = era.roof * 2 + design.era * 4;
        const spire = this.mesh(new THREE.CylinderGeometry(1.4, 2, spireH, 8), this.mat(colors.wall));
        spire.position.y = top + spireH / 2;
        group.add(spire);
        const crystal = this.mesh(new THREE.OctahedronGeometry(3), new THREE.MeshStandardMaterial({ color: '#7dd3fc', emissive: '#38bdf8', emissiveIntensity: 1.6, roughness: 0.2 }), { cast: false });
        crystal.position.y = top + spireH + 4;
        crystal.userData.isCrystal = true;
        group.add(crystal);
      }
    } else if (style === 'payon') {
      const tiers = design.era <= 2 ? 1 : design.era <= 4 ? 2 : 3;
      let y = top;
      let radius = (Math.max(era.w, era.d) / 2) * 1.5;
      for (let i = 0; i < tiers; i++) {
        const tier = this.mesh(new THREE.ConeGeometry(radius, 6, 4), this.mat(i % 2 ? roofShade : roof));
        tier.rotation.y = Math.PI / 4;
        tier.scale.y = 0.8;
        tier.position.y = y + 2.4;
        roofPlan.add(tier);
        y += 4.5;
        if (i < tiers - 1) {
          roofPlan.add(this.box(radius * 0.9, 4, radius * 0.9, colors.trim, 0, y - 1, 0));
          y += 3;
        }
        radius *= 0.68;
      }
      if (design.era >= 2) {
        for (const sx of [-1, 1]) {
          const lantern = this.mesh(new THREE.SphereGeometry(1.3, 10, 8), new THREE.MeshStandardMaterial({ color: '#dc2626', emissive: '#ef4444', emissiveIntensity: 0.8 }), { cast: false });
          lantern.position.set(sx * (era.w / 2 + 1.5), top - 3, era.d / 2 + 1.5);
          group.add(lantern);
        }
      }
    } else if (style === 'alberta') {
      const gable = this.gable(era.w + 4, era.roof, era.d + 4, roof, paint);
      gable.position.y = top;
      group.add(gable);
      if (design.era >= 2) {
        // the harbor's lighthouse on the back corner: red and white bands, the lamp lit at night
        const lighthouse = new THREE.Group();
        const height = top + era.roof + 4 + design.era * 3;
        const bands = 5;
        for (let k = 0; k < bands; k++) {
          const r0 = 3.8 - k * 0.22;
          const band = this.mesh(new THREE.CylinderGeometry(r0 - 0.22, r0, height / bands, 14), this.mat(k % 2 ? '#c0392b' : SNOW));
          band.position.y = (k + 0.5) * (height / bands);
          lighthouse.add(band);
        }
        lighthouse.add(this.box(7, 0.8, 7, colors.trim, 0, height, 0));
        const lamp = this.mesh(new THREE.CylinderGeometry(2, 2, 3, 12), new THREE.MeshStandardMaterial({ color: '#fde68a', emissive: '#facc15', emissiveIntensity: 0.05 }), { cast: false });
        lamp.position.y = height + 2.3;
        lamp.userData.isWindow = true;
        const cap = this.mesh(new THREE.ConeGeometry(3.2, 3.6, 12), this.mat(roofShade));
        cap.position.y = height + 5.6;
        lighthouse.add(lamp, cap);
        lighthouse.position.set(era.w / 2 - 3, 0, -era.d / 2 + 3);
        group.add(lighthouse);
      }
    } else if (style === 'lutie') {
      const roofH = era.roof * 1.3;
      const gable = this.gable(era.w + 4, roofH, era.d + 4, roof, paint);
      gable.position.y = top;
      group.add(gable);
      // snow on the upper half of the roof, the same slope, just above it
      const snow = this.gable((era.w + 4) / 2, roofH / 2, era.d + 4.4, SNOW);
      snow.position.y = top + roofH / 2 + 0.3;
      group.add(snow);
      if (design.era >= 2) {
        group.add(this.box(3, roofH * 0.7, 3, '#7d7362', -era.w * 0.25, top + roofH * 0.3, 0), this.box(3.6, 0.8, 3.6, SNOW, -era.w * 0.25, top + roofH, 0));
        // the village's pine on the back corner, hung with baubles
        const pine = new THREE.Group();
        const pineH = 10 + design.era * 2;
        pine.add(this.box(1.2, 2, 1.2, '#5a3d22'));
        for (let k = 0; k < 3; k++) {
          const tier = this.mesh(new THREE.ConeGeometry(3.6 - k * 0.9, pineH * 0.45, 10), this.mat('#24512a', { flatShading: true }));
          tier.position.y = 2 + k * pineH * 0.25 + pineH * 0.225;
          pine.add(tier);
        }
        const baubles = ['#dc2626', '#f2c84b', '#60a5fa', '#dc2626', '#f2c84b', '#f4f4f0'];
        baubles.forEach((color, k) => {
          const ball = this.mesh(new THREE.SphereGeometry(0.5, 8, 6), this.mat(color, { metalness: 0.4, roughness: 0.4 }), { cast: false });
          const angle = k * 2.1;
          const level = 3 + (k % 3) * pineH * 0.25;
          const reach = 3.2 - (k % 3) * 0.9;
          ball.position.set(Math.cos(angle) * reach, level, Math.sin(angle) * reach);
          pine.add(ball);
        });
        if (design.era >= 4) {
          const star = this.mesh(new THREE.OctahedronGeometry(1.1), this.mat('#f2c84b', { metalness: 0.8, roughness: 0.3, emissive: '#7a5a00', emissiveIntensity: 0.6 }), { cast: false });
          star.position.y = 2 + pineH * 0.95 + 1;
          pine.add(star);
        }
        pine.position.set(era.w / 2 + 4, 0, -era.d / 2 + 3);
        group.add(pine);
      }
    } else if (style === 'einbroch') {
      // a sawtooth factory roof in the team color, glass on each tooth's upright face
      group.add(this.box(era.w + 1, 0.8, era.d + 1, colors.trim, 0, top, 0));
      const teeth = Math.max(2, Math.round(era.w / 9));
      const toothW = (era.w + 1) / teeth;
      const toothH = era.roof * 0.75;
      const profile = new THREE.Shape();
      profile.moveTo(0, 0);
      profile.lineTo(toothW, 0);
      profile.lineTo(toothW, toothH);
      profile.closePath();
      const toothGeometry = new THREE.ExtrudeGeometry(profile, { depth: era.d + 1, bevelEnabled: false });
      toothGeometry.translate(0, 0, -(era.d + 1) / 2);
      const skylight = new THREE.MeshStandardMaterial({ color: '#36506b', emissive: '#fcd77a', emissiveIntensity: 0.05, roughness: 0.3 });
      for (let k = 0; k < teeth; k++) {
        const x = -(era.w + 1) / 2 + k * toothW;
        const tooth = this.mesh(toothGeometry, this.mat(k % 2 ? roofShade : roof));
        tooth.position.set(x, top + 0.8, 0);
        const pane = this.box(0.3, toothH * 0.8, era.d - 1, skylight, x + toothW + 0.2, top + 0.8 + toothH * 0.1, 0);
        pane.userData.isWindow = true;
        group.add(tooth, pane);
      }
      if (design.era >= 2) {
        // smokestacks on the back wall, puffing
        const stackH = top + era.roof + 6 + design.era * 3;
        for (const sx of design.era >= 3 ? [-1, 1] : [1]) {
          const stack = new THREE.Group();
          const body = this.mesh(new THREE.CylinderGeometry(1.6, 2.1, stackH, 12), this.mat('#4a4f5c'));
          body.position.y = stackH / 2;
          stack.add(body);
          for (let y = stackH * 0.4; y < stackH; y += stackH * 0.3) {
            const ring = this.mesh(new THREE.CylinderGeometry(2.1, 2.1, 0.7, 12), this.mat('#2d3039'));
            ring.position.y = y;
            stack.add(ring);
          }
          for (let k = 0; k < 3; k++) {
            const puff = this.mesh(new THREE.SphereGeometry(1.6, 8, 6), new THREE.MeshStandardMaterial({ color: '#56565c', transparent: true, opacity: 0.5, depthWrite: false }), { cast: false });
            puff.userData = { isSmoke: true, baseY: stackH + 1, phase: k / 3 + (sx > 0 ? 0.15 : 0) };
            stack.add(puff);
          }
          stack.position.set(sx * era.w * 0.3, 0, -era.d / 2 + 2.5);
          group.add(stack);
        }
      }
      if (design.era >= 3) {
        // a brass gear turning on the front, over the door
        const gear = new THREE.Group();
        const radius = Math.min(4, era.roof * 0.45);
        const brass = this.mat('#c8a24a', { metalness: 0.6, roughness: 0.4 });
        const wheel = this.mesh(new THREE.CylinderGeometry(radius, radius, 0.8, 18), brass);
        wheel.rotation.x = Math.PI / 2;
        gear.add(wheel);
        for (let k = 0; k < 8; k++) {
          const tooth = this.mesh(new THREE.BoxGeometry(1.2, 1.4, 0.8), brass);
          tooth.geometry.translate(0, radius + 0.3, 0);
          tooth.rotation.z = (k / 8) * Math.PI * 2;
          gear.add(tooth);
        }
        const hub = this.mesh(new THREE.CylinderGeometry(radius * 0.3, radius * 0.3, 1.2, 10), this.mat('#3b3f4a'));
        hub.rotation.x = Math.PI / 2;
        gear.add(hub);
        gear.position.set(0, top + radius * 0.8, era.d / 2 + 1);
        gear.userData.isGear = true;
        group.add(gear);
      }
    } else if (style === 'juno') {
      // the sages' portico: columns before the facade under a low pediment, a dome behind it
      const deep = era.d + 8;
      group.add(this.box(era.w + 4, 1.4, deep, colors.wall, 0, top - 1.4, 2));
      const pediment = this.gable(era.w + 4, era.roof * 0.55, deep, roof, paint);
      pediment.position.set(0, top, 2);
      group.add(pediment, this.box(era.w + 2, 0.8, 5, '#d8d2c2', 0, 0, era.d / 2 + 3));
      for (let k = 0; k < 6; k++) {
        const x = -era.w / 2 + 2 + (k * (era.w - 4)) / 5;
        if (Math.abs(x) < 4.5) continue; // the door
        const column = this.mesh(new THREE.CylinderGeometry(0.9, 1.05, top - 2.2, 12), this.mat(colors.wall, { roughness: 0.5 }));
        column.position.set(x, 0.8 + (top - 2.2) / 2, era.d / 2 + 4);
        group.add(column, this.box(2.4, 0.6, 2.4, colors.wall, x, top - 2, era.d / 2 + 4));
      }
      if (design.era >= 3) {
        const radius = Math.min(era.w, era.d) * 0.3;
        const drum = this.mesh(new THREE.CylinderGeometry(radius, radius, 4, 20), this.mat(colors.wall));
        drum.position.set(0, top + era.roof * 0.3 + 2, -era.d * 0.12);
        const dome = this.dome(radius, roofShade);
        dome.position.set(0, top + era.roof * 0.3 + 4, -era.d * 0.12);
        group.add(drum, dome);
        if (design.era >= 5) {
          const finial = this.mesh(new THREE.SphereGeometry(0.9, 8, 6), this.mat('#f2c84b', { metalness: 0.8, roughness: 0.3 }));
          finial.position.set(0, top + era.roof * 0.3 + 4 + radius + 0.6, -era.d * 0.12);
          group.add(finial);
        }
      }
    } else if (style === 'umbala') {
      // logs on the front, a thatched roof; from Colonial on, the great tree grows through it
      if (!kitWalls) for (let y = 1.2; y < top - 0.5; y += 1.5) group.add(this.box(era.w + 1.2, 0.5, 0.4, colors.trim, 0, y, era.d / 2 + 0.05));
      const thatchH = era.roof * 1.2;
      const thatch = this.gable(era.w + 5, thatchH, era.d + 5, thatchOf(roof), paint);
      thatch.position.y = top;
      const ridge = this.gable((era.w + 5) * 0.25, thatchH * 0.25, era.d + 5.4, roof);
      ridge.position.y = top + thatchH * 0.75 + 0.3;
      group.add(thatch, ridge);
      if (design.era >= 2) {
        const trunkH = top + era.roof * 1.2 + 4 + design.era * 2;
        const trunk = this.mesh(new THREE.CylinderGeometry(2, 3, trunkH, 10), this.mat('#5a3d22'));
        trunk.position.y = trunkH / 2;
        group.add(trunk);
        const crown = new THREE.Group();
        const r = 6 + design.era * 1.4;
        for (const [cx, cy, cz, k] of [[0, 0, 0, 1], [-r * 0.7, -r * 0.25, 0.5, 0.7], [r * 0.7, -r * 0.2, -0.5, 0.72], [0.4, r * 0.3, -r * 0.3, 0.6]]) {
          const leaves = this.mesh(new THREE.IcosahedronGeometry(r * k, 1), this.mat(k === 1 ? '#2f6b33' : '#3f8a40', { flatShading: true }));
          leaves.position.set(cx, cy, cz);
          crown.add(leaves);
        }
        crown.scale.z = 0.8;
        crown.position.y = trunkH + r * 0.4;
        group.add(crown);
      }
    } else {
      // morroc: flat roof with a parapet, and a dome
      group.add(this.box(era.w + 1, 1.6, era.d + 1, colors.wall, 0, top, 0));
      if (design.era >= 2) {
        const drum = this.mesh(new THREE.CylinderGeometry(era.w * 0.24, era.w * 0.24, 4, 18), this.mat(colors.wall));
        drum.position.y = top + 3.6;
        group.add(drum);
        const dome = this.dome(era.w * 0.25, roof);
        dome.position.y = top + 5.6;
        group.add(dome);
      }
    }
    if (era.tower) {
      for (const sx of [-1, 1]) {
        const tower = new THREE.Group();
        const body = this.mesh(new THREE.CylinderGeometry(3.6, 4, era.tower, 12), this.mat(isHut ? wallColor : colors.wall));
        body.position.y = era.tower / 2;
        tower.add(body);
        if (style === 'prontera') {
          for (let k = 0; k < 6; k++) {
            const angle = (k / 6) * Math.PI * 2;
            tower.add(this.box(1.4, 2, 1.4, colors.wall, Math.cos(angle) * 3.2, era.tower, Math.sin(angle) * 3.2));
          }
        } else if (style === 'morroc' || style === 'juno') {
          const cap = this.dome(3.4, roof);
          cap.position.y = era.tower;
          tower.add(cap);
        } else if (style === 'einbroch') {
          // a flat iron top with a stack of its own, up to the flag
          tower.add(this.box(9, 1.2, 9, colors.trim, 0, era.tower, 0));
          const stack = this.mesh(new THREE.CylinderGeometry(1, 1.2, 6, 10), this.mat('#4a4f5c'));
          stack.position.y = era.tower + 3;
          tower.add(stack);
        } else {
          const isSteep = style === 'geffen' || style === 'lutie';
          const cap = this.mesh(new THREE.ConeGeometry(style === 'payon' ? 6 : 4.8, isSteep ? 11 : 7, style === 'payon' ? 4 : 12), this.mat(style === 'umbala' ? thatchOf(roof) : roof));
          if (style === 'payon') cap.rotation.y = Math.PI / 4;
          cap.position.y = era.tower + (isSteep ? 5.5 : 3.5);
          tower.add(cap);
          if (style === 'lutie') tower.add(this.snowTip(4.8, 11, era.tower));
        }
        if (design.era >= 4) {
          tower.add(this.box(0.4, 9, 0.4, '#5e3c20', 0, era.tower + 6, 0));
          const flag = this.mesh(new THREE.PlaneGeometry(5, 3), this.mat(roof, { side: THREE.DoubleSide }), { cast: false });
          flag.geometry.translate(2.5, 0, 0);
          flag.position.set(0.2, era.tower + 13.5, 0);
          flag.userData.isFlag = true;
          tower.add(flag);
        }
        if (design.era >= 5) {
          const gold = this.mesh(new THREE.SphereGeometry(0.9, 8, 6), this.mat('#f2c84b', { metalness: 0.8, roughness: 0.3 }));
          gold.position.y = era.tower + 16;
          tower.add(gold);
        }
        tower.position.set(sx * (era.w / 2 + 1), 0, era.d / 2);
        group.add(tower);
      }
    }
    if (design.era >= 5) group.add(this.box(era.w + 3, 0.8, 0.8, this.mat('#f2c84b', { metalness: 0.8, roughness: 0.3 }), 0, top - 0.2, era.d / 2 + 2));
    return group;
  }

  // The town center's walls from the town kit, null until it loads: tiles about as wide as they are
  // tall (two rows for a tall form), the door in the middle of the front, windows every other tile,
  // merged into one mesh, plus one for the panes behind the window openings (lit at night).
  kitWalls(era, paint, isWood) {
    const [plain, windowed, door] = (isWood ? ['woodWall', 'woodWindow', 'woodDoor'] : ['wall', 'window', 'door']).map((name) => modelParts(name, paint));
    if (!plain || !windowed || !door) return null;
    const rows = era.isTall ? 2 : 1;
    const rowH = era.wall / rows;
    const pieces = [];
    const panes = [];
    const m = new THREE.Matrix4();
    // each face: the turn that points the kit's +x outward, its length, its distance from the middle
    const faces = [[-Math.PI / 2, era.w, era.d / 2, true], [Math.PI / 2, era.w, era.d / 2], [0, era.d, era.w / 2], [Math.PI, era.d, era.w / 2]];
    for (const [angle, length, reach, isFront] of faces) {
      const n = 2 * Math.round((length / (rowH * 0.9) - 1) / 2) + 1; // odd, so the door and windows stay centered
      const tileW = length / n;
      const depth = Math.min(tileW, rowH);
      const turn = new THREE.Quaternion().setFromAxisAngle(UP, angle);
      const outward = new THREE.Vector3(1, 0, 0).applyQuaternion(turn);
      const along = new THREE.Vector3(0, 0, 1).applyQuaternion(turn);
      for (let row = 0; row < rows; row++) {
        for (let i = 0; i < n; i++) {
          const offset = Math.abs(i - (n - 1) / 2);
          const piece = isFront && row === 0 && offset === 0 ? door : (offset + row) % 2 === 1 ? windowed : plain;
          const at = outward.clone().multiplyScalar(reach - depth / 2).addScaledVector(along, (i - (n - 1) / 2) * tileW).setY(row * rowH);
          m.compose(at, turn, new THREE.Vector3(depth, rowH, tileW));
          pieces.push(piece.geometry.clone().applyMatrix4(m));
          if (piece === windowed) panes.push(PANE_BOX.clone().applyMatrix4(m.clone().multiply(PANE)));
        }
      }
    }
    const own = (parts) => Object.assign(mergeGeometries(parts), { userData: { isOwn: true } });
    const meshes = [this.mesh(own(pieces), plain.material)];
    if (panes.length) {
      const glass = this.mesh(own(panes), new THREE.MeshStandardMaterial({ color: '#2a1d12', emissive: '#fcd77a', emissiveIntensity: 0.05 }), { cast: false });
      glass.userData.isWindow = true;
      meshes.push(glass);
    }
    return meshes;
  }

  /**
   * The town center at its size and turn, plus the walls of the bigger sizes, in base-local (core)
   * coordinates. `tc` is the building alone: it rises from the ground and swells on an age-up. On
   * grown land `bailey` ({ path, towers, keep }, core-local, from plot.js) walls in the land behind
   * the town center, whatever the size. `box` is the town center's 2D box in its core; a half-lot
   * core's stands smaller and without the bigger sizes' walls.
   */
  buildCastle(design, team, bailey = null, box = this.L.TOWN_CENTER) {
    const era = ERA_3D[Math.min(4, Math.max(0, design.era - 1))];
    const body = bodyOf(design);
    const size = sizeOf(design);
    const isSmall = Boolean(design.growth?.isSmall);
    const scale = size.scale * (isSmall ? SMALL_TC_3D : 1);
    const group = new THREE.Group();
    const tc = this.buildTownCenter(design, team);
    const pivot = new THREE.Group();
    pivot.add(tc);
    pivot.scale.setScalar(scale);
    pivot.rotation.y = -(design.rotation ?? 0) * (Math.PI / 2);
    // a bigger or shallower town center grows back and sideways: the face toward the yard (the door,
    // unless turned) stays on it
    const deep = (design.rotation ?? 0) % 2 === 1 ? body.w : body.d;
    const z = box.y + box.h / 2 + 4 + era.d / 2 - (scale * deep) / 2;
    pivot.position.set(box.x + box.w / 2, 0, z);
    group.add(pivot);
    const big = SIZE_3D[2];
    if (bailey) group.add(this.buildWalls(design, team, { ...size, wall: Math.max(size.wall, big.wall), tower: Math.max(size.tower, big.tower) }, bailey));
    else if (size.wall && !isSmall) group.add(this.buildWalls(design, team, size));
    return { group, tc };
  }

  // Curtain walls along `walls.path` (three sides behind the town center unless the land grew), a round
  // tower on each of `walls.towers` with a roof in the team color; stone with merlons from Fortaleza
  // on (or by the user's pick), a wooden palisade before that. Colossal (or a bailey with room) adds the keep.
  buildWalls(design, team, size, walls = BOX_WALLS) {
    const style = STYLE_3D[design.style] ? design.style : 'prontera';
    const isPalisade = S.isPalisade(design);
    const stone = isPalisade ? '#7a4f2a' : STYLE_3D[style].wall;
    const [roof, roofShade] = team;
    const { x0, x1, z0, z1 } = WALL_BOX;
    const group = new THREE.Group();
    const segment = (ax, az, bx, bz) => {
      const length = Math.hypot(bx - ax, bz - az);
      const along = new THREE.Group();
      along.position.set(ax, 0, az);
      along.rotation.y = -Math.atan2(bz - az, bx - ax);
      along.add(this.box(length, size.wall, WALL_THICK, stone, length / 2, 0, 0));
      if (isPalisade) {
        for (let k = 1; k < length; k += 2) along.add(this.box(1.4, 1.6, 1.4, '#5e3c20', k, size.wall, 0));
      } else {
        for (let k = MERLON_STEP / 2; k < length - 1; k += MERLON_STEP) along.add(this.box(2, 2, WALL_THICK + 0.4, stone, k, size.wall, 0));
      }
      group.add(along);
    };
    for (let i = 1; i < walls.path.length; i++) segment(...walls.path[i - 1], ...walls.path[i]);
    for (const [tx, tz] of walls.towers) {
      const tower = new THREE.Group();
      const radius = size.keep ? 5 : 4;
      const body = this.mesh(new THREE.CylinderGeometry(radius, radius + 0.6, size.tower, 12), this.mat(stone));
      body.position.y = size.tower / 2;
      tower.add(body);
      if (style === 'morroc' || style === 'juno') {
        const cap = this.dome(radius, roof);
        cap.position.y = size.tower;
        tower.add(cap);
      } else if (style === 'einbroch' && !isPalisade) {
        tower.add(this.box(radius * 2 + 1.6, 1.2, radius * 2 + 1.6, STYLE_3D.einbroch.trim, 0, size.tower, 0));
      } else {
        const capH = style === 'geffen' || style === 'lutie' ? 12 : 8;
        const cap = this.mesh(new THREE.ConeGeometry(radius + 1.4, capH, 12), this.mat(style === 'umbala' ? thatchOf(roof) : roof));
        cap.position.y = size.tower + capH / 2;
        tower.add(cap);
        if (style === 'lutie') tower.add(this.snowTip(radius + 1.4, capH, size.tower));
      }
      tower.position.set(tx, 0, tz);
      group.add(tower);
    }
    // the keep: a square tower (on the back wall, or where the bailey has room), crenellated, with the
    // team's flag on top
    const spot = walls.keep ?? (size.keep ? { x: (x0 + x1) / 2 - 7, y: z0 - 6, w: 14, h: 12 } : null);
    if (spot) {
      const keep = new THREE.Group();
      const [kw, kd] = [spot.w, spot.h];
      const height = size.keep || 22 + kw;
      keep.add(this.box(kw, height, kd, stone));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) keep.add(this.box(2.4, 2.4, 2.4, stone, sx * (kw / 2 - 1.2), height, sz * (kd / 2 - 1.2)));
      keep.add(this.box(kw - 4, 1, kd - 4, roofShade, 0, height, 0));
      const glass = new THREE.MeshStandardMaterial({ color: '#2a1d12', emissive: '#fcd77a', emissiveIntensity: 0.05 });
      for (const wy of [height * 0.45, height * 0.7]) {
        const win = this.box(2.4, 3.6, 0.6, glass, 0, wy, kd / 2 + 0.1);
        win.userData.isWindow = true;
        keep.add(win);
      }
      keep.add(this.box(0.5, 10, 0.5, '#5e3c20', 0, height + 1, 0));
      const flag = this.mesh(new THREE.PlaneGeometry(7, 4.4), this.mat(roof, { side: THREE.DoubleSide }), { cast: false });
      flag.geometry.translate(3.5, 0, 0);
      flag.position.set(0.3, height + 8.6, 0);
      flag.userData.isFlag = true;
      keep.add(flag);
      keep.position.set(spot.x + kw / 2, 0, spot.y + kd / 2);
      group.add(keep);
    }
    return group;
  }

  // What plot.js grew around the castle, plot-local: halls, houses and barns in the town's walls, the
  // fields, the trees and the bailey's well. One glass for all their windows, lit at night.
  buildLand(plan, design, team) {
    const group = new THREE.Group();
    const glass = new THREE.MeshStandardMaterial({ color: '#2a1d12', emissive: '#fcd77a', emissiveIntensity: 0.05 });
    const style = STYLE_3D[design.style] ? design.style : 'prontera';
    const isHut = design.era <= 1;
    const wall = isHut ? '#8a5a32' : STYLE_3D[style].wall;
    for (const b of plan.buildings) if (b.kind !== 'keep') group.add(this.buildHouse(b, wall, isHut, team, glass));
    for (const field of plan.fields) group.add(this.buildField(field));
    const sails = [];
    for (const p of plan.props) group.add(this.buildProp(p, team, sails));
    const trees = plan.trees.map((tree) => ({ x: tree.x, z: tree.y, s: 0.75 + tree.size * 0.15 }));
    const [pine, fir] = [modelParts('pine'), modelParts('fir')];
    if (trees.length) for (const mesh of pine && fir ? this.modelTrees(trees, [pine, fir]) : this.primitiveTrees(trees)) group.add(Object.assign(mesh, { castShadow: true, receiveShadow: true }));
    if (plan.well) {
      const well = new THREE.Group();
      const ring = this.mesh(new THREE.CylinderGeometry(4, 4.4, 3, 14), this.mat('#a59a86'));
      ring.position.y = 1.5;
      const water = this.mesh(new THREE.CircleGeometry(3.3, 14), this.mat('#3b6fa8'), { cast: false });
      water.rotation.x = -Math.PI / 2;
      water.position.y = 2.6;
      const roof = this.gable(10, 3, 5, '#8a5a32');
      roof.position.y = 8;
      well.add(ring, water, this.box(0.8, 8, 0.8, '#5e3c20', -3.6, 0, 0), this.box(0.8, 8, 0.8, '#5e3c20', 3.6, 0, 0), roof);
      well.position.set(plan.well.x, 0, plan.well.y - 6); // 2D stands it from its foot
      group.add(well);
    }
    return { group, glass, sails };
  }

  // What else the village grew, on its footprint: a haystack, a woodpile, a market stall in the
  // team's stripes, a windmill (its sails go into `sails`, to turn) or a pond.
  buildProp(p, team, sails) {
    const prop = new THREE.Group();
    if (p.kind === 'haystack') {
      const hay = this.mesh(new THREE.SphereGeometry(1, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), this.mat('#e0c060', { flatShading: true }));
      hay.scale.set(p.w / 2, 5, p.h / 2);
      prop.add(hay);
    } else if (p.kind === 'woodpile') {
      const logs = this.mat('#8a5a32');
      const gap = (p.w - 3) / 2;
      for (const [x, y] of [[-gap, 1.3], [0, 1.3], [gap, 1.3], [-gap / 2, 3.6], [gap / 2, 3.6]]) {
        const log = this.mesh(new THREE.CylinderGeometry(1.3, 1.3, p.h, 6), logs);
        log.rotation.x = Math.PI / 2;
        log.position.set(x, y, 0);
        prop.add(log);
      }
    } else if (p.kind === 'stall') {
      for (const [x, z] of [[-p.w / 2 + 0.6, -p.h / 2 + 0.6], [p.w / 2 - 0.6, -p.h / 2 + 0.6], [-p.w / 2 + 0.6, p.h / 2 - 0.6], [p.w / 2 - 0.6, p.h / 2 - 0.6]]) prop.add(this.box(0.8, 9, 0.8, '#5e3c20', x, 0, z));
      prop.add(this.box(p.w - 1, 3, 2.4, '#8a5a32', 0, 0, p.h / 2 - 1.4));
      const stripe = p.w / 4;
      for (let i = 0; i < 4; i++) prop.add(this.box(stripe, 0.6, p.h + 1.6, i % 2 ? '#f4f4f0' : team[0], -p.w / 2 + stripe * (i + 0.5), 9, 0));
    } else if (p.kind === 'windmill') {
      const tower = this.mesh(new THREE.CylinderGeometry(3.4, 5, 17, 8), this.mat('#d8c7a2'));
      tower.position.y = 8.5;
      const cap = this.mesh(new THREE.ConeGeometry(4.4, 5, 8), this.mat(team[0]));
      cap.position.y = 19.5;
      const hub = new THREE.Group();
      hub.position.set(0, 15, 4);
      for (let k = 0; k < 4; k++) {
        const arm = new THREE.Group();
        arm.rotation.z = (k * Math.PI) / 2;
        arm.add(this.box(0.6, 10, 0.4, '#5e3c20', 0, 0.5, 0), this.box(2.2, 7, 0.2, '#f4f4f0', 1.4, 3.5, 0));
        hub.add(arm);
      }
      hub.userData.phase = (p.seed % 628) / 100;
      sails.push(hub);
      prop.add(tower, cap, hub, this.box(2.4, 4, 0.4, '#3a2716', 0, 0, 4.6));
    } else if (p.kind === 'pond') {
      const rim = this.mesh(new THREE.CircleGeometry(1, 20), this.mat('#6a9a48'), { cast: false });
      const water = this.mesh(new THREE.CircleGeometry(1, 20), this.mat('#3b6fa8', { roughness: 0.2 }), { cast: false });
      for (const [disc, grow, y] of [[rim, 1.5, 0.2], [water, 0, 0.3]]) {
        disc.rotation.x = -Math.PI / 2;
        disc.scale.set(p.w / 2 + grow, p.h / 2 + grow, 1);
        disc.position.y = y;
        prop.add(disc);
      }
    }
    prop.position.set(p.x + p.w / 2, 0, p.y + p.h / 2);
    return prop;
  }

  // A hall, house or barn on its footprint, the door on the front (+z), the ridge along its axis.
  buildHouse(b, wall, isHut, team, glass) {
    const house = new THREE.Group();
    const bodyH = BODY_3D[b.kind];
    const walls = b.kind === 'barn' ? '#9a4630' : wall;
    house.add(this.box(b.w, bodyH, b.h, walls));
    const roofColor = b.kind === 'hall' ? team[0] : isHut ? thatchOf(team[0]) : (VILLAGE_ROOFS_3D[(b.seed >>> 5) % 3] ?? team[0]);
    const isAlongX = b.axis === 'x';
    const [span, length] = isAlongX ? [b.h, b.w] : [b.w, b.h];
    const ridge = new THREE.Group();
    ridge.add(this.gable(span + 2, Math.max(4, span * 0.5), length + 2, roofColor, { wall: walls }));
    ridge.rotation.y = isAlongX ? Math.PI / 2 : 0;
    ridge.position.y = bodyH;
    house.add(ridge);
    const front = b.h / 2 + 0.1;
    const doorW = b.kind === 'barn' ? 5 : 2.4;
    const doorX = b.kind === 'house' ? -b.w / 2 + 3 + (b.seed % Math.max(1, b.w - 9)) + doorW / 2 : 0;
    house.add(this.box(doorW, Math.min(bodyH - 1.5, b.kind === 'barn' ? 6.5 : 4.4), 0.4, '#3a2716', doorX, 0, front));
    if (b.kind !== 'barn') {
      for (let wx = -b.w / 2 + 3; wx <= b.w / 2 - 3; wx += 6) {
        if (Math.abs(wx - doorX) < doorW / 2 + 1.6) continue;
        const win = this.box(1.8, 1.8, 0.4, glass, wx, bodyH * 0.5, front);
        house.add(win);
      }
    }
    if (b.kind === 'house' && b.seed % 3 === 0) house.add(this.box(1.6, Math.max(4, span * 0.5) + 2, 1.6, '#7d7362', b.w / 2 - 3, bodyH, 0));
    house.position.set(b.x + b.w / 2, 0, b.y + b.h / 2);
    return house;
  }

  // A field: tilled earth under rows of the crop its seed picks.
  buildField(f) {
    const field = new THREE.Group();
    field.add(this.box(f.w, 0.5, f.h, '#86683f'));
    const crop = this.mat(CROPS_3D[(f.seed >>> 3) % CROPS_3D.length]);
    for (let z = -f.h / 2 + 2; z < f.h / 2 - 1; z += 3) {
      const row = this.box(f.w - 3, 1.2, 1.1, crop, 0, 0.4, z);
      row.castShadow = false;
      field.add(row);
    }
    field.position.set(f.x + f.w / 2, 0, f.y + f.h / 2);
    return field;
  }

  // A dashed rectangle w × h on the ground, from (0, 0): a base's territory or a ghost's.
  outline(w, h, y, material) {
    const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, y, 0), new THREE.Vector3(w, y, 0), new THREE.Vector3(w, y, h), new THREE.Vector3(0, y, h)]);
    const line = new THREE.LineLoop(geometry, material);
    line.computeLineDistances();
    return line;
  }

  /**
   * "Personalizar base": the castle as the 3D map will show it (size, walls, turn), on the dialog's
   * own canvas and WebGL context, seen from the map's starting angle. Flags flap with `t`.
   */
  renderPreview(canvas, design, team, t) {
    if (this.preview?.canvas !== canvas) {
      this.preview?.renderer.dispose();
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.shadowMap.enabled = true;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      const scene = new THREE.Scene();
      scene.background = new THREE.Color('#2a2016');
      scene.add(new THREE.HemisphereLight('#cfe4ff', '#55602f', 1.1));
      const sun = new THREE.DirectionalLight('#ffe2b0', 2.6);
      sun.position.set(-40, 120, 90);
      sun.castShadow = true;
      Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 10, far: 400 });
      sun.shadow.mapSize.set(1024, 1024);
      scene.add(sun, sun.target);
      const ground = this.mesh(new THREE.CircleGeometry(78, 48), this.mat('#5b8a37'), { cast: false });
      ground.rotation.x = -Math.PI / 2;
      const yard = this.mesh(new THREE.PlaneGeometry(70, 12), this.mat('#9c835a'), { cast: false });
      yard.rotation.x = -Math.PI / 2;
      yard.position.set(0, 0.2, 30);
      scene.add(ground, yard);
      const camera = new THREE.PerspectiveCamera(30, 1, 1, 1000);
      this.preview = { canvas, renderer, scene, camera, key: '', model: null };
    }
    const p = this.preview;
    const key = `${design.era}|${design.style}|${design.form}|${design.size}|${design.rotation}|${design.width}x${design.depth}x${design.height}|${S.isPalisade(design)}|${team[0]}`;
    if (key !== p.key) {
      if (p.model) {
        p.scene.remove(p.model);
        disposeOwn(p.model); // the dimension sliders rebuild it on every step
      }
      const { group } = this.buildCastle(design, team);
      // centered on the town center's middle, the yard in front (+z)
      group.position.set(-(this.L.TOWN_CENTER.x + this.L.TOWN_CENTER.w / 2), 0, -(this.L.TOWN_CENTER.y + this.L.TOWN_CENTER.h / 2));
      p.model = new THREE.Group();
      p.model.add(group);
      p.scene.add(p.model);
      p.key = key;
    }
    p.model.traverse((node) => {
      if (node.userData.isFlag) node.rotation.y = Math.sin(t * 3 + node.parent.position.x) * 0.4;
      if (node.userData.isCrystal) node.rotation.y = t * 1.2;
      if (node.userData.isClockHand) node.rotation.z = -((Math.floor(t / 2) % 4) * Math.PI) / 2;
      animateWorks(node, t);
    });
    const width = canvas.clientWidth || canvas.width;
    const height = canvas.clientHeight || canvas.height;
    p.renderer.setSize(width, height, false);
    p.camera.aspect = width / height;
    p.camera.updateProjectionMatrix();
    const distance = 230;
    p.camera.position.set(Math.sin(START_YAW) * distance * 0.75, distance * 0.62, Math.cos(START_YAW) * distance * 0.75);
    p.camera.lookAt(0, 14, 0);
    p.renderer.render(p.scene, p.camera);
  }

  /**
   * The Batedor's equipment window: the hero as the 3D map shows it (horse, rider and gear of its
   * level, `look.tunic`), on a patch of ground, turning slowly, on the window's own canvas and WebGL
   * context. The horse stands and grazes, the pennant flaps and the aura pulses with `t`.
   */
  renderHeroPreview(canvas, look, t) {
    if (this.heroPreview?.canvas !== canvas) {
      this.heroPreview?.renderer.dispose();
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      const scene = new THREE.Scene();
      scene.background = new THREE.Color('#1c1711'); // the equipment window's own brown
      scene.add(new THREE.HemisphereLight('#cfe4ff', '#55602f', 1.2));
      const sun = new THREE.DirectionalLight('#ffe2b0', 2.4);
      sun.position.set(-40, 90, 70);
      const ground = this.mesh(new THREE.CircleGeometry(24, 40), this.mat('#3d3322'), { cast: false });
      ground.rotation.x = -Math.PI / 2;
      scene.add(sun, ground);
      const camera = new THREE.PerspectiveCamera(30, 1, 1, 500);
      this.heroPreview = { canvas, renderer, scene, camera, key: '', entry: null };
    }
    const p = this.heroPreview;
    if (look.tunic !== p.key) {
      if (p.entry) {
        p.scene.remove(p.entry.group);
        p.entry.parts.model?.root.traverse((node) => node.skeleton?.dispose());
      }
      p.entry = this.buildKnight(look);
      p.scene.add(p.entry.group);
      p.key = look.tunic;
    }
    const { entry } = p;
    const ch = { look, walkClock: 0 };
    if (entry.parts.rider) this.poseMount(entry, ch, t, { isWalking: false, isDangling: false });
    this.poseKnight(entry, ch, t, false);
    entry.parts.scroll.visible = false; // the missions have their own tab
    entry.group.rotation.y = 0.6 + t * 0.45;
    const width = canvas.clientWidth || canvas.width;
    const height = canvas.clientHeight || canvas.height;
    p.renderer.setSize(width, height, false);
    p.camera.aspect = width / height;
    p.camera.updateProjectionMatrix();
    p.camera.position.set(0, 33, 73); // horse and lance fill the window
    p.camera.lookAt(0, 19, 0);
    p.renderer.render(p.scene, p.camera);
  }

  // The waiting pen's low fence (core-local): two rails per side and a post every ~5 units, one
  // geometry shared by every base, so rebuilding a base never makes (or leaks) another.
  waitFenceGeometry() {
    if (this.fenceGeometry) return this.fenceGeometry;
    const pieces = [];
    const add = (w, h, d, x, y, z) => pieces.push(new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z));
    const points = this.L.WAIT_FENCE;
    for (let i = 1; i < points.length; i++) {
      const [ax, az] = points[i - 1];
      const [bx, bz] = points[i];
      const length = Math.hypot(bx - ax, bz - az);
      const isAlongX = az === bz;
      for (const y of [2, 4]) add(isAlongX ? length : 0.5, 0.7, isAlongX ? 0.5 : length, (ax + bx) / 2, y, (az + bz) / 2);
      const posts = Math.max(1, Math.round(length / 5));
      for (let k = i === 1 ? 0 : 1; k <= posts; k++) add(1, 5.4, 1, ax + ((bx - ax) * k) / posts, 0, az + ((bz - az) * k) / posts);
    }
    this.fenceGeometry = mergeGeometries(pieces);
    return this.fenceGeometry;
  }

  buildBase(base, design) {
    const [team, teamShade] = base.team;
    const group = new THREE.Group();
    const parts = {};
    // the land plot.js grew; the core (everything base-local below) stands on its bottom edge
    const plan = this.empire.planOf(base);
    const lay = this.empire.layoutOf(base); // a lot's core, or the half-lot one
    const site = lay.isSmall ? SMALL_SITE : 1;
    const [cx, cz] = [plan.core.x, plan.core.y];
    const toCore = ([x, y]) => [x - cx, y - cz];
    const keep = plan.buildings.find((b) => b.kind === 'keep');
    const bailey = !this.isSimple && plan.walls && { path: plan.walls.map(toCore), towers: plan.towers.map(toCore), keep: keep && { ...keep, x: keep.x - cx, y: keep.y - cz } };
    // town center: center of its 2D box, front facing the yard (turned and sized as designed, grown
    // with the land)
    const { group: castle, tc } = this.buildCastle({ ...design, growth: plan.growth }, base.team, bailey, lay.tc);
    castle.userData.hit = { project: base.project };
    castle.position.set(cx, 0, cz);
    group.add(castle);
    const land = this.isSimple ? { group: new THREE.Group(), glass: new THREE.MeshStandardMaterial(), sails: [] } : this.buildLand(plan, design, base.team);
    parts.villageGlass = land.glass;
    parts.sails = land.sails;
    group.add(land.group);
    // the top of the town center's roof (turned and sized), where the balloon over it points
    castle.updateMatrixWorld(true);
    const roof = new THREE.Box3().setFromObject(tc);
    parts.balloonAt = { x: (roof.min.x + roof.max.x) / 2, y: roof.max.y, z: (roof.min.z + roof.max.z) / 2 };
    // gold mine: the mine model (its banners in the team color) or a rocky mound with its entrance, nuggets at the foot
    const mine = new THREE.Group();
    const mineModel = modelParts('mine', { team });
    if (mineModel) {
      const rock = this.mesh(mineModel.geometry, mineModel.material);
      rock.scale.setScalar(MODEL_SCALE.mine);
      mine.add(rock);
    } else {
      const mound = this.mesh(new THREE.DodecahedronGeometry(11, 1), this.mat('#8d8f96', { flatShading: true }));
      mound.scale.set(1.35, 0.75, 0.9);
      mound.position.y = 3;
      mine.add(mound, this.box(7, 9, 2, '#1a1410', 0, 0, 9), this.box(9, 1.2, 2.4, '#8a5a32', 0, 9, 9.2));
    }
    const goldMat = this.mat('#f2c84b', { metalness: 0.7, roughness: 0.35, emissive: '#5a3d00', emissiveIntensity: 0.3 });
    for (const [gx, gz] of mineModel ? MINE_NUGGETS : [[-9, 6], [8, 7], [-4, 9], [10, 2], [-12, 1]]) {
      const nugget = this.mesh(new THREE.IcosahedronGeometry(1.5, 0), goldMat);
      nugget.position.set(gx, 1, gz);
      mine.add(nugget);
    }
    mine.scale.setScalar(site);
    mine.position.set(cx + lay.mine.foot[0], 0, cz + lay.mine.foot[1] - (mineModel ? 9 : 8) * site); // 2D stands it from its foot
    // forge: the blacksmith model (roof in the team color) or an open shed over the furnace, fire
    // glowing when someone works the terminal
    const forge = new THREE.Group();
    const forgeModel = modelParts('forge', { team });
    const s = MODEL_SCALE.forge;
    const mouth = forgeModel ? { x: FORGE_MOUTH.x * s, y: FORGE_MOUTH.y * s, z: FORGE_MOUTH.z * s } : { x: -4, y: 1.5, z: 1.1 };
    if (forgeModel) {
      const smithy = this.mesh(forgeModel.geometry, forgeModel.material);
      smithy.scale.setScalar(s);
      forge.add(smithy);
    } else {
      for (const [px, pz] of [[-12, -8], [12, -8], [-12, 8], [12, 8]]) forge.add(this.box(1.2, 13, 1.2, '#5e3c20', px, 0, pz));
      const shedRoof = this.box(28, 1.4, 20, '#8a5a32', 0, 13, 0);
      shedRoof.rotation.x = 0.12;
      forge.add(shedRoof, this.box(11, 9, 8, '#7d7362', -4, 0, -3), this.box(4, 9, 4, '#6b6253', -4, 9, -5), this.box(6, 2.4, 3, '#3b3f4a', 6, 2.6, 3));
    }
    parts.fire = this.mesh(new THREE.BoxGeometry(5, 3.4, 0.6), new THREE.MeshStandardMaterial({ color: '#f97316', emissive: '#f97316', emissiveIntensity: 1 }), { cast: false });
    parts.fire.position.set(mouth.x, mouth.y + 1.7, mouth.z);
    forge.add(parts.fire);
    parts.forgeLight = new THREE.PointLight('#ff7a2a', 0, 60, 1.8);
    parts.forgeLight.position.set(mouth.x, 6, mouth.z + 3);
    forge.add(parts.forgeLight);
    forge.scale.setScalar(site);
    forge.position.set(cx + lay.forge.foot[0], 0, cz + lay.forge.foot[1] - 12 * site);
    // banner in the team color
    const banner = new THREE.Group();
    banner.add(this.box(0.8, 26, 0.8, '#5e3c20', 0, 0, 0));
    parts.flag = this.mesh(new THREE.PlaneGeometry(9, 6), this.mat(team, { side: THREE.DoubleSide }), { cast: false });
    parts.flag.geometry.translate(4.5, 0, 0);
    parts.flag.position.set(0.4, 22, 0);
    banner.add(parts.flag);
    if (lay.banner) banner.position.set(cx + lay.banner.x, 0, cz + lay.banner.y);
    banner.visible = Boolean(lay.banner); // a half-lot core has none
    banner.userData.hit = { project: base.project };
    // the bell, up only while an agent here is blocked on you
    parts.bell = new THREE.Group();
    parts.bell.add(this.box(1, 18, 1, '#5e3c20', -6, 0, 0), this.box(1, 18, 1, '#5e3c20', 6, 0, 0), this.box(14, 1.4, 1.4, '#8a5a32', 0, 18, 0));
    parts.bellBody = this.mesh(new THREE.CylinderGeometry(1.4, 3.4, 5, 14), this.mat('#f2c84b', { metalness: 0.75, roughness: 0.3 }));
    parts.bellBody.geometry.translate(0, -2.5, 0);
    parts.bellBody.position.y = 17.4;
    parts.bell.add(parts.bellBody);
    parts.bell.position.set(cx + lay.bell.x, 0, cz + lay.bell.y);
    // the waiting pen's fence: who waits on you stands apart from who works
    // (a half-lot core's bench instead)
    let fence;
    if (lay.bench) {
      const { x, y, w } = lay.bench;
      fence = new THREE.Group();
      fence.add(this.box(w, 1.2, 3, '#8a5a32', x + w / 2, 2.6, y - 2), this.box(1, 2.6, 2.4, '#5e3c20', x + 1.5, 0, y - 2), this.box(1, 2.6, 2.4, '#5e3c20', x + w - 1.5, 0, y - 2));
    } else fence = this.mesh(this.waitFenceGeometry(), this.mat('#8a5a32'));
    fence.position.set(cx, 0, cz);
    // territory: a dashed line around the plot, and a glow for the base picked or hovered
    parts.territory = this.outline(plan.w, plan.h, 0.6, new THREE.LineDashedMaterial({ color: team, dashSize: 4, gapSize: 3, transparent: true, opacity: 0.9 }));
    parts.glow = new THREE.Mesh(new THREE.PlaneGeometry(plan.w, plan.h), new THREE.MeshBasicMaterial({ color: LINK_COLOR, transparent: true, opacity: 0, depthWrite: false }));
    parts.glow.rotation.x = -Math.PI / 2;
    parts.glow.position.set(plan.w / 2, 0.4, plan.h / 2);
    // a quiet base's land in shade (over the fields, under whatever stands)
    parts.shade = new THREE.Mesh(new THREE.PlaneGeometry(plan.w, plan.h), new THREE.MeshBasicMaterial({ color: S.PLOT_SHADE.color, transparent: true, opacity: S.PLOT_SHADE.alpha, depthWrite: false }));
    parts.shade.rotation.x = -Math.PI / 2;
    parts.shade.position.set(plan.w / 2, 0.7, plan.h / 2);
    // wonders: lasting monuments for milestones of work
    const wonders = this.empire.wondersOf(base.project);
    if (wonders.includes('obelisk')) {
      const obelisk = new THREE.Group();
      obelisk.add(this.box(9, 3, 9, '#7d7362', 0, 0, 0));
      const shaft = this.mesh(new THREE.CylinderGeometry(1.6, 2.8, 26, 4), this.mat('#c4b9a3'));
      shaft.rotation.y = Math.PI / 4;
      shaft.position.y = 16;
      const tip = this.mesh(new THREE.ConeGeometry(2.3, 4, 4), this.mat('#f2c84b', { metalness: 0.8, roughness: 0.3 }));
      tip.rotation.y = Math.PI / 4;
      tip.position.y = 31;
      obelisk.add(shaft, tip);
      obelisk.position.set(cx + lay.obelisk[0], 0, cz + lay.obelisk[1] - 2);
      group.add(obelisk);
    }
    if (wonders.includes('beacon')) {
      const beacon = new THREE.Group();
      const tower = this.mesh(new THREE.CylinderGeometry(3.6, 4.4, 22, 10), this.mat('#a59a86'));
      tower.position.y = 11;
      const fire = this.mesh(new THREE.SphereGeometry(2.6, 12, 10), new THREE.MeshStandardMaterial({ color: '#f97316', emissive: '#f97316', emissiveIntensity: 2.4 }), { cast: false });
      fire.position.y = 25;
      parts.beaconLight = new THREE.PointLight('#ff8a3c', 0, 90, 1.6);
      parts.beaconLight.position.y = 26;
      beacon.add(tower, fire, parts.beaconLight);
      beacon.position.set(cx + lay.beacon[0], 0, cz + lay.beacon[1] - 2);
      group.add(beacon);
    }
    parts.beam = new THREE.Mesh(new THREE.CylinderGeometry(9, 14, 140, 20, 1, true), new THREE.MeshBasicMaterial({ color: '#fde68a', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    parts.beam.position.set(cx + lay.tc.x + lay.tc.w / 2, 70, cz + lay.tc.y + lay.tc.h / 2 + 4);
    parts.beam.visible = false;
    group.add(mine, forge, banner, fence, parts.bell, parts.territory, parts.glow, parts.shade, parts.beam);
    parts.tc = tc;
    parts.castle = castle;
    parts.team = [team, teamShade];
    return { group, parts };
  }

  syncBases(now, t, sky) {
    const e = this.empire;
    const seen = new Set();
    const busy = new Map(); // project -> nodes worked now
    const alarm = new Set();
    const linked = new Set();
    for (const ch of e.chars.values()) {
      if (ch.isObserver || ch.goal?.type === 'exit') continue;
      if (ch.mode === 'working' && ch.agent.status === 'busy') {
        if (!busy.has(ch.project)) busy.set(ch.project, new Set());
        busy.get(ch.project).add(ch.node);
      }
      if (ch.agent.status === 'busy' && ch.agent.activity.kind === 'asking') alarm.add(ch.project);
      if (ch.id === e.linkedId) linked.add(ch.project);
    }
    for (const base of e.bases.values()) {
      seen.add(base.project);
      const design = e.designOf(base.project);
      const key = `${design.era}|${design.style}|${design.form}|${design.size}|${design.rotation}|${design.width}x${design.depth}x${design.height}|${S.isPalisade(design)}|${base.team[0]}|${e.wondersOf(base.project).join(',')}|${base.size.w}x${base.size.h}+${base.coreX}|${this.isSimple}`;
      let entry = this.bases.get(base.project);
      const isResizing = e.drag?.kind === 'resize' && e.drag.project === base.project;
      if (!entry || (entry.key !== key && !(isResizing && now - entry.builtAt < RESIZE_REBUILD_MS))) {
        if (entry) this.dropBase(entry);
        entry = { ...this.buildBase(base, design), key, builtAt: now };
        this.bases.set(base.project, entry);
        this.scene.add(entry.group);
      }
      const { group, parts } = entry;
      group.position.set(base.pos.x, 0, base.pos.y);
      const rise = Math.min(1, Math.max(0, (now - base.foundedAt) / 1400));
      parts.tc.scale.y = Math.max(0.02, rise);
      const isAlarm = alarm.has(base.project);
      const isActive = e.isBaseActive(base.project);
      const isPicked = (e.baseHighlight?.project === base.project && now < e.baseHighlight.until) || linked.has(base.project) || e.summonTarget === base.project;
      parts.territory.material.color.set(isAlarm ? kindInfo('asking').color : isActive ? base.team[0] : S.QUIET_BORDER);
      parts.territory.material.opacity = isAlarm ? 0.55 + 0.45 * Math.sin(t * 7) : 0.9;
      parts.shade.visible = !isActive;
      parts.glow.material.opacity = isPicked ? 0.1 + 0.08 * Math.sin(t * 6) : isAlarm ? 0.06 + 0.06 * Math.sin(t * 7) : 0;
      parts.glow.material.color.set(isPicked ? LINK_COLOR : kindInfo('asking').color);
      parts.bell.visible = isAlarm && rise === 1;
      parts.bellBody.rotation.z = isAlarm ? Math.sin(t * 9) * 0.35 : 0;
      const isForging = busy.get(base.project)?.has('forge');
      parts.fire.material.emissiveIntensity = (isForging ? 2.2 : 1) + 0.4 * Math.sin(t * 13);
      parts.forgeLight.intensity = (sky.isNight ? 1 : 0.15) * (isForging ? 900 : 350);
      // a quiet base's flag hangs limp at the foot of the pole
      parts.flag.rotation.y = isActive ? Math.sin(t * 2.4 + base.pos.x) * 0.35 : 0;
      parts.flag.position.y = isActive ? 22 : 9;
      parts.flag.scale.set(isActive ? 1 : 0.35, isActive ? 1 : 1.3, 1);
      for (const hub of parts.sails) hub.rotation.z = -(t * 0.9 + hub.userData.phase);
      if (parts.beaconLight) parts.beaconLight.intensity = sky.isNight ? 1200 : 200;
      // the age-up beam: a column of gold light over the town center for a few seconds
      const ageUp = e.celebrations.get(base.project);
      const k = ageUp === undefined ? 1 : (now - ageUp) / 4500;
      parts.beam.visible = k < 1;
      if (k < 1) {
        parts.beam.material.opacity = 0.55 * Math.sin(Math.PI * k);
        parts.beam.rotation.y = t;
        parts.tc.scale.setScalar(1 + 0.06 * Math.sin(Math.PI * k));
      } else {
        parts.tc.scale.x = 1;
        parts.tc.scale.z = 1;
      }
      parts.castle.traverse((node) => {
        if (node.userData.isFlag) node.rotation.y = Math.sin(t * 3 + node.parent.position.x) * 0.4;
        if (node.userData.isCrystal) {
          node.rotation.y = t * 1.2;
          node.position.y += Math.sin(t * 2) * 0.02;
        }
        if (node.userData.isClockHand) node.rotation.z = -((Math.floor(t / 2) % 4) * Math.PI) / 2;
        if (node.userData.isWindow) node.material.emissiveIntensity = sky.isNight ? 1.6 : 0.05;
        animateWorks(node, t);
      });
      parts.villageGlass.emissiveIntensity = sky.isNight ? 1.2 : 0.05;
    }
    for (const [project, entry] of this.bases) {
      if (seen.has(project)) continue;
      this.dropBase(entry);
      this.bases.delete(project);
    }
  }

  // A base leaves the scene (or is rebuilt, as often as every frame while its land is resized): its
  // own geometries go with it; the models' and the shared pane are left alone.
  dropBase(entry) {
    this.scene.remove(entry.group);
    disposeOwn(entry.group);
  }

  // ---------- Villagers, scout and soldiers ----------

  // The KayKit villager when its model has loaded (models.js), else the one built here from blocks.
  buildVillager(look) {
    const model = villagerModel(look);
    const { group, parts } = model ? this.buildModelVillager(model) : this.buildBlockVillager(look);
    Object.assign(parts, this.buildChips(look.seed));
    group.add(parts.chips);
    parts.ring = new THREE.Mesh(new THREE.RingGeometry(3.6, 4.6, 28), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false }));
    parts.ring.rotation.x = -Math.PI / 2;
    parts.ring.position.y = 0.5;
    group.add(parts.ring);
    parts.emote = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, transparent: true }));
    parts.emote.scale.set(7, 7, 1);
    parts.emote.position.set(3.5, 17, 0);
    parts.emote.renderOrder = 10;
    group.add(parts.emote);
    parts.conflict = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.emoteTexture('conflict'), depthTest: false, transparent: true }));
    parts.conflict.scale.set(7, 7, 1);
    parts.conflict.position.set(-3.5, 17, 0);
    parts.conflict.renderOrder = 10;
    group.add(parts.conflict);
    // The emote hangs from its balloon's tail tip (1 px up its canvas), so it pops from there.
    parts.feeling = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, transparent: true }));
    parts.feeling.center.set(0.5, 1 / FEELING_CANVAS);
    parts.feeling.renderOrder = 11;
    parts.feeling.visible = false;
    group.add(parts.feeling);
    parts.arrow =this.mesh(new THREE.ConeGeometry(1.8, 3.6, 10), new THREE.MeshBasicMaterial({ color: LINK_COLOR }), { cast: false });
    parts.arrow.rotation.x = Math.PI;
    group.add(parts.arrow);
    return { group, parts };
  }

  // Its rig plays a clip per pose (poseModel); the tools ride its bones, in model units.
  buildModelVillager(model) {
    const group = new THREE.Group();
    model.rest = limbRests(model.root);
    model.undo = [];
    model.root.scale.setScalar(MODEL_SCALE.villager);
    model.mixer = new THREE.AnimationMixer(model.root);
    group.add(model.root);
    const tools = this.buildModelTools();
    const bone = (name) => model.root.getObjectByName(name);
    bone('handslotr').add(tools.pickaxe, tools.hammer);
    bone('head').add(tools.spyglass);
    bone('chest').add(tools.scroll);
    return { group, parts: { model, tools } };
  }

  buildBlockVillager(look) {
    const group = new THREE.Group();
    const parts = {};
    parts.legs = [-1, 1].map((side) => {
      const leg = this.box(1.3, 4, 1.4, look.pants, side * 0.9, 0, 0);
      group.add(leg);
      return leg;
    });
    // The torso pivots at the hips, so a blow leans the whole upper body into it; head and arms ride on it.
    parts.torso = new THREE.Group();
    parts.torso.position.y = 4;
    // chibi proportions, as Ragnarok's characters: a big head on a short body
    const body = this.mesh(new THREE.CapsuleGeometry(2.1, 2.6, 4, 10), this.mat(look.tunic));
    body.position.y = 1.8;
    parts.head = new THREE.Group();
    parts.head.position.y = 7.2;
    const hair = this.mesh(new THREE.SphereGeometry(3.05, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2.1), this.mat(look.hair));
    hair.position.y = 0.3;
    parts.head.add(this.mesh(new THREE.SphereGeometry(2.9, 16, 12), this.mat(look.skin)), hair);
    if (look.hat === 1) {
      const hat = this.mesh(new THREE.ConeGeometry(4.4, 2.6, 14), this.mat('#d9b46b'));
      hat.position.y = 3.4;
      parts.head.add(hat);
    } else if (look.hat === 2) {
      const hat = this.mesh(new THREE.CylinderGeometry(2.7, 2.9, 1.8, 14), this.mat(look.tunicShade));
      hat.position.y = 3;
      parts.head.add(hat);
    }
    // arms hang from the shoulders: [0] is the free hand, [1] holds the tools
    parts.arms = [-1, 1].map((side) => {
      const arm = new THREE.Group();
      arm.position.set(side * 2.3, 4, 0);
      arm.add(this.box(1.1, 3, 1.1, look.tunicShade, 0, -3, 0), this.box(1, 1, 1, look.skin, 0, -4, 0));
      return arm;
    });
    parts.tools = this.buildTools();
    parts.arms[1].add(parts.tools.pickaxe, parts.tools.hammer);
    parts.head.add(parts.tools.spyglass);
    parts.torso.add(body, parts.head, ...parts.arms, parts.tools.scroll);
    group.add(parts.torso);
    return { group, parts };
  }

  // Shown only while in use. Handles run on down from the hand, so the arm's swing is the tool's.
  buildTools() {
    const pickaxe = new THREE.Group();
    const pick = this.box(0.6, 0.8, 5, '#aab3c4', 0, -9.6, 0);
    pickaxe.add(this.box(0.5, 6, 0.5, '#8a5a32', 0, -9.2, 0), pick);
    pickaxe.userData.tip = pick;
    const hammer = new THREE.Group();
    const head = this.box(1.5, 1.5, 2.6, '#5b6170', 0, -8.4, 0);
    hammer.add(this.box(0.5, 4.6, 0.5, '#8a5a32', 0, -7.7, 0), head);
    hammer.userData.tip = head;
    // on the head, along the gaze: it follows the villager sweeping the horizon
    const spyglass = this.mesh(new THREE.CylinderGeometry(0.9, 0.6, 6, 10), this.mat('#c9a227', { metalness: 0.5, roughness: 0.4 }));
    spyglass.rotation.x = Math.PI / 2;
    spyglass.position.set(1.1, 0.1, 5.4);
    // an open scroll held out in both hands, tilted up to the face and past the hat brim, seen from above
    const scroll = new THREE.Group();
    scroll.add(this.box(4.2, 3, 0.2, '#efe3c0', 0, -1.5, 0));
    for (const y of [-1.5, 1.5]) {
      const roller = this.mesh(new THREE.CylinderGeometry(0.4, 0.4, 4.8, 8), this.mat('#8a5a32'));
      roller.rotation.z = Math.PI / 2;
      roller.position.y = y;
      scroll.add(roller);
    }
    scroll.position.set(0, 3.2, 4.6);
    scroll.rotation.x = 0.85;
    for (const tool of [pickaxe, hammer, spyglass, scroll]) tool.visible = false;
    return { pickaxe, hammer, spyglass, scroll };
  }

  // The same tools for the model, in its bones' units: handles run up the hand slot (+y) as the
  // pack's own weapons do, heads across the swing.
  buildModelTools() {
    const pickaxe = new THREE.Group();
    const pick = this.box(0.75, 0.12, 0.1, '#aab3c4', 0, 0.7, 0);
    pickaxe.add(this.box(0.08, 0.95, 0.08, '#8a5a32', 0, -0.15, 0), pick);
    pickaxe.userData.tip = pick;
    const hammer = new THREE.Group();
    const head = this.box(0.4, 0.22, 0.22, '#5b6170', 0, 0.45, 0);
    hammer.add(this.box(0.08, 0.7, 0.08, '#8a5a32', 0, -0.1, 0), head);
    hammer.userData.tip = head;
    // at the right eye, along the gaze, the hand up under it
    const spyglass = this.mesh(new THREE.CylinderGeometry(0.1, 0.07, 0.7, 10), this.mat('#c9a227', { metalness: 0.5, roughness: 0.4 }));
    spyglass.rotation.x = Math.PI / 2;
    spyglass.position.set(-0.13, 0.36, 0.75);
    // an open scroll held out at the chest, tilted up to the face and seen from above
    const scroll = new THREE.Group();
    scroll.add(this.box(0.6, 0.45, 0.03, '#efe3c0', 0, -0.225, 0));
    for (const y of [-0.225, 0.225]) {
      const roller = this.mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 8), this.mat('#8a5a32'));
      roller.rotation.z = Math.PI / 2;
      roller.position.y = y;
      scroll.add(roller);
    }
    scroll.position.set(0, 0.1, 0.55);
    scroll.rotation.x = 0.85;
    for (const tool of [pickaxe, hammer, spyglass, scroll]) tool.visible = false;
    return { pickaxe, hammer, spyglass, scroll };
  }

  // A villager leaves the scene: its model's skeletons free their bone textures on the GPU.
  dropUnit(entry) {
    this.scene.remove(entry.group);
    entry.parts.model?.root.traverse((node) => node.skeleton?.dispose());
  }

  // Gold, sparks or dust thrown off where a tool lands: work you can see from across the map.
  buildChips(seed) {
    this.chipGeometry ??= new THREE.BoxGeometry(0.9, 0.9, 0.9);
    const chipMaterial = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
    const chips = new THREE.Group();
    const random = rng(seed);
    for (let i = 0; i < CHIPS; i++) {
      const chip = new THREE.Mesh(this.chipGeometry, chipMaterial);
      const angle = random() * Math.PI * 2;
      const reach = 0.4 + random() * 0.6;
      chip.userData.dir = [Math.cos(angle) * reach, 0.8 + random() * 0.8, Math.sin(angle) * reach];
      chips.add(chip);
    }
    chips.visible = false;
    return { chips, chipMaterial };
  }

  // A horse from models.js with a villager model on its back, riding its torso bone so it rocks
  // with the gallop. Null until both have loaded.
  buildMount(look, rider) {
    const horse = horseModel(look);
    if (!horse || !rider) return null;
    const group = new THREE.Group();
    horse.root.scale.setScalar(MODEL_SCALE.horse);
    horse.mixer = new THREE.AnimationMixer(horse.root);
    rider.rest = limbRests(rider.root);
    rider.undo = [];
    rider.root.scale.setScalar(MODEL_SCALE.villager);
    rider.root.position.set(0, SADDLE.y * MODEL_SCALE.horse - SADDLE.seat * MODEL_SCALE.villager, SADDLE.z * MODEL_SCALE.horse);
    rider.mixer = new THREE.AnimationMixer(rider.root);
    group.add(horse.root, rider.root);
    group.updateMatrixWorld(true);
    horse.root.getObjectByName('Torso').attach(rider.root);
    return { group, parts: { model: horse, rider } };
  }

  // Mounted: the horse gallops in step with the 2D frames (in the air too, held up by the pointer) or
  // stands, grazing now and then; the rider sits astride over its idle.
  poseMount(entry, ch, t, { isWalking, isDangling }) {
    const { model: horse, rider } = entry.parts;
    const dt = Math.min(0.1, t - (entry.clock ?? t));
    entry.clock = t;
    for (const [bone, quaternion] of rider.undo) bone.quaternion.copy(quaternion);
    rider.undo.length = 0;
    const phase = t + (ch.look.seed % 1000) / 97;
    if (isWalking || isDangling) playClip(horse, 'Gallop', isDangling ? t * 3 : (ch.walkClock * 14) / (2 * Math.PI), dt);
    else if (phase % 14 < 8) playClip(horse, 'Idle', phase / horse.clips.Idle.duration, dt);
    else playClip(horse, 'Eating', ((phase % 14) - 8) / horse.clips.Eating.duration, dt);
    playClip(rider, 'Idle', phase / rider.clips.Idle.duration, dt);
    sitAstride(rider);
  }

  buildScout(look) {
    const mount = this.buildMount(look, villagerModel(look));
    if (mount) return mount;
    const group = new THREE.Group();
    const [coat, shade] = look.horse;
    const horse = new THREE.Group();
    horse.add(this.box(4, 5, 12, coat, 0, 5, 0), this.box(3, 6, 3, coat, 0, 8, 6), this.box(2.6, 2.6, 5, shade, 0, 12, 8));
    for (const [lx, lz] of [[-1.4, -4.5], [1.4, -4.5], [-1.4, 4.5], [1.4, 4.5]]) horse.add(this.box(1.2, 5, 1.2, shade, lx, 0, lz));
    group.add(horse);
    const rider = this.mesh(new THREE.CapsuleGeometry(1.8, 3, 4, 8), this.mat('#5a6b3b'));
    rider.position.set(0, 13.5, -1);
    const head = this.mesh(new THREE.SphereGeometry(1.6, 10, 8), this.mat(look.skin));
    head.position.set(0, 17.6, -1);
    group.add(rider, head);
    return { group, parts: { horse } };
  }

  // O Batedor: a barded horse, a rider in armor of its level (look.tunic), the lance raised with the
  // ChatJurídico pennant, and the shield with the Slack mark, both painted from the same pixels as the
  // 2D ones. With the models loaded, the horse and the KayKit knight (tabard and cape aubergine), else
  // blocks.
  buildKnight(look) {
    const rider = villagerModel(look, { character: 'knight', hat: true, paint: { team: S.SLACK.aubergine, armor: look.tunic, skin: look.skin, hair: look.hair } });
    const mount = this.buildMount(look, rider);
    if (!mount) return this.buildBlockKnight(look);
    const { group, parts } = mount;
    const { horse } = MODEL_SCALE;
    const bone = (root, name) => root.getObjectByName(name);
    const torso = bone(parts.model.root, 'Torso');
    for (const { w, h, d, color } of BARDING) torso.attach(this.box(w * horse, h * horse, d * horse, color, 0, BARDING_AT.y * horse, BARDING_AT.z * horse));
    // lance, shield and plume ride the rider's bones, set where its idle holds them
    playClip(parts.rider, 'Idle', 0, 0);
    const at = (name) => bone(parts.rider.root, name).getWorldPosition(new THREE.Vector3());
    const lance = this.mesh(new THREE.CylinderGeometry(0.3, 0.3, 29, 6), this.mat('#8a5a32'));
    lance.position.copy(at('handslotr')).add(new THREE.Vector3(-1.2, 6.5, 0.4)); // upright at its right side, clear of the face, the pennant over the helmet
    lance.rotation.x = 0.15;
    parts.pennant = new THREE.Group(); // the flag streams back from the lance's tip
    parts.pennant.position.y = 11.9;
    const pennant = this.mesh(new THREE.PlaneGeometry(4.2, 4.8), new THREE.MeshBasicMaterial({ map: this.knightTexture('pennant'), transparent: true, alphaTest: 0.5, side: THREE.DoubleSide }), { cast: false });
    pennant.position.x = 2.1;
    parts.pennant.add(pennant);
    lance.add(parts.pennant);
    bone(parts.rider.root, 'handslotr').attach(lance);
    const shield = this.mesh(new THREE.PlaneGeometry(4.2, 5.4), new THREE.MeshBasicMaterial({ map: this.knightTexture('shield'), transparent: true, alphaTest: 0.5, side: THREE.DoubleSide }), { cast: false });
    shield.position.copy(at('handslotl')).add(new THREE.Vector3(1.2, 2.4, 0));
    shield.rotation.y = Math.PI / 2; // facing out, the mark the right way round
    bone(parts.rider.root, 'lowerarml').attach(shield);
    parts.plume = this.mesh(new THREE.ConeGeometry(0.14, 0.55, 6), this.mat(S.SLACK.red));
    parts.plume.position.set(0, 1.25, -0.06); // on the helmet's crest, in the head bone's units
    bone(parts.rider.root, 'head').add(parts.plume);
    this.addKnightAura(group, parts);
    return { group, parts };
  }

  // The mission scroll over its head and the aura on the ground, whichever body it has.
  addKnightAura(group, parts) {
    parts.scroll = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.knightTexture('scroll'), depthTest: false, transparent: true }));
    parts.scroll.scale.set(7, 5, 1);
    parts.scroll.renderOrder = 10;
    // The aura, always on: a soft gold light on the ground and a ring around the horse.
    parts.aura = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshBasicMaterial({ map: this.knightTexture('aura'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    parts.aura.rotation.x = -Math.PI / 2;
    parts.aura.position.y = 0.4;
    parts.auraRing = new THREE.Mesh(new THREE.RingGeometry(9.4, 10.4, 48), new THREE.MeshBasicMaterial({ color: S.SLACK.yellow, transparent: true, depthWrite: false }));
    parts.auraRing.rotation.x = -Math.PI / 2;
    parts.auraRing.position.y = 0.5;
    group.add(parts.scroll, parts.aura, parts.auraRing);
  }

  buildBlockKnight(look) {
    const group = new THREE.Group();
    const parts = {};
    const [coat, shade] = look.horse;
    const metal = this.mat(look.tunic, { metalness: 0.55, roughness: 0.4 });
    const horse = new THREE.Group();
    horse.add(this.box(5, 6, 15, coat, 0, 6, 0), this.box(3.6, 7, 3.6, coat, 0, 10, 7.5), this.box(3, 3, 6, shade, 0, 15, 10));
    horse.add(this.box(5.6, 5, 12.6, S.SLACK.aubergine, 0, 5.4, -0.6), this.box(5.8, 0.8, 12.8, S.SLACK.yellow, 0, 5, -0.6));
    parts.legs = [[-1.7, -5.5], [1.7, -5.5], [-1.7, 5.5], [1.7, 5.5]].map(([lx, lz]) => this.box(1.4, 6, 1.4, shade, lx, 0, lz));
    horse.add(...parts.legs);
    const body = this.mesh(new THREE.CapsuleGeometry(2.1, 3.4, 4, 10), metal);
    body.position.set(0, 16.4, -1);
    const tabard = this.box(4.4, 4, 4.4, S.SLACK.aubergine, 0, 13.6, -1);
    const helm = this.mesh(new THREE.CylinderGeometry(1.8, 1.9, 3.6, 10), metal);
    helm.position.set(0, 21.4, -1);
    parts.plume = this.mesh(new THREE.ConeGeometry(0.9, 3.5, 6), this.mat(S.SLACK.red));
    parts.plume.position.set(0, 24.8, -1.4);
    const lance = this.mesh(new THREE.CylinderGeometry(0.3, 0.3, 24, 6), this.mat('#8a5a32'));
    lance.position.set(2.8, 22, 2);
    lance.rotation.x = 0.35;
    const flat = (map, w, h) => this.mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide }), { cast: false });
    parts.pennant = flat(this.knightTexture('pennant'), 4.2, 4.8);
    parts.pennant.position.set(2.8, 30.2, 4);
    const shield = flat(this.knightTexture('shield'), 4.2, 5.4);
    shield.position.set(-2.7, 14.5, 0);
    shield.rotation.y = -Math.PI / 2;
    group.add(horse, body, tabard, helm, parts.plume, lance, parts.pennant, shield);
    this.addKnightAura(group, parts);
    return { group, parts };
  }

  // Shield, pennant and scroll drawn once from the 2D sprites, kept sharp (no smoothing, no mipmaps).
  knightTexture(name) {
    this.knightTextures ??= new Map();
    if (!this.knightTextures.has(name)) {
      const size = { shield: [7, 9], pennant: [14, 16], scroll: [10, 8], aura: [8, 8] }[name];
      const canvas = document.createElement('canvas');
      [canvas.width, canvas.height] = size.map((side) => side * 8);
      const ctx = canvas.getContext('2d');
      ctx.scale(8, 8);
      if (name === 'aura') S.drawGlow(ctx, 4, 4, 4, S.SLACK.yellow, 0.9);
      else if (name === 'shield') S.drawSlackShield(ctx, 0, 0);
      else if (name === 'scroll') S.drawMissionScroll(ctx, 5, 8);
      else S.drawChatJuridicoFlag(ctx, 0, 0, { isFine: true });
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const filter = name === 'aura' ? THREE.LinearFilter : THREE.NearestFilter; // the glow stays soft, the pixels sharp
      texture.magFilter = filter;
      texture.minFilter = filter;
      texture.generateMipmaps = false;
      this.knightTextures.set(name, texture);
    }
    return this.knightTextures.get(name);
  }

  poseKnight({ parts }, ch, t, isWalking) {
    parts.legs?.forEach((leg, index) => {
      leg.rotation.x = isWalking ? Math.sin(ch.walkClock * 14 + (index === 0 || index === 3 ? 0 : Math.PI)) * 0.45 : 0;
    });
    parts.pennant.rotation.y = Math.PI / 2 + Math.sin(t * (isWalking ? 12 : 6)) * 0.3;
    parts.plume.rotation.x = Math.sin(t * 5) * 0.15;
    parts.scroll.visible = this.empire.scout.missions.size > 0;
    parts.scroll.position.y = (parts.rider ? 35 : 30) + Math.sin(t * 3) * 0.6; // over the helmet's plume
    const pulse = 0.5 + 0.5 * Math.sin(t * 3);
    parts.aura.material.opacity = 0.35 + 0.25 * pulse;
    parts.auraRing.material.opacity = 0.45 + 0.35 * pulse;
    parts.auraRing.scale.setScalar(1 + 0.04 * pulse);
  }

  buildSoldier(look) {
    const group = new THREE.Group();
    const body = this.mesh(new THREE.CapsuleGeometry(1.5, 2.6, 4, 8), this.mat('#5a6b3b'));
    body.position.y = 4.6;
    const head = this.mesh(new THREE.SphereGeometry(1.4, 10, 8), this.mat('#7a8c4e', { metalness: 0.4 }));
    head.position.y = 8;
    const spear = this.mesh(new THREE.CylinderGeometry(0.25, 0.25, 13, 5), this.mat('#8a5a32'));
    spear.position.set(2, 6.5, 0);
    const pennant = this.mesh(new THREE.PlaneGeometry(2.6, 1.6), this.mat(look.tunic, { side: THREE.DoubleSide }), { cast: false });
    pennant.position.set(3.3, 12, 0);
    group.add(body, head, spear, pennant);
    return { group, parts: { pennant } };
  }

  // One texture per bubble, and per spinner frame for 'thinking' (swapped as the 2D one animates).
  emoteTexture(kind, frame = 0) {
    const key = `${kind}:${frame}`;
    if (!this.emoteTextures.has(key)) {
      const canvas = document.createElement('canvas');
      canvas.width = 48;
      canvas.height = 48;
      const ctx = canvas.getContext('2d');
      ctx.scale(4, 4);
      S.drawEmote(ctx, 6, 11, kind, 0, frame);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      this.emoteTextures.set(key, texture);
    }
    return this.emoteTextures.get(key);
  }

  feelingTexture(kind, frame) {
    const key = `feeling:${kind}:${frame}`;
    if (!this.emoteTextures.has(key)) {
      const canvas = document.createElement('canvas');
      canvas.width = FEELING_CANVAS * 4;
      canvas.height = FEELING_CANVAS * 4;
      const ctx = canvas.getContext('2d');
      ctx.scale(4, 4);
      S.drawFeelingFrame(ctx, FEELING_CANVAS / 2, FEELING_CANVAS - 1, kind, frame);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      this.emoteTextures.set(key, texture);
    }
    return this.emoteTextures.get(key);
  }

  syncUnits(now, t) {
    const e = this.empire;
    const seen = new Set();
    const highlightId = e.highlight && now <= e.highlight.until ? e.highlight.id : null;
    for (const ch of e.chars.values()) {
      seen.add(ch.id);
      let entry = this.units.get(ch.id);
      if (entry && entry.tunic !== ch.look.tunic) {
        this.dropUnit(entry); // the team color changed: dress it again
        this.units.delete(ch.id);
        entry = null;
      }
      if (!entry) {
        entry = ch.isKnight ? this.buildKnight(ch.look) : ch.isObserver ? this.buildScout(ch.look) : this.buildVillager(ch.look);
        entry.last = { x: ch.x, y: ch.y };
        entry.tunic = ch.look.tunic;
        entry.group.userData.hit = { id: ch.id };
        this.units.set(ch.id, entry);
        this.scene.add(entry.group);
      }
      const { group, parts } = entry;
      group.visible = now >= ch.hiddenUntil;
      const { held } = ch;
      const lift = held?.lift ?? 0;
      const isDangling = lift > 0;
      const isWalking = !held && ch.path.length > 0;
      const dx = ch.x - entry.last.x;
      const dy = ch.y - entry.last.y;
      if (held) group.rotation.y = this.cam.yaw; // facing whoever holds it
      else if (Math.hypot(dx, dy) > 0.05) group.rotation.y = Math.atan2(dx, dy);
      else if (!isWalking && ch.mode === 'working') group.rotation.y = { n: Math.PI, s: 0, e: Math.PI / 2, w: -Math.PI / 2 }[ch.dir] ?? 0;
      entry.last = { x: ch.x, y: ch.y };
      const bob = isWalking && !parts.model ? Math.abs(Math.sin(ch.walkClock * 11)) * 0.9 : 0; // the model's walk bobs on its own
      const hop = ch.feeling ? S.feelingHop(ch.feeling, now - ch.feelingAt) * 0.8 : 0; // jumps with its emote
      group.position.set(ch.x, bob + hop + lift, ch.y);
      // Held, it swings across the screen from the hand at its head, so the head stays under the pointer.
      const tilt = -(held?.swing ?? 0);
      group.rotation.z = tilt;
      if (tilt) {
        const sway = HOLD_GRIP * Math.sin(tilt);
        group.position.x += sway * Math.cos(group.rotation.y);
        group.position.z -= sway * Math.sin(group.rotation.y);
        group.position.y += HOLD_GRIP * (1 - Math.cos(tilt));
      }
      if (entry.isOnTop !== isDangling) {
        entry.isOnTop = isDangling;
        group.traverse((node) => {
          // balloons already draw over everything; drawn twice their edges would darken
          if (!node.isSprite) node.layers[isDangling ? 'enable' : 'disable'](HELD_LAYER);
        });
      }
      this.hasHeldOnTop ||= isDangling;
      if (parts.rider) this.poseMount(entry, ch, t, { isWalking, isDangling });
      if (ch.isKnight) this.poseKnight(entry, ch, t, isWalking);
      if (ch.isObserver) continue;
      const { agent } = ch;
      const isSitting = !held && !isWalking && ch.mode === 'poi' && ch.poi?.pose === 'sit';
      const isWaiting = !ch.isRecruit && ch.goal?.type !== 'exit' && (agent.status !== 'busy' || agent.activity.kind === 'asking');
      const isBlocked = agent.status === 'busy' && agent.activity.kind === 'asking';
      const pose = { isWalking, isSitting, isWaiting, isBlocked, isDangling };
      if (parts.model) this.poseModel(entry, ch, t, pose);
      else this.poseVillager(entry, ch, t, pose);
      const isLinked = ch.id === e.linkedId;
      const isPicked = e.selected.has(ch.id);
      parts.ring.visible = !held && (isPicked || isLinked || isWaiting); // held up, the ring would float
      parts.ring.material.color.set(isLinked ? LINK_COLOR : isPicked ? '#ffffff' : kindInfo(isBlocked ? 'asking' : 'yourturn').color);
      parts.ring.material.opacity = isPicked || isLinked ? 0.95 : 0.55 + 0.35 * Math.sin(t * 5);
      const emoteKind = agent.status === 'busy' ? agent.activity.kind : 'yourturn';
      const emote = this.emoteTexture(emoteKind, emoteKind === 'thinking' ? S.spinnerFrame(t) : 0);
      if (parts.emote.material.map !== emote) {
        parts.emote.material.map = emote;
        parts.emote.material.needsUpdate = true;
      }
      const feelingAge = now - ch.feelingAt;
      const isFeeling = !ch.isRecruit && Boolean(ch.feeling) && feelingAge < S.feelingMs(ch.feeling);
      parts.feeling.visible = isFeeling;
      if (isFeeling) {
        const texture = this.feelingTexture(ch.feeling, S.feelingFrame(ch.feeling, feelingAge));
        if (parts.feeling.material.map !== texture) {
          parts.feeling.material.map = texture;
          parts.feeling.material.needsUpdate = true;
        }
        const size = FEELING_SIZE * S.feelingPop(ch.feeling, feelingAge);
        parts.feeling.scale.set(size, size, 1);
        parts.feeling.position.set(3.5, isSitting ? 14 : 16, 0);
      }
      parts.emote.visible = !ch.isRecruit && !isFeeling; // a recruit has nothing to do yet; one balloon at a time
      parts.emote.position.y = isSitting ? 17 : 19;
      parts.conflict.visible = e.conflicts.has(ch.id);
      parts.arrow.visible = isLinked || ch.id === highlightId;
      parts.arrow.position.y = 24 + Math.sin(t * 6) * 1.2;
    }
    for (const [id, entry] of this.units) {
      if (seen.has(id)) continue;
      this.dropUnit(entry);
      this.units.delete(id);
    }
    // subagents march beside their villager, as in 2D
    const liveBots = new Set();
    for (const bot of e.bots.values()) {
      const parent = e.chars.get(bot.parentId);
      if (!parent || parent.isObserver || now < parent.hiddenUntil) continue;
      liveBots.add(bot.id);
      let entry = this.bots.get(bot.id);
      if (!entry) {
        entry = this.buildSoldier(parent.look);
        entry.group.userData.hit = { id: parent.id, botId: bot.id };
        this.bots.set(bot.id, entry);
        this.scene.add(entry.group);
      }
      const [sx, sy] = ESCORT[bot.slot % ESCORT.length];
      const spread = Math.floor(bot.slot / ESCORT.length) * 4;
      entry.group.position.set(parent.x + sx + Math.sign(sx) * spread, bot.goneAt === null ? 0 : -((now - bot.goneAt) / 1200) * 12, parent.y + sy + spread);
      const kind = bot.goneAt === null ? bot.sub.activity.kind : 'done';
      entry.parts.pennant.material = this.mat(kindInfo(kind).color, { side: THREE.DoubleSide });
    }
    for (const [id, entry] of this.bots) {
      if (liveBots.has(id)) continue;
      this.scene.remove(entry.group);
      this.bots.delete(id);
    }
  }

  // Arms, torso and tool for what the villager is doing now: the 3D take on the 2D sprite poses.
  poseVillager(entry, ch, t, { isWalking, isSitting, isWaiting, isBlocked, isDangling }) {
    const { parts } = entry;
    const [free, hand] = parts.arms;
    parts.legs.forEach((leg, i) => {
      leg.rotation.x = isDangling ? Math.sin(t * 16 + i * Math.PI) * 0.7 : isWalking ? Math.sin(ch.walkClock * 11 + i * Math.PI) * 0.6 : 0;
      leg.visible = !isSitting;
    });
    parts.torso.position.y = isSitting ? 2 : 4;
    for (const node of [free, hand, parts.torso, parts.head]) node.rotation.set(0, 0, 0);
    for (const tool of Object.values(parts.tools)) tool.visible = false;
    parts.chips.visible = false;
    parts.torso.scale.y = 1;
    if (isDangling) {
      // picked up by the head: both arms flail, out of step
      hand.rotation.set(-0.3, 0, 2.2 + 0.4 * Math.sin(t * 15));
      free.rotation.set(-0.3, 0, -2.2 - 0.4 * Math.sin(t * 15 + Math.PI));
      return;
    }
    if (ch.held) {
      parts.torso.scale.y = 1 + 0.04 * Math.sin(t * 12); // just put down: catching its breath
      return;
    }
    if (isWalking) {
      const swing = Math.sin(ch.walkClock * 11) * 0.5; // against the legs
      free.rotation.x = swing;
      hand.rotation.x = -swing;
      return;
    }
    if (isSitting) free.rotation.x = hand.rotation.x = -0.7; // hands on the knees
    if (isWaiting) {
      if (!isWaving(t, ch.look.seed, isBlocked)) return;
      // arm raised out to the side, clear of the head and hat from the camera above; both arms when blocked
      const wave = 2.1 + 0.35 * Math.sin(t * 14);
      hand.rotation.set(-0.3, 0, wave);
      if (isBlocked) free.rotation.set(-0.3, 0, -wave);
      return;
    }
    const kind = ch.agent.status === 'busy' ? ch.agent.activity.kind : null;
    const phase = t + (ch.look.seed % 1000) / 97; // neighbours never move in step
    const isAtWork = kind && ch.mode === 'working';
    if (isAtWork && WORK_3D[ch.node]) {
      this.swingTool(entry, WORK_3D[ch.node], phase);
    } else if (isAtWork && ch.node === 'tower') {
      parts.tools.spyglass.visible = true;
      hand.rotation.set(-2.3, 0, -0.3);
      free.rotation.x = -0.3;
      parts.torso.rotation.y = 0.55 * Math.sin(phase * 0.7); // sweeping the horizon
    } else if (kind && ch.node === 'tc') {
      this.poseAtTownCenter(parts, kind, phase);
    } else {
      parts.torso.scale.y = 1 + 0.015 * Math.sin(phase * 2); // breathing
    }
  }

  // The model's take on poseVillager: a clip per pose, at a moment set by the map's clocks.
  poseModel(entry, ch, t, { isWalking, isSitting, isWaiting, isBlocked, isDangling }) {
    const { parts } = entry;
    const { model, tools } = parts;
    for (const tool of Object.values(tools)) tool.visible = false;
    parts.chips.visible = false;
    model.root.rotation.y = 0;
    for (const [bone, quaternion] of model.undo) bone.quaternion.copy(quaternion); // last frame's wave off
    model.undo.length = 0;
    const dt = Math.min(0.1, t - (entry.clock ?? t));
    entry.clock = t;
    const phase = t + (ch.look.seed % 1000) / 97; // neighbours never move in step
    const play = (name, at = phase / model.clips[name].duration) => playClip(model, name, at, dt);
    if (isDangling) return play('Running_A', t * 2.5); // pedalling in the air
    if (ch.held) return play('Idle');
    if (isWalking) return play('Walking_A', (ch.walkClock * 11) / (2 * Math.PI)); // in step with the 2D walk
    if (isSitting) play('Sit_Chair_Idle');
    else if (isWaiting) play('Idle');
    if (isWaiting && isWaving(t, ch.look.seed, isBlocked)) {
      // one arm waves, both when blocked, seated by the campfire too
      const lift = 0.9 + 0.45 * Math.sin(t * 14);
      raiseArm(model, 'r', lift);
      if (isBlocked) raiseArm(model, 'l', lift);
    }
    if (isSitting || isWaiting) return;
    const kind = ch.agent.status === 'busy' ? ch.agent.activity.kind : null;
    const isAtWork = kind && ch.mode === 'working';
    const work = isAtWork && WORK_3D[ch.node];
    if (work) {
      const { clip, strikeAt } = WORK_CLIPS[work.tool];
      const cycle = phase / work.period;
      tools[work.tool].visible = true;
      play(clip, cycle);
      return this.throwChips(entry, work, cycle, strikeAt, tools[work.tool]);
    }
    if (isAtWork && ch.node === 'tower') {
      tools.spyglass.visible = true;
      model.root.rotation.y = 0.55 * Math.sin(phase * 0.7); // sweeping the horizon
      return play('Use_Item', HAND_AT_FACE);
    }
    if (kind && ch.node === 'tc' && (kind === 'writing' || kind === 'planning')) {
      tools.scroll.visible = true;
      return play('2H_Ranged_Aiming');
    }
    if (kind && ch.node === 'tc' && kind === 'thinking') return play('Use_Item', HAND_AT_FACE); // hand on the chin
    if (kind && ch.node === 'tc' && kind === 'delegating') {
      model.root.rotation.y = 0.4 * Math.sin(phase * 0.9);
      return play('1H_Ranged_Aiming'); // pointing the escort out
    }
    play('Idle');
  }

  // At the town center: reading or writing over a scroll, hand on the chin, or pointing the escort out.
  poseAtTownCenter(parts, kind, phase) {
    const [free, hand] = parts.arms;
    if (kind === 'writing' || kind === 'planning') {
      parts.tools.scroll.visible = true;
      free.rotation.set(-1.35, 0, 0.3);
      hand.rotation.set(-1.35 + (kind === 'writing' ? 0.12 * Math.sin(phase * 14) : 0), 0, -0.3);
      parts.head.rotation.x = 0.3 + 0.05 * Math.sin(phase * 3);
      if (kind === 'planning') parts.head.rotation.y = 0.25 * Math.sin(phase * 1.3);
    } else if (kind === 'thinking') {
      hand.rotation.set(-2, 0, -0.5);
      free.rotation.set(-0.9, 0, 0.6);
      parts.head.rotation.z = 0.15 * Math.sin(phase * 1.1);
    } else if (kind === 'delegating') {
      hand.rotation.x = -1.75 + 0.12 * Math.sin(phase * 6);
      parts.torso.rotation.y = 0.4 * Math.sin(phase * 0.9);
    } else {
      parts.torso.scale.y = 1 + 0.015 * Math.sin(phase * 2);
    }
  }

  // The tool rises, comes down hard and rests on the blow while chips fly off where it landed.
  swingTool(entry, work, phase) {
    const { parts } = entry;
    const [free, hand] = parts.arms;
    const cycle = phase / work.period;
    const u = cycle - Math.floor(cycle);
    const lift = u < 0.6 ? smoothstep(0, 0.6, u) : u < STRIKE_AT ? 1 - ((u - 0.6) / (STRIKE_AT - 0.6)) ** 2 : 0;
    hand.rotation.x = work.strike + (work.raised - work.strike) * lift;
    free.rotation.x = hand.rotation.x * 0.5;
    parts.torso.rotation.x = work.lean * (1 - lift) - 0.08 * lift;
    const tool = parts.tools[work.tool];
    tool.visible = true;
    this.throwChips(entry, work, cycle, STRIKE_AT, tool);
  }

  // Chips fly off where the tool lands, from the blow (`strikeAt` into each swing) on.
  throwChips(entry, work, cycle, strikeAt, tool) {
    const { group, parts } = entry;
    const burst = Math.floor(cycle - strikeAt);
    const age = (cycle - strikeAt - burst) / CHIP_LIFE;
    if (age >= 1) return;
    if (entry.burst !== burst) {
      if (cycle - Math.floor(cycle) < strikeAt) return; // came in mid-swing: wait for a blow of its own
      entry.burst = burst;
      group.updateMatrixWorld(true);
      group.worldToLocal(tool.userData.tip.getWorldPosition(parts.chips.position));
      parts.chipMaterial.color.set(work.chips);
    }
    parts.chips.visible = true;
    parts.chipMaterial.opacity = 1 - age;
    for (const chip of parts.chips.children) {
      const [dx, up, dz] = chip.userData.dir;
      chip.position.set(dx * age * work.spread, (up - 1.4 * age) * age * work.spread, dz * age * work.spread);
    }
  }

  // ---------- Foundations and the base being dragged ----------

  buildGhosts() {
    const L = this.L;
    // A dashed outline w × h and a see-through slab where the town center (or the square's paving) goes.
    const foundation = { x: L.TOWN_CENTER.x, y: L.TOWN_CENTER.y + 8, w: L.TOWN_CENTER.w, h: L.TOWN_CENTER.h - 8 };
    const make = (color, opacity, w = L.PLOT_W, h = L.PLOT_H, area = foundation) => {
      const group = new THREE.Group();
      const line = this.outline(w, h, 0.8, new THREE.LineDashedMaterial({ color, dashSize: 4, gapSize: 3, transparent: true, opacity }));
      const slab = new THREE.Mesh(new THREE.BoxGeometry(area.w, 2, area.h), new THREE.MeshStandardMaterial({ color, transparent: true, opacity: opacity * 0.6 }));
      slab.position.set(area.x + area.w / 2, 1, area.y + area.h / 2);
      group.add(line, slab);
      group.visible = false;
      this.scene.add(group);
      return { group, line, slab, w, h, area };
    };
    const resize = make('#ffffff', 0.9);
    resize.slab.visible = false;
    return { hover: make('#ffffff', 0.7), drag: make('#ffffff', 0.9), resize, square: make('#ffffff', 0.9, L.SQUARE_W, L.SQUARE_H, L.PAVING), reserved: [] };
  }

  // A ghost's outline follows the land it stands for.
  sizeGhost(ghost, w, h) {
    if (ghost.w === w && ghost.h === h) return;
    const line = this.outline(w, h, 0.8, ghost.line.material);
    ghost.line.geometry.dispose();
    ghost.line.geometry = line.geometry;
    Object.assign(ghost, { w, h });
  }

  syncGhosts() {
    const e = this.empire;
    const { hover, drag } = this.ghost;
    hover.group.visible = Boolean(e.landHover) && !e.drag?.isDragging;
    if (hover.group.visible) hover.group.position.set(e.landHover.x, 0, e.landHover.y);
    const target = e.drag?.isDragging && e.drag.kind === 'base' ? e.drag.target : null;
    const base = target && e.bases.get(e.drag.project);
    // the base being moved, or the one picked in the build menu following the pointer
    const pos = e.placing?.spot ?? (target?.swap ? e.bases.get(target.swap)?.pos : target?.pos);
    drag.group.visible = Boolean(pos && (base || e.placing));
    if (drag.group.visible) {
      const color = e.placing ? S.teamColor(e.placing.project) : target.isValid === false ? '#ef4444' : base.team[0];
      drag.line.material.color.set(color);
      drag.slab.material.color.set(color);
      // a grown base moves whole: its land, and the town center where its core stands on it
      const { w, h } = e.placing ? { w: this.L.PLOT_W, h: this.L.PLOT_H } : base.size;
      const coreX = e.placing ? 0 : base.coreX;
      const { tc, h: coreH } = e.layoutOf(e.placing ? null : base);
      this.sizeGhost(drag, w, h);
      drag.slab.position.set(coreX + tc.x + tc.w / 2, 1, h - coreH + tc.y + 8 + (tc.h - 8) / 2);
      drag.group.position.set(pos.x, 0, pos.y);
    }
    // land being resized: red where it would not fit; an edge under the pointer lights the land up
    const resize = this.ghost.resize;
    const resizing = e.drag?.isDragging && e.drag.kind === 'resize' ? e.drag.target : null;
    const hovered = !e.drag?.isDragging && e.edgeHover && e.bases.get(e.edgeHover.project);
    const land = resizing && !resizing.isValid ? resizing.rect : hovered ? e.plotRect(hovered) : null;
    resize.group.visible = Boolean(land);
    if (land) {
      this.sizeGhost(resize, land.w, land.h);
      resize.line.material.color.set(resizing ? '#ef4444' : '#ffffff');
      resize.group.position.set(land.x, 0, land.y);
    }
    // the square being moved: white where it fits, red where it does not
    const square = this.ghost.square;
    const squareTarget = e.drag?.isDragging && e.drag.kind === 'square' ? e.drag.target : null;
    square.group.visible = Boolean(squareTarget);
    if (squareTarget) {
      const color = squareTarget.isValid ? '#ffffff' : '#ef4444';
      square.line.material.color.set(color);
      square.slab.material.color.set(color);
      square.group.position.set(squareTarget.pos.x, 0, squareTarget.pos.y);
    }
    // land staked for a deploy: its foundation in the team color
    const reserved = [...e.reservations.entries()];
    while (this.ghost.reserved.length < reserved.length) {
      const L = this.L;
      const slab = new THREE.Mesh(new THREE.BoxGeometry(L.TOWN_CENTER.w, 2, L.TOWN_CENTER.h - 8), new THREE.MeshStandardMaterial({ color: '#a59a86' }));
      this.scene.add(slab);
      this.ghost.reserved.push(slab);
    }
    this.ghost.reserved.forEach((slab, i) => {
      const entry = reserved[i];
      slab.visible = Boolean(entry);
      if (!entry) return;
      const [project, reservation] = entry;
      slab.material.color.set(S.teamColor(project));
      slab.position.set(reservation.pos.x + this.L.TOWN_CENTER.x + this.L.TOWN_CENTER.w / 2, 1, reservation.pos.y + this.L.TOWN_CENTER.y + this.L.TOWN_CENTER.h / 2 + 4);
    });
  }

  // ---------- Frame ----------

  // Daylight follows the map's clock: warm sun by day, blue moonlight and lit windows at night.
  applySky(sky) {
    const dark = Math.min(1, sky.darkness * 1.6);
    this.sun.intensity = 2.6 * (1 - dark) + 0.25;
    this.sun.color.set(dark > 0.5 ? '#9fb2ff' : '#ffe2b0');
    this.hemi.intensity = 1.1 * (1 - dark * 0.7);
    this.fireLight.intensity = (sky.isNight ? 1400 : 250) * (0.85 + 0.15 * Math.sin(performance.now() / 90));
  }

  render(now, sky) {
    if (!this.isActive || !this.empire.nav) return;
    const t = now / 1000;
    this.rebuildStatic();
    if (this.yawTween) {
      const k = Math.min(1, (now - this.yawTween.start) / ROTATE_MS);
      const ease = k * k * (3 - 2 * k);
      this.cam.yaw = this.yawTween.from + (this.yawTween.to - this.yawTween.from) * ease;
      if (k === 1) this.yawTween = null;
      this.updateCamera();
    }
    this.applySky(sky);
    this.flame.scale.set(1 + 0.12 * Math.sin(t * 17), 1 + 0.2 * Math.sin(t * 13), 1);
    if (this.grassWind) this.grassWind.value = t;
    if (this.water && !this.isSimple) this.water.map.offset.x = -t * RIVER.flow;
    this.syncBases(now, t, sky);
    this.hasHeldOnTop = false;
    this.syncUnits(now, t);
    this.syncGhosts();
    this.pickables = [...[...this.bases.values()].flatMap(({ group }) => group.children.filter((c) => c.userData.hit)), ...[...this.units.values()].map((u) => u.group), ...[...this.bots.values()].map((b) => b.group), this.squareGroup];
    this.renderer.render(this.scene, this.camera);
    if (this.hasHeldOnTop) this.renderHeldOnTop();
  }

  // The villager in the hand, once more over the finished frame: only its layer, depth cleared, with
  // the shadows already cast this frame. A color background would clear the frame even with autoClear
  // off, so it steps aside.
  renderHeldOnTop() {
    const { renderer, camera, scene } = this;
    const { background } = scene;
    scene.background = null;
    renderer.autoClear = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.clearDepth();
    camera.layers.set(HELD_LAYER);
    renderer.render(scene, camera);
    camera.layers.set(0);
    renderer.shadowMap.autoUpdate = true;
    renderer.autoClear = true;
    scene.background = background;
  }
}
