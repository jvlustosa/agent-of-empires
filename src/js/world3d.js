// The map in 3D, Age of Empires III style: a sunlit, shadowed diorama of the same world the 2D map
// simulates. The Empire keeps running everything (paths, bases, villagers, orders); this only draws
// it, moves the camera, and turns clicks on the scene back into world coordinates.
// World (x, y) maps to three.js (x, z), y up; one world pixel is one unit.
import * as THREE from '../vendor/three/three.module.min.js';
import * as S from './sprites.js';
import { kindInfo } from './kinds.js';

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
const GROUND_RES = 4; // texture pixels per world unit
// Grass tones (sRGB): the floor under the woods, deep and light meadow, and sun-dried patches.
const GRASS = { forest: [40, 70, 30], deep: [58, 100, 38], light: [116, 152, 62], dry: [156, 156, 82] };
const TONE_CELL = 6; // world units per sample of the broad grass tones, scaled up smooth
const EARTH_CELL = 3; // the same for the patches of bare earth, finer so their edges stay ragged
const BLADE_TILE = 40; // world units of the repeating pattern of painted blades
const TUFT_SPACING = 7; // about one 3D tuft of grass per this many world units, on open land
const ROTATE_MS = 320;
const LINK_COLOR = '#facc15';
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
};
// The castle's size (Pequeno › Colossal): Grande and Colossal raise curtain walls with corner
// towers behind the town center, as the castles of Age of Empires; Colossal adds a keep on the back wall.
const SIZE_3D = [
  { scale: 0.8, wall: 0, tower: 0, keep: 0 },
  { scale: 1, wall: 0, tower: 0, keep: 0 },
  { scale: 1.12, wall: 7, tower: 13, keep: 0 },
  { scale: 1.22, wall: 10, tower: 18, keep: 40 },
];
// Behind the town center (base-local), clear of the mine, the forge and the yard's work spots.
const WALL_BOX = { x0: 34, x1: 94, z0: 6, z1: 30 };
const WALL_THICK = 3;
const MERLON_STEP = 4;
const ESCORT = [[-10, 2], [10, 2], [-15, -3], [15, -3], [-6, 7], [6, 7]];
// The 2D work fronts in 3D: the tool, one swing in seconds, the shoulder angles (0 hangs, -π points
// straight up), how far the body leans into the blow and what flies off where it lands.
const WORK_3D = {
  mine: { tool: 'pickaxe', period: 0.8, raised: -3.3, strike: -1, lean: 0.25, chips: '#facc15', spread: 4 },
  forge: { tool: 'hammer', period: 0.5, raised: -2.7, strike: -1.25, lean: 0.12, chips: '#ffb547', spread: 6 },
  build: { tool: 'hammer', period: 0.65, raised: -2.9, strike: -1.6, lean: 0.1, chips: '#d8c7a2', spread: 3 },
};
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

// Waiting villagers wave for ~1.2 s every 6 s (every 2.5 s when blocked), staggered by seed, as in 2D.
function isWaving(t, seed, isUrgent) {
  return (t + (seed % 6)) % (isUrgent ? 2.5 : 6) < 1.2;
}

