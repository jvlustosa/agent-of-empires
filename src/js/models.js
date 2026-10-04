// Ready-made models for the 3D map, all CC0: KayKit's Medieval Hexagon Pack (Kay Lousberg) for the
// mine, the forge and the trees, Kenney's Fantasy Town Kit for the town center's walls and roofs, and
// KayKit's Adventurers for the villagers. They load in the background; until they arrive, or if one
// fails, the map keeps drawing its own procedural stand-ins.
import * as THREE from '../vendor/three/three.module.min.js';
import { GLTFLoader } from '../vendor/three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from '../vendor/three/addons/utils/BufferGeometryUtils.js';
import { clone as cloneSkinned } from '../vendor/three/addons/utils/SkeletonUtils.js';

// Each kit paints every model from one palette texture: a grid of gradient cells, light at the top.
// Repainting a cell recolors whatever samples it (`cells`, as [column, row]), so one model takes any
// team or town style. The palette is drawn small (`size` px) and without mipmaps: models sample a
// cell's middle, never its edges, so nothing bleeds, and each painted copy weighs a few dozen KB.
const KITS = {
  kaykit: {
    root: 'models/kaykit/',
    size: 256,
    grid: [8, 4],
    shade: [0.25, 0.55], // toward white at the top, toward black at the bottom, as the pack's own cells
    files: { mine: 'building_mine_blue.gltf', forge: 'building_blacksmith_blue.gltf', pine: 'tree_single_A.gltf', fir: 'tree_single_B.gltf' },
    cells: { team: [[0, 3]] }, // the blue team's banners and roofs
  },
  kenney: {
    root: 'models/kenney/',
    size: 128,
    grid: [16, 4],
    shade: [0.12, 0.2],
    files: {
      wall: 'wall.glb',
      window: 'wall-window-glass.glb',
      door: 'wall-door.glb',
      woodWall: 'wall-wood.glb',
      woodWindow: 'wall-wood-window-glass.glb',
      woodDoor: 'wall-wood-door.glb',
      gable: 'roof-gable.glb',
    },
    cells: { wall: [[2, 2], [3, 2]], trim: [[8, 3], [9, 3]], planks: [[10, 3], [11, 3]], roof: [[2, 3], [3, 3]] },
  },
};
// The villagers: four characters on one rig, each trimmed to a skinned body (cape included, one draw
// call) and a hat worn or not, plus the clips they play, once, in a file of their own. Cells per
// character, as their palettes differ: the tunic takes the team color, then skin and hair.
const CREW = {
  root: 'models/kaykit-adventurers/',
  size: 128,
  grid: [8, 4],
  shade: [0.25, 0.55],
  clips: 'villager-clips.glb',
  characters: {
    knight: { file: 'villager-knight.glb', cells: { team: [[0, 1], [7, 0]], skin: [[0, 0]], hair: [[1, 0]] } },
    barbarian: { file: 'villager-barbarian.glb', cells: { team: [[0, 1], [1, 1]], skin: [[0, 0]], hair: [[1, 0]] } },
    mage: { file: 'villager-mage.glb', cells: { team: [[0, 1], [1, 1], [2, 1]], teamShade: [[7, 1]], skin: [[0, 0], [7, 2]], hair: [[1, 0]] } },
    rogue: { file: 'villager-rogue.glb', cells: { team: [[1, 1]], teamShade: [[0, 1]], skin: [[0, 0]], hair: [[1, 0]] } },
  },
};
const WHITE = new THREE.Color('#ffffff');
const BLACK = new THREE.Color('#000000');

const geometries = new Map(); // model name -> { kit, geometry }, in model units
const palettes = new Map(); // kit name -> its palette, drawn small
const materials = new Map(); // kit + paint -> material
const crew = new Map(); // character -> its scene, rig and meshes, to clone per villager
let crewClips = null; // clip name -> AnimationClip

export const modelsReady = Promise.all([...Object.entries(KITS).map(([name, kit]) => loadKit(name, kit)), loadCrew()]);

async function loadKit(kitName, kit) {
  const loader = new GLTFLoader().setPath(kit.root);
  const results = await Promise.allSettled(Object.entries(kit.files).map(async ([name, file]) => [name, await loader.loadAsync(file)]));
  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('[models]', result.reason);
      continue;
    }
    const [name, gltf] = result.value;
    const parts = [];
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((node) => {
      if (!node.isMesh) return;
      if (!palettes.has(kitName) && node.material.map) palettes.set(kitName, drawSmall(node.material.map.image, kit.size));
      parts.push(node.geometry.clone().applyMatrix4(node.matrixWorld));
      node.geometry.dispose();
      node.material.map?.dispose();
      node.material.dispose();
    });
    if (!parts.length) continue;
    // one geometry per model (Kenney's doors are a second mesh), without the tangents nothing here uses
    for (const part of parts) part.deleteAttribute('tangent');
    geometries.set(name, { kit: kitName, geometry: parts.length === 1 ? parts[0] : mergeGeometries(parts) });
  }
}

