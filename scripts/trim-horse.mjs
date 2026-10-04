// Trims Quaternius' white horse (Ultimate Animated Animal Pack, CC0, via Poly Pizza) into the scouts'
// mount, in src/models/quaternius/horse.glb: the four clips the map plays (Idle, Walk, Gallop,
// Eating) instead of 26, without the channels that never leave the rest pose, and its seven
// flat-colored parts merged into one mesh painted from a palette, each part sampling its own cell, so
// one draw call takes any coat (models.js draws the palette; the file carries no image, which the
// app's CSP would block).
//
//   curl -L -o /tmp/horse.glb https://static.poly.pizza/3edc2bd9-3378-4b43-a50d-d5e1f858562b.glb
//   mkdir /tmp/trim && cd /tmp/trim && npm i @gltf-transform/core @gltf-transform/functions @gltf-transform/extensions
//   node <repo>/scripts/trim-horse.mjs /tmp/horse.glb
//
// glTF Transform is taken from the folder it runs in, so the repository needs no package.json.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const fromHere = createRequire(`${process.cwd()}/`);
const load = (name) => import(pathToFileURL(fromHere.resolve(name)).href);
const { NodeIO } = await load('@gltf-transform/core');
const { ALL_EXTENSIONS } = await load('@gltf-transform/extensions');
const { dedup, joinPrimitives, prune, quantize, resample } = await load('@gltf-transform/functions');

const SRC = process.argv[2];
const OUT = join(dirname(fileURLToPath(import.meta.url)), '../src/models/quaternius');
const CLIPS = ['Idle', 'Walk', 'Gallop', 'Eating'];
// The palette's cells, one per part, in a row of 8 (models.js CREW.horse.cells follows this order).
const PARTS = ['Main', 'Hair', 'Muzzle', 'Hooves', 'Main_Light', 'Eye_Black', 'Eye_White'];

if (!SRC) {
  console.error('usage: node scripts/trim-horse.mjs <horse.glb>');
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(SRC);
const root = doc.getRoot();

// A channel whose every key is the joint's own rest value moves nothing: no clip needs it.
function isAtRest(channel) {
  const node = channel.getTargetNode();
  const path = channel.getTargetPath();
  const rest = path === 'rotation' ? node.getRotation() : path === 'translation' ? node.getTranslation() : node.getScale();
  const values = channel.getSampler().getOutput().getArray();
  for (let i = 0; i < values.length; i++) if (Math.abs(values[i] - rest[i % rest.length]) > 1e-4) return false;
  return true;
}

// The pack ships every clip twice ("Gallop" and "AnimalArmature|Gallop"): one of each is kept.
const joints = new Set(root.listSkins()[0].listJoints());
for (const anim of root.listAnimations()) {
  if (!CLIPS.includes(anim.getName())) {
    for (const sampler of anim.listSamplers()) sampler.dispose();
    anim.dispose();
    continue;
  }
  for (const channel of anim.listChannels()) {
    if (joints.has(channel.getTargetNode()) && !isAtRest(channel)) continue;
    channel.getSampler().dispose();
    channel.dispose();
  }
}

// Each part samples the middle of its cell; then the parts become one primitive with one material.
const buffer = root.listBuffers()[0];
const mesh = root.listMeshes()[0];
const prims = mesh.listPrimitives();
const material = doc.createMaterial('horse').setRoughnessFactor(0.85).setMetallicFactor(0);
for (const prim of prims) {
  const cell = PARTS.indexOf(prim.getMaterial().getName());
  if (cell < 0) throw new Error(`unknown part ${prim.getMaterial().getName()}`);
  const count = prim.getAttribute('POSITION').getCount();
  const uv = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) uv.set([(cell + 0.5) / 8, 0.5], i * 2);
  prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(uv).setBuffer(buffer));
  prim.setMaterial(material);
}
const joined = joinPrimitives(prims);
for (const prim of prims) prim.dispose();
mesh.addPrimitive(joined);

await doc.transform(resample(), prune({ keepAttributes: true }), dedup(), quantize({ quantizePosition: 14, quantizeNormal: 8, quantizeTexcoord: 12, quantizeWeight: 8 }));
await io.write(join(OUT, 'horse.glb'), doc);