export class World3D {
  constructor(container, empire, layout) {
    this.empire = empire;
    this.L = layout;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'world-3d';
    container.insertBefore(this.canvas, container.querySelector('.world-overlay'));
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
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

  // A gabled roof: a triangular prism, ridge along x.
  gable(w, h, d, color) {
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

  groundAtLocal(sx, sy) {
    const ndc = new THREE.Vector2((sx / this.width) * 2 - 1, 1 - (sy / this.height) * 2);
    this.raycaster.setFromCamera(ndc, this.camera);
    const point = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.groundPlane, point) ? { x: point.x, y: point.z } : null;
  }

  groundAtClient(clientX, clientY) {
    const box = this.canvas.getBoundingClientRect();
    return this.groundAtLocal(clientX - box.left, clientY - box.top);
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
    this.staticGroup.add(this.buildGrass(w, h));
    this.staticGroup.add(this.buildWoods(w, h));
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
    // trodden yards of each base: soft-edged earth
    for (const base of e.bases.values()) {
      const { x, y } = base.pos;
      const patches = [...L.BASE_GROUND.patches, [6, L.BASE_GROUND.yardY - 4, L.PLOT_W - 12, 9], [L.BASE_GROUND.gate.x - 4, L.BASE_GROUND.yardY, 8, L.PLOT_H - L.BASE_GROUND.yardY]];
      for (const [grow, alpha] of [[4, 0.1], [2.5, 0.14], [1, 0.2], [0, 0.32]]) {
        ctx.fillStyle = `rgba(150, 126, 82, ${alpha})`;
        for (const [px, py, pw, ph] of patches) roundRect(x + px - grow, y + py - grow, pw + 2 * grow, ph + 2 * grow, 4 + grow);
      }
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
    ctx.fillStyle = '#9c927c';
    ctx.fillRect(sq.x + 6, sq.y + 6, L.SQUARE_W - 12, 58);
    for (let py = sq.y + 6; py < sq.y + 64; py += 4) {
      for (let px = sq.x + 6 + ((py / 4) % 2) * 3; px < sq.x + L.SQUARE_W - 6; px += 6) {
        ctx.fillStyle = random() < 0.5 ? '#aaa08a' : '#8d8370';
        ctx.fillRect(px + 0.4, py + 0.4, 5.2, 3.2);
      }
    }
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
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const z = position.getZ(i);
      const outside = Math.max(L.MAP_X0 - x, x - (w - 4), L.MAP_Y0 - z, z - (h - 4), 0);
      const hills = 6 * Math.sin(x * 0.031) * Math.cos(z * 0.027) + 4 * Math.sin((x + z) * 0.017) + 7;
      position.setY(i, smoothstep(0, 60, outside) * hills * 2.2);
    }
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
    const blocked = [...e.bases.values()].map(({ pos }) => ({ x: pos.x, y: pos.y, w: L.PLOT_W, h: L.PLOT_H }));
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
    for (let i = 0; i < 520; i++) {
      const x = -MARGIN + random() * (w + 2 * MARGIN);
      const z = -MARGIN + random() * (h + 2 * MARGIN);
      const isOutside = x < 4 || x > w - 4 || z < 4 || z > h - 2;
      if (isOutside) trees.push({ x, z, s: 0.9 + random() * 0.7, y: this.hillAt(x, z) });
    }
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
    for (const mesh of [trunks, crowns]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
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

  hillAt(x, z) {
    const { w, h } = this.worldSize;
    const outside = Math.max(this.L.MAP_X0 - x, x - (w - 4), this.L.MAP_Y0 - z, z - (h - 4), 0);
    const hills = 6 * Math.sin(x * 0.031) * Math.cos(z * 0.027) + 4 * Math.sin((x + z) * 0.017) + 7;
    return smoothstep(0, 60, outside) * hills * 2.2;
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
    const era = ERA_3D[Math.min(4, Math.max(0, design.era - 1))];
    const style = STYLE_3D[design.style] ? design.style : 'prontera';
    const colors = STYLE_3D[style];
    const isHut = design.era === 1;
    const wallColor = isHut && style !== 'morroc' ? '#8a5a32' : colors.wall;
    const [roof, roofShade] = team;
    const group = new THREE.Group();
    group.add(this.box(era.w, era.wall, era.d, wallColor));
    // timber frame and corner posts
    for (const sx of [-1, 1]) group.add(this.box(1.2, era.wall, 1.2, colors.trim, sx * (era.w / 2 - 0.4), 0, era.d / 2 - 0.4));
    group.add(this.box(era.w + 0.4, 1, 0.6, colors.trim, 0, era.wall - 3, era.d / 2));
    // door and windows on the front (+z)
    group.add(this.box(6, 8, 0.8, '#3a2716', 0, 0, era.d / 2 + 0.1));
    const glass = new THREE.MeshStandardMaterial({ color: '#2a1d12', emissive: '#fcd77a', emissiveIntensity: 0.05 });
    for (const sx of [-1, 1]) {
      const win = this.box(3.6, 3.6, 0.6, glass, sx * era.w * 0.3, era.wall * 0.42, era.d / 2 + 0.2);
      win.userData.isWindow = true;
      group.add(win);
    }
    const top = era.wall;
    if (style === 'prontera' || style === 'aldebaran') {
      const gable = this.gable(era.w + 4, era.roof * (style === 'aldebaran' ? 1.35 : 1), era.d + 4, roof);
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
      group.add(cone);
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
        group.add(tier);
        y += 4.5;
        if (i < tiers - 1) {
          group.add(this.box(radius * 0.9, 4, radius * 0.9, colors.trim, 0, y - 1, 0));
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
        } else if (style === 'morroc') {
          const cap = this.dome(3.4, roof);
          cap.position.y = era.tower;
          tower.add(cap);
        } else {
          const cap = this.mesh(new THREE.ConeGeometry(style === 'payon' ? 6 : 4.8, style === 'geffen' ? 11 : 7, style === 'payon' ? 4 : 12), this.mat(roof));
          if (style === 'payon') cap.rotation.y = Math.PI / 4;
          cap.position.y = era.tower + (style === 'geffen' ? 5.5 : 3.5);
          tower.add(cap);
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

  /**
   * The town center at its size and turn, plus the walls of the bigger sizes, in base-local
   * coordinates. `tc` is the building alone: it rises from the ground and swells on an age-up.
   */
  buildCastle(design, team) {
    const L = this.L;
    const era = ERA_3D[Math.min(4, Math.max(0, design.era - 1))];
    const size = SIZE_3D[Math.min(3, Math.max(0, (design.size ?? 2) - 1))];
    const group = new THREE.Group();
    const tc = this.buildTownCenter(design, team);
    const pivot = new THREE.Group();
    pivot.add(tc);
    pivot.scale.setScalar(size.scale);
    pivot.rotation.y = -(design.rotation ?? 0) * (Math.PI / 2);
    // a bigger town center grows back and sideways: its front (the door) stays on the yard
    const z = L.TOWN_CENTER.y + L.TOWN_CENTER.h / 2 + 4 - ((size.scale - 1) * era.d) / 2;
    pivot.position.set(L.TOWN_CENTER.x + L.TOWN_CENTER.w / 2, 0, z);
    group.add(pivot);
    if (size.wall) group.add(this.buildWalls(design, team, size));
    return { group, tc };
  }

  // Curtain walls on three sides behind the town center, a round tower at each corner with a roof in
  // the team color; stone with merlons from Fortaleza on, a wooden palisade before that.
  buildWalls(design, team, size) {
    const style = STYLE_3D[design.style] ? design.style : 'prontera';
    const isPalisade = design.era <= 2;
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
    segment(x0, z1, x0, z0);
    segment(x0, z0, x1, z0);
    segment(x1, z0, x1, z1);
    for (const [tx, tz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
      const tower = new THREE.Group();
      const radius = size.keep ? 5 : 4;
      const body = this.mesh(new THREE.CylinderGeometry(radius, radius + 0.6, size.tower, 12), this.mat(stone));
      body.position.y = size.tower / 2;
      tower.add(body);
      if (style === 'morroc') {
        const cap = this.dome(radius, roof);
        cap.position.y = size.tower;
        tower.add(cap);
      } else {
        const capH = style === 'geffen' ? 12 : 8;
        const cap = this.mesh(new THREE.ConeGeometry(radius + 1.4, capH, 12), this.mat(roof));
        cap.position.y = size.tower + capH / 2;
        tower.add(cap);
      }
      tower.position.set(tx, 0, tz);
      group.add(tower);
    }
    if (size.keep) {
      // the keep: a square tower on the back wall, crenellated, with the team's flag on top
      const keep = new THREE.Group();
      const kw = 14;
      keep.add(this.box(kw, size.keep, 12, stone));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) keep.add(this.box(2.4, 2.4, 2.4, stone, sx * (kw / 2 - 1.2), size.keep, sz * 4.8));
      keep.add(this.box(kw - 4, 1, 8, roofShade, 0, size.keep, 0));
      const glass = new THREE.MeshStandardMaterial({ color: '#2a1d12', emissive: '#fcd77a', emissiveIntensity: 0.05 });
      for (const wy of [size.keep * 0.45, size.keep * 0.7]) {
        const win = this.box(2.4, 3.6, 0.6, glass, 0, wy, 6.1);
        win.userData.isWindow = true;
        keep.add(win);
      }
      keep.add(this.box(0.5, 10, 0.5, '#5e3c20', 0, size.keep + 1, 0));
      const flag = this.mesh(new THREE.PlaneGeometry(7, 4.4), this.mat(roof, { side: THREE.DoubleSide }), { cast: false });
      flag.geometry.translate(3.5, 0, 0);
      flag.position.set(0.3, size.keep + 8.6, 0);
      flag.userData.isFlag = true;
      keep.add(flag);
      keep.position.set((x0 + x1) / 2, 0, z0);
      group.add(keep);
    }
    return group;
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
    const key = `${design.era}|${design.style}|${design.size}|${design.rotation}|${team[0]}`;
    if (key !== p.key) {
      if (p.model) p.scene.remove(p.model);
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

  buildBase(base, design) {
    const L = this.L;
    const [team, teamShade] = base.team;
    const group = new THREE.Group();
    const parts = {};
    // town center: center of its 2D box, front facing the yard (turned and sized as designed)
    const { group: castle, tc } = this.buildCastle(design, base.team);
    castle.userData.hit = { project: base.project };
    group.add(castle);
    // the top of the town center's roof (turned and sized), where the balloon over it points
    castle.updateMatrixWorld(true);
    const roof = new THREE.Box3().setFromObject(tc);
    parts.balloonAt = { x: (roof.min.x + roof.max.x) / 2, y: roof.max.y, z: (roof.min.z + roof.max.z) / 2 };
    // gold mine: a rocky mound with its entrance and nuggets
    const mine = new THREE.Group();
    const mound = this.mesh(new THREE.DodecahedronGeometry(11, 1), this.mat('#8d8f96', { flatShading: true }));
    mound.scale.set(1.35, 0.75, 0.9);
    mound.position.y = 3;
    mine.add(mound, this.box(7, 9, 2, '#1a1410', 0, 0, 9), this.box(9, 1.2, 2.4, '#8a5a32', 0, 9, 9.2));
    const goldMat = this.mat('#f2c84b', { metalness: 0.7, roughness: 0.35, emissive: '#5a3d00', emissiveIntensity: 0.3 });
    for (const [gx, gz] of [[-9, 6], [8, 7], [-4, 9], [10, 2], [-12, 1]]) {
      const nugget = this.mesh(new THREE.IcosahedronGeometry(1.5, 0), goldMat);
      nugget.position.set(gx, 1, gz);
      mine.add(nugget);
    }
    mine.position.set(18, 0, 22);
    // forge: an open shed over the furnace, fire glowing when someone works the terminal
    const forge = new THREE.Group();
    for (const [px, pz] of [[-12, -8], [12, -8], [-12, 8], [12, 8]]) forge.add(this.box(1.2, 13, 1.2, '#5e3c20', px, 0, pz));
    const shedRoof = this.box(28, 1.4, 20, '#8a5a32', 0, 13, 0);
    shedRoof.rotation.x = 0.12;
    forge.add(shedRoof, this.box(11, 9, 8, '#7d7362', -4, 0, -3), this.box(4, 9, 4, '#6b6253', -4, 9, -5), this.box(6, 2.4, 3, '#3b3f4a', 6, 2.6, 3));
    parts.fire = this.mesh(new THREE.BoxGeometry(5, 3.4, 0.6), new THREE.MeshStandardMaterial({ color: '#f97316', emissive: '#f97316', emissiveIntensity: 1 }), { cast: false });
    parts.fire.position.set(-4, 3.2, 1.1);
    forge.add(parts.fire);
    parts.forgeLight = new THREE.PointLight('#ff7a2a', 0, 60, 1.8);
    parts.forgeLight.position.set(-4, 6, 4);
    forge.add(parts.forgeLight);
    forge.position.set(110, 0, 20);
    // banner in the team color
    const banner = new THREE.Group();
    banner.add(this.box(0.8, 26, 0.8, '#5e3c20', 0, 0, 0));
    parts.flag = this.mesh(new THREE.PlaneGeometry(9, 6), this.mat(team, { side: THREE.DoubleSide }), { cast: false });
    parts.flag.geometry.translate(4.5, 0, 0);
    parts.flag.position.set(0.4, 22, 0);
    banner.add(parts.flag);
    banner.position.set(L.BANNER.x, 0, L.BANNER.y);
    banner.userData.hit = { project: base.project };
    // the bell, up only while an agent here is blocked on you
    parts.bell = new THREE.Group();
    parts.bell.add(this.box(1, 18, 1, '#5e3c20', -6, 0, 0), this.box(1, 18, 1, '#5e3c20', 6, 0, 0), this.box(14, 1.4, 1.4, '#8a5a32', 0, 18, 0));
    parts.bellBody = this.mesh(new THREE.CylinderGeometry(1.4, 3.4, 5, 14), this.mat('#f2c84b', { metalness: 0.75, roughness: 0.3 }));
    parts.bellBody.geometry.translate(0, -2.5, 0);
    parts.bellBody.position.y = 17.4;
    parts.bell.add(parts.bellBody);
    parts.bell.position.set(L.BELL.x, 0, L.BELL.y);
    // territory: a dashed line around the plot, and a glow for the base picked or hovered
    const outline = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.6, 0),
      new THREE.Vector3(L.PLOT_W, 0.6, 0),
      new THREE.Vector3(L.PLOT_W, 0.6, L.PLOT_H),
      new THREE.Vector3(0, 0.6, L.PLOT_H),
    ]);
    parts.territory = new THREE.LineLoop(outline, new THREE.LineDashedMaterial({ color: team, dashSize: 4, gapSize: 3, transparent: true, opacity: 0.9 }));
    parts.territory.computeLineDistances();
    parts.glow = new THREE.Mesh(new THREE.PlaneGeometry(L.PLOT_W, L.PLOT_H), new THREE.MeshBasicMaterial({ color: LINK_COLOR, transparent: true, opacity: 0, depthWrite: false }));
    parts.glow.rotation.x = -Math.PI / 2;
    parts.glow.position.set(L.PLOT_W / 2, 0.4, L.PLOT_H / 2);
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
      obelisk.position.set(16, 0, 74);
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
      beacon.position.set(120, 0, 76);
      group.add(beacon);
    }
    parts.beam = new THREE.Mesh(new THREE.CylinderGeometry(9, 14, 140, 20, 1, true), new THREE.MeshBasicMaterial({ color: '#fde68a', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    parts.beam.position.set(L.TOWN_CENTER.x + L.TOWN_CENTER.w / 2, 70, L.TOWN_CENTER.y + L.TOWN_CENTER.h / 2 + 4);
    parts.beam.visible = false;
    group.add(mine, forge, banner, parts.bell, parts.territory, parts.glow, parts.beam);
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
      const key = `${design.era}|${design.style}|${design.size}|${design.rotation}|${base.team[0]}|${e.wondersOf(base.project).join(',')}`;
      let entry = this.bases.get(base.project);
      if (!entry || entry.key !== key) {
        if (entry) this.scene.remove(entry.group);
        entry = { ...this.buildBase(base, design), key };
        this.bases.set(base.project, entry);
        this.scene.add(entry.group);
      }
      const { group, parts } = entry;
      group.position.set(base.pos.x, 0, base.pos.y);
      const rise = Math.min(1, Math.max(0, (now - base.foundedAt) / 1400));
      parts.tc.scale.y = Math.max(0.02, rise);
      const isAlarm = alarm.has(base.project);
      const isPicked = (e.baseHighlight?.project === base.project && now < e.baseHighlight.until) || linked.has(base.project) || e.summonTarget === base.project;
      parts.territory.material.color.set(isAlarm ? kindInfo('asking').color : base.team[0]);
      parts.territory.material.opacity = isAlarm ? 0.55 + 0.45 * Math.sin(t * 7) : 0.9;
      parts.glow.material.opacity = isPicked ? 0.1 + 0.08 * Math.sin(t * 6) : isAlarm ? 0.06 + 0.06 * Math.sin(t * 7) : 0;
      parts.glow.material.color.set(isPicked ? LINK_COLOR : kindInfo('asking').color);
      parts.bell.visible = isAlarm && rise === 1;
      parts.bellBody.rotation.z = isAlarm ? Math.sin(t * 9) * 0.35 : 0;
      const isForging = busy.get(base.project)?.has('forge');
      parts.fire.material.emissiveIntensity = (isForging ? 2.2 : 1) + 0.4 * Math.sin(t * 13);
      parts.forgeLight.intensity = (sky.isNight ? 1 : 0.15) * (isForging ? 900 : 350);
      parts.flag.rotation.y = Math.sin(t * 2.4 + base.pos.x) * 0.35;
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
      });
    }
    for (const [project, entry] of this.bases) {
      if (seen.has(project)) continue;
      this.scene.remove(entry.group);
      this.bases.delete(project);
    }
  }

  // ---------- Villagers, scout and soldiers ----------

  buildVillager(look) {
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
    parts.arrow = this.mesh(new THREE.ConeGeometry(1.8, 3.6, 10), new THREE.MeshBasicMaterial({ color: LINK_COLOR }), { cast: false });
    parts.arrow.rotation.x = Math.PI;
    group.add(parts.arrow);
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

  buildScout(look) {
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

  emoteTexture(kind) {
    if (!this.emoteTextures.has(kind)) {
      const canvas = document.createElement('canvas');
      canvas.width = 48;
      canvas.height = 48;
      const ctx = canvas.getContext('2d');
      ctx.scale(4, 4);
      S.drawEmote(ctx, 6, 11, kind, 0);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      this.emoteTextures.set(kind, texture);
    }
    return this.emoteTextures.get(kind);
  }

  syncUnits(now, t) {
    const e = this.empire;
    const seen = new Set();
    const highlightId = e.highlight && now <= e.highlight.until ? e.highlight.id : null;
    for (const ch of e.chars.values()) {
      seen.add(ch.id);
      let entry = this.units.get(ch.id);
      if (entry && entry.tunic !== ch.look.tunic) {
        this.scene.remove(entry.group); // the team color changed: dress it again
        this.units.delete(ch.id);
        entry = null;
      }
      if (!entry) {
        entry = ch.isObserver ? this.buildScout(ch.look) : this.buildVillager(ch.look);
        entry.last = { x: ch.x, y: ch.y };
        entry.tunic = ch.look.tunic;
        entry.group.userData.hit = { id: ch.id };
        this.units.set(ch.id, entry);
        this.scene.add(entry.group);
      }
      const { group, parts } = entry;
      group.visible = now >= ch.hiddenUntil;
      const isWalking = ch.path.length > 0;
      const dx = ch.x - entry.last.x;
      const dy = ch.y - entry.last.y;
      if (Math.hypot(dx, dy) > 0.05) group.rotation.y = Math.atan2(dx, dy);
      else if (!isWalking && ch.mode === 'working') group.rotation.y = { n: Math.PI, s: 0, e: Math.PI / 2, w: -Math.PI / 2 }[ch.dir] ?? 0;
      entry.last = { x: ch.x, y: ch.y };
      const bob = isWalking ? Math.abs(Math.sin(ch.walkClock * 11)) * 0.9 : 0;
      group.position.set(ch.x, bob, ch.y);
      if (ch.isObserver) continue;
      const { agent } = ch;
      const isSitting = !isWalking && ch.mode === 'poi' && ch.poi?.pose === 'sit';
      parts.legs.forEach((leg, i) => {
        leg.rotation.x = isWalking ? Math.sin(ch.walkClock * 11 + i * Math.PI) * 0.6 : 0;
        leg.visible = !isSitting;
      });
      parts.torso.position.y = isSitting ? 2 : 4;
      const isWaiting = !ch.isRecruit && ch.goal?.type !== 'exit' && (agent.status !== 'busy' || agent.activity.kind === 'asking');
      const isBlocked = agent.status === 'busy' && agent.activity.kind === 'asking';
      this.poseVillager(entry, ch, t, { isWalking, isSitting, isWaiting, isBlocked });
      const isLinked = ch.id === e.linkedId;
      const isPicked = e.selected.has(ch.id);
      parts.ring.visible = isPicked || isLinked || isWaiting;
      parts.ring.material.color.set(isLinked ? LINK_COLOR : isPicked ? '#ffffff' : kindInfo(isBlocked ? 'asking' : 'yourturn').color);
      parts.ring.material.opacity = isPicked || isLinked ? 0.95 : 0.55 + 0.35 * Math.sin(t * 5);
      const emote = this.emoteTexture(agent.status === 'busy' ? agent.activity.kind : 'yourturn');
      if (parts.emote.material.map !== emote) {
        parts.emote.material.map = emote;
        parts.emote.material.needsUpdate = true;
      }
      parts.emote.visible = !ch.isRecruit; // a recruit has nothing to do yet
      parts.emote.position.y = isSitting ? 17 : 19;
      parts.conflict.visible = e.conflicts.has(ch.id);
      parts.arrow.visible = isLinked || ch.id === highlightId;
      parts.arrow.position.y = 24 + Math.sin(t * 6) * 1.2;
    }
    for (const [id, entry] of this.units) {
      if (seen.has(id)) continue;
      this.scene.remove(entry.group);
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
  poseVillager(entry, ch, t, { isWalking, isSitting, isWaiting, isBlocked }) {
    const { parts } = entry;
    const [free, hand] = parts.arms;
    for (const node of [free, hand, parts.torso, parts.head]) node.rotation.set(0, 0, 0);
    for (const tool of Object.values(parts.tools)) tool.visible = false;
    parts.chips.visible = false;
    parts.torso.scale.y = 1;
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
    const { group, parts } = entry;
    const [free, hand] = parts.arms;
    const cycle = phase / work.period;
    const u = cycle - Math.floor(cycle);
    const lift = u < 0.6 ? smoothstep(0, 0.6, u) : u < STRIKE_AT ? 1 - ((u - 0.6) / (STRIKE_AT - 0.6)) ** 2 : 0;
    hand.rotation.x = work.strike + (work.raised - work.strike) * lift;
    free.rotation.x = hand.rotation.x * 0.5;
    parts.torso.rotation.x = work.lean * (1 - lift) - 0.08 * lift;
    const tool = parts.tools[work.tool];
    tool.visible = true;
    const burst = Math.floor(cycle - STRIKE_AT);
    const age = (cycle - STRIKE_AT - burst) / CHIP_LIFE;
    if (age >= 1) return;
    if (entry.burst !== burst) {
      if (u < STRIKE_AT) return; // came in mid-swing: wait for a blow of its own
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
      const outline = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0.8, 0),
        new THREE.Vector3(w, 0.8, 0),
        new THREE.Vector3(w, 0.8, h),
        new THREE.Vector3(0, 0.8, h),
      ]);
      const line = new THREE.LineLoop(outline, new THREE.LineDashedMaterial({ color, dashSize: 4, gapSize: 3, transparent: true, opacity }));
      line.computeLineDistances();
      const slab = new THREE.Mesh(new THREE.BoxGeometry(area.w, 2, area.h), new THREE.MeshStandardMaterial({ color, transparent: true, opacity: opacity * 0.6 }));
      slab.position.set(area.x + area.w / 2, 1, area.y + area.h / 2);
      group.add(line, slab);
      group.visible = false;
      this.scene.add(group);
      return { group, line, slab };
    };
    return { hover: make('#ffffff', 0.7), drag: make('#ffffff', 0.9), square: make('#ffffff', 0.9, L.SQUARE_W, L.SQUARE_H, L.PAVING), reserved: [] };
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
      drag.group.position.set(pos.x, 0, pos.y);
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
    this.syncBases(now, t, sky);
    this.syncUnits(now, t);
    this.syncGhosts();
    this.pickables = [...[...this.bases.values()].flatMap(({ group }) => group.children.filter((c) => c.userData.hit)), ...[...this.units.values()].map((u) => u.group), ...[...this.bots.values()].map((b) => b.group), this.squareGroup];
    this.renderer.render(this.scene, this.camera);
  }
}