async function loadCrew() {
  const loader = new GLTFLoader().setPath(CREW.root);
  const names = Object.keys(CREW.characters);
  const [clips, ...characters] = await Promise.allSettled([CREW.clips, ...names.map((name) => CREW.characters[name].file)].map((file) => loader.loadAsync(file)));
  if (clips.status === 'rejected') {
    console.error('[models]', clips.reason);
    return;
  }
  crewClips = Object.fromEntries(clips.value.animations.map((clip) => [clip.name, clip]));
  characters.forEach((result, i) => {
    if (result.status === 'rejected') {
      console.error('[models]', result.reason);
      return;
    }
    const { scene } = result.value;
    scene.traverse((node) => {
      if (!node.isMesh) return;
      if (!palettes.has(names[i])) palettes.set(names[i], drawSmall(node.material.map.image, CREW.size));
      node.material.map?.dispose();
      node.material.dispose();
    });
    crew.set(names[i], scene);
  });
}

function drawSmall(image, size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  canvas.getContext('2d').drawImage(image, 0, 0, size, size);
  return canvas;
}

/**
 * { geometry, material } of a model, null while loading or if it failed. `paint` recolors the kit's
 * cells: { team } for KayKit, { wall, trim, planks, roof } for Kenney (each optional).
 */
export function modelParts(name, paint = {}) {
  const model = geometries.get(name);
  if (!model || !palettes.has(model.kit)) return null;
  return { geometry: model.geometry, material: paletteMaterial(model.kit, paint) };
}

/**
 * A villager for `look` (from sprites.makeLook), null while loading or if it failed: { root, clips },
 * root standing at the origin facing +z, about 2.2 units tall (hat aside), its rig's bones named as
 * the pack's without the dots (`handslotr`, `head`, `chest`). Its character, hat and colors follow
 * the look, so a villager keeps them from one session to the next.
 */
export function villagerModel(look) {
  const names = [...crew.keys()];
  if (!crewClips || !names.length) return null;
  const character = names[(look.seed >>> 19) % names.length];
  const root = cloneSkinned(crew.get(character));
  const material = paletteMaterial(character, { team: look.tunic, teamShade: look.tunicShade, skin: look.skin, hair: look.hair });
  root.traverse((node) => {
    if (!node.isMesh) return;
    node.material = material;
    node.castShadow = true;
    node.receiveShadow = true;
  });
  if (look.hat !== 1 && look.hat !== 2) root.getObjectByName('Hat')?.removeFromParent(); // half of them go bareheaded
  return { root, clips: crewClips };
}

function paletteMaterial(kitName, paint) {
  const kit = KITS[kitName] ?? { ...CREW, ...CREW.characters[kitName] };
  const colors = Object.entries(paint)
    .filter(([cell, color]) => color && kit.cells[cell])
    .sort(([a], [b]) => a.localeCompare(b));
  const key = `${kitName}|${colors.map(([cell, color]) => `${cell}:${color}`).join('|')}`;
  if (materials.has(key)) return materials.get(key);
  const canvas = drawSmall(palettes.get(kitName), kit.size);
  const ctx = canvas.getContext('2d');
  const [cellW, cellH] = [kit.size / kit.grid[0], kit.size / kit.grid[1]];
  for (const [cell, color] of colors) {
    const base = new THREE.Color(color);
    for (const [column, row] of kit.cells[cell]) {
      const y = row * cellH;
      const gradient = ctx.createLinearGradient(0, y, 0, y + cellH);
      gradient.addColorStop(0, `#${base.clone().lerp(WHITE, kit.shade[0]).getHexString()}`);
      gradient.addColorStop(0.5, color);
      gradient.addColorStop(1, `#${base.clone().lerp(BLACK, kit.shade[1]).getHexString()}`);
      ctx.fillStyle = gradient;
      ctx.fillRect(column * cellW, y, cellW, cellH);
    }
  }
  const map = new THREE.CanvasTexture(canvas);
  map.flipY = false; // glTF's UVs
  map.colorSpace = THREE.SRGBColorSpace;
  map.generateMipmaps = false;
  map.minFilter = THREE.LinearFilter;
  const material = new THREE.MeshStandardMaterial({ map, roughness: 0.85, metalness: 0 });
  materials.set(key, material);
  return material;
}
