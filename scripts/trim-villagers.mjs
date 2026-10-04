// Trims KayKit's Adventurers character pack (Kay Lousberg, CC0) into the villagers of the 3D map, in
// src/models/kaykit-adventurers/: per character, the body, the cape and the hat, merged into one
// skinned mesh for the body and cape and another for the hat, with quantized vertices; the clips the
// map plays once, in a rig-only file, without the channels that never leave the rest pose. The pack
// ships 76 clips, weapons and shields in each 3.6 MB character; what is left weighs about 150 KB.
//
//   git clone --depth 1 https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0 /tmp/adventurers
//   mkdir /tmp/trim && cd /tmp/trim && npm i @gltf-transform/core @gltf-transform/functions @gltf-transform/extensions
//   node <repo>/scripts/trim-villagers.mjs /tmp/adventurers/addons/kaykit_character_pack_adventures/Characters/gltf
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
const { dedup, joinPrimitives, prune, quantize, resample, transformPrimitive, weld } = await load('@gltf-transform/functions');

const SRC = process.argv[2];
const OUT = join(dirname(fileURLToPath(import.meta.url)), '../src/models/kaykit-adventurers');
// Each character's rigid parts that stay: the cape (body mesh) and the hat (its own mesh).
const CHARACTERS = {
  Knight: { cape: 'Knight_Cape', hat: 'Knight_Helmet' },
  Barbarian: { cape: 'Barbarian_Cape', hat: 'Barbarian_Hat' },
  Mage: { cape: 'Mage_Cape', hat: 'Mage_Hat' },
  Rogue: { cape: 'Rogue_Cape' },
};
const CLIPS = ['Idle', 'Walking_A', 'Running_A', 'Sit_Chair_Idle', '1H_Melee_Attack_Chop', '2H_Melee_Attack_Chop', 'Use_Item', '2H_Ranged_Aiming', '1H_Ranged_Aiming'];

if (!SRC) {
  console.error('usage: node scripts/trim-villagers.mjs <pack>/Characters/gltf');
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

// Disposing an animation leaves its samplers behind, holding their keyframes: they go explicitly, and
// prune() then drops the keyframes no one uses (samplers share their time input).
function dropAnimation(anim) {
  for (const sampler of anim.listSamplers()) sampler.dispose();
  anim.dispose();
}

// A rigid part (cape on the chest, hat on the head) skinned to the joint it hangs from, in bind space.
function skinToParent(doc, node, joints) {
  const prim = node.getMesh().listPrimitives()[0];
  transformPrimitive(prim, node.getWorldMatrix());
  const count = prim.getAttribute('POSITION').getCount();
  const index = joints.indexOf(node.getParentNode());
  const jointIds = new Uint8Array(count * 4);
  const weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    jointIds[i * 4] = index;
    weights[i * 4] = 1;
  }
  const buffer = doc.getRoot().listBuffers()[0];
  prim.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(jointIds).setBuffer(buffer));
  prim.setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(weights).setBuffer(buffer));
  return prim;
}

for (const [name, { cape, hat }] of Object.entries(CHARACTERS)) {
  const doc = await io.read(join(SRC, `${name}.glb`));
  const root = doc.getRoot();
  for (const anim of root.listAnimations()) dropAnimation(anim);
  const skin = root.listSkins()[0];
  const joints = skin.listJoints();
  const meshNodes = root.listNodes().filter((node) => node.getMesh());
  const rig = meshNodes.find((node) => node.getSkin()).getParentNode();
  const add = (meshName, prims) => rig.addChild(doc.createNode(meshName).setSkin(skin).setMesh(doc.createMesh(meshName).addPrimitive(joinPrimitives(prims))));
  const body = meshNodes.filter((node) => node.getSkin()).map((node) => node.getMesh().listPrimitives()[0]);
  add('Body', [...body, skinToParent(doc, meshNodes.find((node) => node.getName() === cape), joints)]);
  if (hat) add('Hat', [skinToParent(doc, meshNodes.find((node) => node.getName() === hat), joints)]);
  for (const node of meshNodes) node.dispose(); // weapons and shields go too
  await doc.transform(prune(), dedup(), weld(), quantize({ quantizePosition: 14, quantizeNormal: 8, quantizeTexcoord: 12, quantizeWeight: 8 }));
  await io.write(join(OUT, `villager-${name.toLowerCase()}.glb`), doc);
}

// A channel whose every key is the joint's own rest value moves nothing: no clip needs it.
function isAtRest(channel) {
  const node = channel.getTargetNode();
  const path = channel.getTargetPath();
  const rest = path === 'rotation' ? node.getRotation() : path === 'translation' ? node.getTranslation() : node.getScale();
  const values = channel.getSampler().getOutput().getArray();
  for (let i = 0; i < values.length; i++) if (Math.abs(values[i] - rest[i % rest.length]) > 1e-4) return false;
  return true;
}

// The clips, once: every character shares the rig (41 joints, same names).
const doc = await io.read(join(SRC, 'Rogue.glb'));
const root = doc.getRoot();
const joints = new Set(root.listSkins()[0].listJoints());
for (const anim of root.listAnimations()) {
  if (!CLIPS.includes(anim.getName())) {
    dropAnimation(anim);
    continue;
  }
  for (const channel of anim.listChannels()) {
    if (joints.has(channel.getTargetNode()) && !isAtRest(channel)) continue;
    channel.getSampler().dispose();
    channel.dispose();
  }
}
for (const node of root.listNodes()) if (node.getMesh()) node.dispose();
for (const skin of root.listSkins()) skin.dispose();
await doc.transform(resample(), prune(), dedup());
await io.write(join(OUT, 'villager-clips.glb'), doc);
