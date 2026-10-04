// "O Batedor": the village's hero. It reads the sources it is equipped with (Slack, Gmail, Notion,
// through the user's Claude connectors) and brings back missions for the bases. Its equipment window
// is laid out as Ragnarok Online's: the knight in the middle, slots around it (skills on the head,
// connectors as shield, lance and cape, routines as boots and jewels), the status below and a bag with
// what the user's Claude has linked. It levels up as it works.
// Everything it read is untrusted text: it is only ever set with textContent, and a mission starts
// nothing until the user trains a villager with it.
import { formatElapsed } from './kinds.js';
import { KNIGHT_ARMOR, drawKnightAura, drawKnightPortrait, drawSlackShield, knightTier, makeLook } from './sprites.js';

// Same as scout::LEVEL_XP and scout::SKILL_SLOT_LEVELS in the backend.
const LEVEL_XP = [0, 60, 180, 400, 750, 1250, 2000];
const SKILL_SLOT_LEVELS = [1, 3, 5];
const ARMOR_NAMES = ['Couro', 'Ferro', 'Aço', 'Ouro'];
const LEVEL_TITLES = ['Escudeiro', 'Batedor', 'Cavaleiro', 'Cavaleiro veterano', 'Paladino', 'Campeão', 'Lenda da aldeia'];
const CONNECTORS = [
  { id: 'slack', name: 'Slack', label: 'Canais', placeholder: '#ac-tickets, #dev-bug-report', hint: 'Nomes ou IDs dos canais. Ele lê só o que chegou desde a última ronda.' },
  { id: 'gmail', name: 'Gmail', label: 'Busca', placeholder: 'label:clientes is:unread', hint: 'Uma busca do Gmail: ele lê as conversas novas que caem nela.' },
  { id: 'notion', name: 'Notion', label: 'Páginas', placeholder: 'Roadmap, Bugs do produto', hint: 'Páginas ou bancos de dados do Notion para acompanhar.' },
  { id: 'drive', name: 'Google Drive', label: 'Arquivos', placeholder: 'Specs do produto, Feedback de clientes', hint: 'Pastas ou documentos do Drive: ele lê os que mudaram desde a última ronda.' },
];
// Where each connector goes when it has no slot yet (state saved before slots could be chosen).
const DEFAULT_CONNECTOR_SLOTS = { slack: 'shield', gmail: 'lance', notion: 'cape', drive: 'boots' };
// The window's slots, as Ragnarok lays them out: the head carries skills (the mind); the hands, the
// back and the feet the connectors (where it goes to read; any of them in any of the four); the
// jewels the routines (when it rides).
const SLOTS = [
  { id: 'helm', side: 'left', name: 'Elmo', kind: 'skill', index: 0 },
  { id: 'visor', side: 'left', name: 'Viseira', kind: 'skill', index: 1 },
  { id: 'lance', side: 'left', name: 'Lança', kind: 'connector' },
  { id: 'armor', side: 'left', name: 'Armadura', kind: 'armor' },
  { id: 'ring', side: 'left', name: 'Anel', kind: 'routine', index: 0 },
  { id: 'plume', side: 'right', name: 'Penacho', kind: 'skill', index: 2 },
  { id: 'cape', side: 'right', name: 'Capa', kind: 'connector' },
  { id: 'shield', side: 'right', name: 'Escudo', kind: 'connector' },
  { id: 'boots', side: 'right', name: 'Botas', kind: 'connector' },
  { id: 'amulet', side: 'right', name: 'Amuleto', kind: 'routine', index: 1 },
];
const MAX_ROUTINES = SLOTS.filter((slot) => slot.kind === 'routine').length;
// 9 x 9 pixel icons, drawn like the rest of the map.
const ICONS = {
  helm: '<rect x="2" y="1" width="5" height="1" fill="#c4cad1"/><rect x="1" y="2" width="7" height="5" fill="#9aa3ad"/><rect x="1" y="2" width="1" height="5" fill="#6b7280"/><rect x="3" y="4" width="4" height="1" fill="#1f2937"/><rect x="1" y="7" width="2" height="1" fill="#6b7280"/><rect x="6" y="7" width="2" height="1" fill="#6b7280"/>',
  visor: '<rect x="1" y="3" width="7" height="3" fill="#9aa3ad"/><rect x="1" y="5" width="7" height="1" fill="#6b7280"/><rect x="2" y="4" width="2" height="1" fill="#1f2937"/><rect x="5" y="4" width="2" height="1" fill="#1f2937"/>',
  plume: '<rect x="5" y="0" width="2" height="2" fill="#e01e5a"/><rect x="4" y="1" width="2" height="3" fill="#e01e5a"/><rect x="3" y="3" width="2" height="3" fill="#b8164a"/><rect x="3" y="6" width="1" height="3" fill="#6b7280"/>',
  lance: '<rect x="7" y="0" width="2" height="2" fill="#e5e7eb"/><rect x="6" y="2" width="1" height="1" fill="#8a5a32"/><rect x="5" y="3" width="1" height="1" fill="#8a5a32"/><rect x="4" y="4" width="1" height="1" fill="#8a5a32"/><rect x="3" y="5" width="1" height="1" fill="#8a5a32"/><rect x="2" y="6" width="1" height="1" fill="#8a5a32"/><rect x="1" y="7" width="1" height="1" fill="#8a5a32"/><rect x="0" y="8" width="1" height="1" fill="#5e3c20"/>',
  cape: '<rect x="2" y="0" width="5" height="2" fill="#6b2a6d"/><rect x="1" y="2" width="7" height="5" fill="#4a154b"/><rect x="0" y="7" width="9" height="2" fill="#4a154b"/><rect x="0" y="8" width="9" height="1" fill="#ecb22e"/>',
  armor: '<rect x="1" y="1" width="2" height="2" fill="#6b7280"/><rect x="6" y="1" width="2" height="2" fill="#6b7280"/><rect x="2" y="2" width="5" height="6" fill="#9aa3ad"/><rect x="2" y="2" width="1" height="6" fill="#6b7280"/><rect x="4" y="3" width="1" height="4" fill="#c4cad1"/>',
  boots: '<rect x="1" y="1" width="2" height="5" fill="#7a4f2e"/><rect x="5" y="1" width="2" height="5" fill="#7a4f2e"/><rect x="1" y="6" width="3" height="2" fill="#5a3a22"/><rect x="5" y="6" width="3" height="2" fill="#5a3a22"/>',
  ring: '<rect x="3" y="0" width="3" height="2" fill="#36c5f0"/><rect x="2" y="2" width="5" height="1" fill="#ecb22e"/><rect x="1" y="3" width="1" height="4" fill="#ecb22e"/><rect x="7" y="3" width="1" height="4" fill="#ecb22e"/><rect x="2" y="7" width="5" height="1" fill="#c99a2e"/>',
  amulet: '<rect x="1" y="0" width="1" height="3" fill="#c99a2e"/><rect x="7" y="0" width="1" height="3" fill="#c99a2e"/><rect x="2" y="3" width="1" height="1" fill="#c99a2e"/><rect x="6" y="3" width="1" height="1" fill="#c99a2e"/><rect x="3" y="4" width="3" height="3" fill="#2eb67d"/><rect x="4" y="7" width="1" height="1" fill="#2eb67d"/>',
  lock: '<rect x="3" y="1" width="3" height="1" fill="#9aa3ad"/><rect x="2" y="2" width="1" height="2" fill="#9aa3ad"/><rect x="6" y="2" width="1" height="2" fill="#9aa3ad"/><rect x="1" y="4" width="7" height="5" fill="#c99a2e"/><rect x="4" y="5" width="1" height="2" fill="#5a3a22"/>',
  gmail: '<rect x="0" y="1" width="9" height="7" fill="#f6f3ec"/><rect x="0" y="1" width="1" height="7" fill="#e01e5a"/><rect x="8" y="1" width="1" height="7" fill="#e01e5a"/><rect x="1" y="2" width="1" height="1" fill="#e01e5a"/><rect x="2" y="3" width="1" height="1" fill="#e01e5a"/><rect x="3" y="4" width="3" height="1" fill="#e01e5a"/><rect x="6" y="3" width="1" height="1" fill="#e01e5a"/><rect x="7" y="2" width="1" height="1" fill="#e01e5a"/>',
  notion: '<rect x="1" y="0" width="7" height="9" fill="#f6f3ec"/><rect x="1" y="0" width="7" height="1" fill="#1f2937"/><rect x="1" y="8" width="7" height="1" fill="#1f2937"/><rect x="2" y="2" width="1" height="5" fill="#1f2937"/><rect x="6" y="2" width="1" height="5" fill="#1f2937"/><rect x="3" y="3" width="1" height="1" fill="#1f2937"/><rect x="4" y="4" width="1" height="1" fill="#1f2937"/><rect x="5" y="5" width="1" height="1" fill="#1f2937"/>',
  plug: '<rect x="2" y="0" width="1" height="3" fill="#9aa3ad"/><rect x="6" y="0" width="1" height="3" fill="#9aa3ad"/><rect x="1" y="3" width="7" height="3" fill="#6b7280"/><rect x="3" y="6" width="3" height="1" fill="#6b7280"/><rect x="4" y="7" width="1" height="2" fill="#4b5563"/>',
  drive: '<rect x="3" y="1" width="3" height="1" fill="#2eb67d"/><rect x="2" y="2" width="3" height="2" fill="#2eb67d"/><rect x="5" y="2" width="2" height="2" fill="#ecb22e"/><rect x="1" y="4" width="3" height="2" fill="#2eb67d"/><rect x="6" y="4" width="2" height="2" fill="#ecb22e"/><rect x="0" y="6" width="2" height="1" fill="#2eb67d"/><rect x="2" y="6" width="7" height="2" fill="#36c5f0"/>',
  skill: '<rect x="1" y="1" width="7" height="1" fill="#a07c3c"/><rect x="0" y="2" width="9" height="5" fill="#f3e2b3"/><rect x="1" y="7" width="7" height="1" fill="#a07c3c"/><rect x="2" y="3" width="5" height="1" fill="#b08d4f"/><rect x="2" y="5" width="3" height="1" fill="#b08d4f"/>',
};
const SEVERITY_LABELS = { critical: 'Crítica', high: 'Alta', normal: 'Normal', low: 'Baixa' };
const SEVERITY_ORDER = ['critical', 'high', 'normal', 'low'];
const KIND_LABELS = { bug: 'Bug', improvement: 'Melhoria', idea: 'Ideia' };
const DEED_LABELS = { round: 'Ronda', error: 'Ronda falhou', taken: 'Missão levada', dismissed: 'Missão descartada' };
const INTERVALS = [
  [15, 'a cada 15 min'],
  [30, 'a cada 30 min'],
  [60, 'a cada 1 h'],
  [120, 'a cada 2 h'],
  [240, 'a cada 4 h'],
  [1440, '1 vez por dia'],
];
const NEW_ROUTINE = { id: '', label: 'Ronda do expediente', isOn: true, everyMinutes: 60, fromHour: 9, toHour: 18, isWeekdaysOnly: true, focus: '', connectors: [], lastRunAt: null };
const KNIGHT_HORSE = ['#d8d0c0', '#b0a690', '#6b6255'];
const DAY_MS = 24 * 60 * 60 * 1000;
const HERO_FRAME_MS = 120;
const HERO_3D_FRAME_MS = 1000 / 30; // the 3D hero turns: smoother than the pixel art's flaps
const TIPS_COLLAPSED_KEY = 'cpo.scoutTipsCollapsed';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className, text, onClick) {
  const node = el('button', className, text);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

function readTipsCollapsed() {
  try {
    return localStorage.getItem(TIPS_COLLAPSED_KEY) === '1';
  } catch {
    return false; // storage blocked: start open
  }
}

function icon(name) {
  const template = document.createElement('template');
  template.innerHTML = `<svg viewBox="0 0 9 9" width="18" height="18" aria-hidden="true" shape-rendering="crispEdges">${ICONS[name]}</svg>`;
  return template.content.firstElementChild;
}

function connectorIcon(id) {
  if (id !== 'slack') return icon(['gmail', 'notion', 'drive'].includes(id) ? id : 'plug');
  const canvas = el('canvas');
  canvas.width = 9;
  canvas.height = 9;
  canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  drawSlackShield(ctx, 1, 0);
  return canvas;
}

// The settings' switch: a hidden checkbox and the track drawn after it.
function switchLabel(isOn, text, onChange) {
  const label = el('label', 'toggle');
  const input = el('input');
  input.type = 'checkbox';
  input.setAttribute('role', 'switch');
  input.checked = isOn;
  input.addEventListener('change', () => onChange(input.checked));
  const track = el('span', 'toggle-track');
  track.setAttribute('aria-hidden', 'true');
  label.append(input, track, text);
  return label;
}

function levelTitle(level) {
  return LEVEL_TITLES[Math.min(level, LEVEL_TITLES.length) - 1];
}

function armorTier(level) {
  return level >= 7 ? 3 : level >= 5 ? 2 : level >= 3 ? 1 : 0;
}

function ago(at) {
  return `há ${formatElapsed(at)}`;
}

function intervalText(minutes) {
  return INTERVALS.find(([value]) => value === minutes)?.[1] ?? `a cada ${minutes} min`;
}

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** When a routine rides out next, as the backend's minute check will see it (local time); null when off. */
export function nextRunAt(routine, now = Date.now()) {
  if (!routine.isOn) return null;
  let at = Math.max(now, (routine.lastRunAt ?? 0) + routine.everyMinutes * 60_000);
  for (let step = 0; step < 16; step++) {
    const date = new Date(at);
    const isDay = !routine.isWeekdaysOnly || (date.getDay() !== 0 && date.getDay() !== 6);
    if (isDay && date.getHours() >= routine.fromHour && date.getHours() < routine.toHour) return at;
    const next = new Date(date);
    if (!isDay || date.getHours() >= routine.toHour) next.setDate(next.getDate() + 1);
    next.setHours(routine.fromHour, 0, 0, 0);
    at = next.getTime();
  }
  return null;
}

/** "agora", "hoje 14:00", "amanhã 09:00" or "seg 09:00". */
function whenText(at, now = Date.now()) {
  if (at - now < 60_000) return 'agora';
  const date = new Date(at);
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  const days = Math.round((new Date(at).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / DAY_MS);
  if (days === 0) return `hoje ${time}`;
  if (days === 1) return `amanhã ${time}`;
  return `${WEEKDAYS[date.getDay()]} ${time}`;
}

function scheduleText(routine) {
  return `${intervalText(routine.everyMinutes)}, das ${routine.fromHour}h às ${routine.toHour}h, ${routine.isWeekdaysOnly ? 'de segunda a sexta' : 'todos os dias'}`;
}

/** What a routine's card says about its schedule: the next round and the last one. */
function routineState(routine) {
  const last = routine.lastRunAt ? `última ${ago(routine.lastRunAt)}` : 'ainda não rodou';
  if (!routine.isOn) return { text: 'Desligada: não sai sozinha', last };
  const next = nextRunAt(routine);
  return { text: next ? `Próxima ronda: ${whenText(next)}` : 'Sem horário possível', last };
}

/** Missions still open, per base: { count, isUrgent }; the map's parchments come from it. */
export function missionsByBase(state) {
  const byBase = new Map();
  for (const mission of state?.missions ?? []) {
    if (mission.status !== 'open') continue;
    for (const repo of mission.repos) {
      const entry = byBase.get(repo) ?? { count: 0, isUrgent: false };
      entry.count += 1;
      entry.isUrgent ||= mission.severity === 'critical' || mission.severity === 'high';
      byBase.set(repo, entry);
    }
  }
  return byBase;
}

// getHero3d: the 3D map when it is on screen (the equipment window then shows the hero in 3D), else null.
export function createScout({ invoke, showToast, getBases, displayName, onTrain, onState, onFocus, onShowPanel, getHero3d = () => null }) {
  const dialog = document.getElementById('scout');
  const backdrop = document.getElementById('scout-backdrop');
  const sendButton = document.getElementById('scout-send');
  const statusEl = document.getElementById('scout-status');
  const rankEl = document.getElementById('scout-rank');
  const xpEl = document.getElementById('scout-xp');
  const missionsEl = document.getElementById('scout-missions');
  const filterEl = document.getElementById('scout-filter');
  const detailEl = document.getElementById('ro-detail');
  const bagEl = document.getElementById('ro-bag');
  const journalEl = document.getElementById('scout-journal');
  const badge = document.getElementById('scout-badge');
  const strip = document.getElementById('scout-strip');
  const tabs = [...dialog.querySelectorAll('.scout-tab')];
  const roTabs = [...dialog.querySelectorAll('.ro-tab')];

  let state = null;
  let skills = null; // the user's Claude Code skills, read when the equipment window first opens
  let linked = null; // connectors linked to the user's Claude account: the bag
  let draft = null; // equipment being edited, saved with "Salvar equipamento"
  let selectedSlot = 'shield';
  const openFlows = new Set(); // routines (by index) whose form is open in the Rotinas tab
  let heroTimer = null;
  let filterProject = null;
  let returnFocus = null;
  let lastVillage = '';
  let isTipsCollapsed = readTipsCollapsed();

  drawIcon();

  function drawIcon() {
    const canvas = document.getElementById('scout-icon');
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    drawSlackShield(ctx, 3, 2);
  }

  function knightLook() {
    return { ...makeLook('knight:batedor', 'knight:batedor', 'knight'), horse: KNIGHT_HORSE };
  }

  function drawPortrait() {
    const canvas = document.getElementById('scout-portrait');
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawKnightPortrait(ctx, knightLook(), 32, 66, performance.now() / 1000, state?.level ?? 1);
  }

  // The knight in the middle of the window, with its aura, the pennant flapping while it is open. In
  // 3D it is the map's own hero, turning; elsewhere, the pixel art.
  function drawHero() {
    const canvas = document.getElementById('ro-hero');
    const canvas3d = document.getElementById('ro-hero-3d');
    const world3d = getHero3d();
    canvas.hidden = Boolean(world3d);
    canvas3d.hidden = !world3d;
    if (world3d) {
      world3d.renderHeroPreview(canvas3d, { ...knightLook(), tunic: KNIGHT_ARMOR[knightTier(state?.level ?? 1)].base }, performance.now() / 1000);
      return;
    }
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const t = performance.now() / 1000;
    drawKnightAura(ctx, 36, 66, t, 0, 2);
    drawKnightPortrait(ctx, knightLook(), 36, 66, t, state?.level ?? 1);
  }

  // ---------- State from the backend ----------

  function apply(next) {
    const wasScouting = state?.isScouting;
    const previousRound = state?.lastRound?.at;
    state = next;
    onState({ level: state.level, isScouting: state.isScouting, missions: missionsByBase(state) });
    renderBadge();
    renderStrip();
    if (wasScouting && !state.isScouting && state.lastRound && state.lastRound.at !== previousRound) announceRound();
    if (!dialog.hidden) render();
  }

  function announceRound() {
    const round = state.lastRound;
    if (round.error) {
      showToast(`O batedor voltou sem relatório: ${round.error}`, true);
      return;
    }
    if (round.newMissions === 0) {
      showToast('O batedor voltou: nenhuma missão nova');
      return;
    }
    const text = `O batedor voltou com ${round.newMissions} ${round.newMissions === 1 ? 'missão nova' : 'missões novas'}`;
    showToast(text, false, { label: 'Ver', onClick: () => open({ tab: 'scout-tab-missions' }) });
  }

  function renderBadge() {
    const open = state.missions.filter((mission) => mission.status === 'open');
    badge.hidden = open.length === 0;
    badge.textContent = String(open.length);
    badge.classList.toggle('is-urgent', open.some((mission) => mission.severity === 'critical' || mission.severity === 'high'));
    document.getElementById('scout-open').classList.toggle('is-out', state.isScouting);
  }

  // The routines ride out with the bases on the map, so the backend keeps the list current.
  function syncVillage() {
    const bases = getBases();
    const key = bases.join('|');
    if (key === lastVillage) return;
    lastVillage = key;
    invoke('set_scout_village', { bases }).catch(() => {});
  }

  // ---------- In the side panel ----------

  // The scout as the main character, on top of the agents: portrait, level, what it is doing and when
  // it rides next, what it carries; then its open missions as suggestions to train a villager with.
  function renderStrip() {
    const missions = state.missions
      .filter((mission) => mission.status === 'open')
      .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
    strip.hidden = false;
    if (!missions.length) {
      strip.replaceChildren(heroCard(), el('p', 'scout-tips-title', 'Nenhuma missão aberta'));
      return;
    }
    const title = button('scout-tips-title scout-tips-toggle', undefined, toggleTips);
    title.setAttribute('aria-expanded', String(!isTipsCollapsed));
    title.title = isTipsCollapsed ? 'Mostrar as sugestões' : 'Recolher as sugestões';
    title.append(el('span', 'group-caret', isTipsCollapsed ? '▸' : '▾'), el('span', undefined, `Sugestões (${missions.length})`));
    if (isTipsCollapsed) {
      strip.replaceChildren(heroCard(), title);
      return;
    }
    const list = el('ul', 'scout-tips');
    list.append(...missions.map(tipCard));
    strip.replaceChildren(heroCard(), title, list);
  }

  function toggleTips() {
    isTipsCollapsed = !isTipsCollapsed;
    try {
      localStorage.setItem(TIPS_COLLAPSED_KEY, isTipsCollapsed ? '1' : '0');
    } catch {
      // collapsing still works for this run
    }
    renderStrip();
    strip.querySelector('.scout-tips-toggle')?.focus(); // the button was rebuilt
  }

  function heroCard() {
    const card = el('div', 'hero-card');
    const portrait = button('hero-portrait', undefined, () => open({ tab: 'scout-tab-equipment' }));
    portrait.setAttribute('aria-label', 'Abrir o equipamento do Batedor');
    portrait.title = 'Equipamento (tecla K)';
    const canvas = el('canvas');
    canvas.width = 64;
    canvas.height = 68;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    drawKnightPortrait(ctx, knightLook(), 32, 66, 0.3, state.level);
    portrait.append(canvas);
    const level = state.level;
    const from = LEVEL_XP[level - 1];
    const to = LEVEL_XP[level] ?? null;
    const info = el('div', 'hero-info');
    const name = el('p', 'hero-name');
    name.append(el('strong', null, 'O Batedor'), el('span', null, levelTitle(level)));
    const xp = el('div', 'hero-xp');
    xp.title = to ? `${state.xp} de ${to} de experiência` : `${state.xp} de experiência`;
    const bar = el('span');
    bar.style.width = to ? `${((state.xp - from) / (to - from)) * 100}%` : '100%';
    xp.append(bar);
    info.append(name, el('p', 'hero-level', `Nível ${level} · ${to ? `${state.xp}/${to}` : state.xp} XP`), xp, el('p', 'hero-state', heroState()), heroGear());
    const actions = el('div', 'hero-actions');
    const sendNow = button('btn btn-primary', state.isScouting ? 'Em campo…' : 'Enviar', send);
    sendNow.disabled = state.isScouting;
    actions.append(
      sendNow,
      button('btn', 'Rotinas', () => open({ tab: 'scout-tab-routines' })),
      button('btn', 'Habilidades', () => open({ tab: 'scout-tab-abilities' })),
      button('btn btn-ghost', 'Ir até ele', () => onFocus()),
    );
    card.append(portrait, info, actions);
    return card;
  }

  // In one line: out reading, or patrolling and when it rides next.
  function heroState() {
    if (state.isScouting) return statusText();
    const next = state.equipment.routines.map((routine) => nextRunAt(routine)).filter(Boolean).sort((a, b) => a - b)[0];
    const on = state.equipment.connectors.filter((c) => c.isOn).length;
    if (on === 0) return 'Sem fonte equipada: abra o equipamento';
    return next ? `Patrulhando · próxima ronda ${whenText(next)}` : 'Patrulhando · sai quando você mandar';
  }

  // What it carries, as small icons: the sources it reads, its skills, its routines.
  function heroGear() {
    const gear = el('div', 'hero-gear');
    for (const connector of state.equipment.connectors.filter((c) => c.isOn)) {
      const item = el('span', 'hero-gear-item');
      item.title = `${CONNECTORS.find((c) => c.id === connector.id)?.name ?? connector.id}: ${connector.targets}`;
      item.append(connectorIcon(connector.id));
      gear.append(item);
    }
    for (const skill of state.equipment.skills) {
      const item = el('span', 'hero-gear-item');
      item.title = `Skill: ${skill}`;
      item.append(icon('skill'));
      gear.append(item);
    }
    state.equipment.routines.forEach((routine, index) => {
      const item = el('span', 'hero-gear-item');
      item.classList.toggle('is-off', !routine.isOn);
      item.title = `${routine.label}: ${scheduleText(routine)}`;
      item.append(icon(index === 0 ? 'ring' : 'amulet'));
      gear.append(item);
    });
    return gear;
  }

  function tipCard(mission) {
    const item = el('li', 'mission scout-tip');
    item.dataset.severity = mission.severity;
    const head = el('div', 'mission-head');
    head.append(el('span', 'mission-severity', SEVERITY_LABELS[mission.severity] ?? mission.severity), el('span', 'mission-kind', KIND_LABELS[mission.kind] ?? mission.kind));
    for (const repo of mission.repos) head.append(el('span', 'mission-repo', displayName(repo)));
    item.append(head, el('strong', 'mission-title', mission.title), el('p', 'mission-why', mission.why));
    const actions = el('div', 'mission-actions');
    for (const repo of mission.repos) {
      const train = button('btn btn-primary', `Treinar em ${displayName(repo)}`, () => onTrain(mission, repo));
      train.title = 'Abre o Novo agente com a tarefa preenchida: leia e ajuste antes de mandar';
      actions.append(train);
    }
    actions.append(button('btn btn-ghost', 'Descartar', () => setStatus(mission, 'dismissed')));
    item.append(actions);
    return item;
  }

  // From the bottom bar: the side panel opens on the scout's card, lit up for a moment.
  function showStrip() {
    if (!state) return;
    renderStrip();
    onShowPanel();
    strip.classList.remove('is-lit');
    void strip.offsetWidth; // restart the glow when clicked again
    strip.classList.add('is-lit');
  }

  // ---------- Panel ----------

  function render() {
    drawPortrait();
    const level = state.level;
    const from = LEVEL_XP[level - 1];
    const to = LEVEL_XP[level] ?? null;
    rankEl.textContent = `${levelTitle(level)} · nível ${level}`;
    xpEl.querySelector('span').style.width = to ? `${((state.xp - from) / (to - from)) * 100}%` : '100%';
    xpEl.setAttribute('aria-valuenow', String(state.xp));
    xpEl.title = to ? `${state.xp} de ${to} de experiência para ${levelTitle(level + 1)}` : `${state.xp} de experiência: nível máximo`;
    document.getElementById('scout-xp-text').textContent = to ? `${state.xp} / ${to} XP` : `${state.xp} XP`;
    statusEl.textContent = statusText();
    statusEl.classList.toggle('is-error', Boolean(state.lastRound?.error) && !state.isScouting);
    const hasConnector = state.equipment.connectors.some((connector) => connector.isOn);
    sendButton.disabled = state.isScouting || !hasConnector;
    sendButton.textContent = state.isScouting ? 'Em campo…' : 'Enviar batedor';
    sendButton.title = hasConnector ? 'Uma ronda agora pelas fontes equipadas' : 'Equipe um conector primeiro: escudo (Slack), lança (Gmail) ou capa (Notion)';
    renderMissions();
    renderJournal();
    renderEquipment();
    renderFlows();
    renderAbilities();
  }

  function statusText() {
    if (state.isScouting) {
      const names = state.equipment.connectors.filter((c) => c.isOn).map((c) => CONNECTORS.find((known) => known.id === c.id)?.name ?? c.id);
      return `Em campo, lendo ${names.join(', ')}…`;
    }
    const round = state.lastRound;
    if (!round) {
      return state.equipment.connectors.some((c) => c.isOn) ? 'Pronto para a primeira ronda.' : 'Sem equipamento ainda: comece pelo escudo (Slack).';
    }
    if (round.error) return `Última ronda ${ago(round.at)}: ${round.error}`;
    const found = round.newMissions === 0 ? 'nenhuma missão nova' : `${round.newMissions} ${round.newMissions === 1 ? 'missão nova' : 'missões novas'}`;
    const parts = [`Última ronda ${ago(round.at)}${round.routine ? ` (${round.routine})` : ''}: ${found}`];
    if (round.updatedMissions > 0) parts.push(`${round.updatedMissions} com novidade`);
    if (round.costUsd) parts.push(`≈ US$ ${round.costUsd.toFixed(2).replace('.', ',')} em tokens`);
    const missing = [...round.unavailable.map((id) => CONNECTORS.find((c) => c.id === id)?.name ?? id), ...round.unreadable];
    if (missing.length > 0) parts.push(`não consegui ler: ${missing.join(', ')}`);
    return `${parts.join(' · ')}.`;
  }

  function renderMissions() {
    const inView = state.missions.filter((mission) => !filterProject || mission.repos.includes(filterProject));
    const open = inView.filter((mission) => mission.status === 'open');
    const closed = inView.filter((mission) => mission.status !== 'open');
    document.getElementById('scout-missions-count').textContent = String(state.missions.filter((m) => m.status === 'open').length);
    filterEl.hidden = !filterProject;
    if (filterProject) filterEl.querySelector('span').textContent = `Só ${displayName(filterProject)}`;
    const items = open.map(missionCard);
    if (open.length === 0) {
      const empty = state.missions.length === 0 && !state.lastRound ? 'Nenhuma missão ainda. Envie o batedor para a primeira ronda.' : 'Nenhuma missão aberta. A aldeia está em dia.';
      items.push(el('li', 'scout-empty', filterProject ? 'Nenhuma missão aberta para esta base.' : empty));
    }
    if (closed.length > 0) {
      const item = el('li', 'scout-closed');
      const details = el('details');
      details.append(el('summary', null, `Levadas e descartadas (${closed.length})`));
      const list = el('ul', 'scout-missions');
      list.append(...closed.map(missionCard));
      details.append(list);
      item.append(details);
      items.push(item);
    }
    missionsEl.replaceChildren(...items);
  }

  function missionCard(mission) {
    const item = el('li', 'mission');
    item.dataset.severity = mission.severity;
    item.dataset.status = mission.status;
    const head = el('div', 'mission-head');
    head.append(el('span', 'mission-severity', SEVERITY_LABELS[mission.severity] ?? mission.severity), el('span', 'mission-kind', KIND_LABELS[mission.kind] ?? mission.kind));
    for (const repo of mission.repos) head.append(el('span', 'mission-repo', displayName(repo)));
    const time = el('time', null, ago(mission.updatedAt));
    time.dateTime = new Date(mission.updatedAt).toISOString();
    head.append(time);
    item.append(head, el('strong', 'mission-title', mission.title), el('p', 'mission-why', mission.why));
    const sources = el('div', 'mission-sources');
    mission.sources.forEach((source, index) => {
      const link = button('link-button', `${source.label} ↗`, () => {
        invoke('open_mission_source', { id: mission.id, index }).catch((err) => showToast(String(err), true));
      });
      link.title = 'Abrir a mensagem de origem no navegador';
      sources.append(link);
    });
    const task = el('details', 'mission-task');
    task.append(el('summary', null, 'Tarefa para o aldeão'), el('p', null, mission.task));
    item.append(sources, task);
    const actions = el('div', 'mission-actions');
    if (mission.status === 'open') {
      for (const repo of mission.repos) {
        const train = button('btn btn-primary', `Treinar aldeão em ${displayName(repo)}`, () => {
          close();
          onTrain(mission, repo);
        });
        train.title = 'Abre o Novo agente com a tarefa preenchida: leia e ajuste antes de mandar';
        actions.append(train);
      }
      actions.append(button('btn btn-ghost', 'Descartar', () => setStatus(mission, 'dismissed')));
    } else {
      actions.append(el('span', 'mission-state', mission.status === 'started' ? 'Um aldeão levou esta missão' : 'Descartada'));
      actions.append(button('btn btn-ghost', 'Reabrir', () => setStatus(mission, 'open')));
    }
    item.append(actions);
    return item;
  }

  async function setStatus(mission, status, repo = null) {
    try {
      apply(await invoke('set_mission_status', { id: mission.id, status, repo }));
    } catch (err) {
      showToast(String(err), true);
    }
  }

  function renderJournal() {
    if (state.journal.length === 0) {
      journalEl.replaceChildren(el('li', 'scout-empty', 'Nada ainda: rondas e missões aparecem aqui, com a experiência que renderam.'));
      return;
    }
    journalEl.replaceChildren(
      ...state.journal.slice(0, 60).map((deed) => {
        const item = el('li', 'deed');
        item.dataset.kind = deed.kind;
        const time = el('time', null, ago(deed.at));
        time.dateTime = new Date(deed.at).toISOString();
        const text = el('span', null, deed.kind === 'round' || deed.kind === 'error' ? deed.text : `${DEED_LABELS[deed.kind]}: ${deed.text}`);
        item.append(time, text);
        if (deed.repos.length > 0) item.append(el('small', null, deed.repos.map(displayName).join(', ')));
        if (deed.xp > 0) item.append(el('strong', 'deed-xp', `+${deed.xp} XP`));
        return item;
      }),
    );
  }

  // ---------- Equipment: the Ragnarok window ----------

  function cloneEquipment() {
    const copy = structuredClone(state.equipment);
    for (const spec of CONNECTORS) {
      if (!copy.connectors.some((connector) => connector.id === spec.id)) copy.connectors.push({ id: spec.id, isOn: false, targets: '', slot: '' });
    }
    for (const routine of copy.routines) routine.connectors ??= []; // saved before routines chose their sources
    // Saved before slots existed: one that reads goes to its usual slot, if free.
    for (const connector of copy.connectors) {
      connector.slot ??= '';
      const usual = DEFAULT_CONNECTOR_SLOTS[connector.id];
      if (connector.isOn && !connector.slot && !copy.connectors.some((other) => other.slot === usual)) connector.slot = usual;
    }
    return copy;
  }

  function connectorIn(equip, slotId) {
    return equip.connectors.find((connector) => connector.slot === slotId) ?? null;
  }

  // Into a slot (from the bag or the slot's list); the one there goes back to the bag.
  function placeConnector(id, slotId) {
    const equip = edit();
    for (const connector of equip.connectors) if (connector.slot === slotId) Object.assign(connector, { slot: '', isOn: false });
    const connector = equip.connectors.find((c) => c.id === id);
    connector.slot = slotId;
    connector.isOn = connector.targets.trim() !== '';
    selectedSlot = slotId;
    renderEquipment();
  }

  function equipment() {
    return draft ?? cloneEquipment();
  }

  function edit() {
    draft ??= cloneEquipment();
    return draft;
  }

  function markDirty() {
    document.getElementById('ro-dirty').textContent = 'Alterações por salvar.';
  }

  // What a slot holds now: { name, note, icon, isLocked, isOff }, or null when it is empty.
  function slotItem(slot, equip) {
    if (slot.kind === 'skill') {
      if (slot.index >= state.skillSlots) return { name: `abre no nível ${SKILL_SLOT_LEVELS[slot.index]}`, icon: icon('lock'), isLocked: true };
      const skill = equip.skills[slot.index];
      return skill ? { name: skill, note: 'skill', icon: icon('skill') } : null;
    }
    if (slot.kind === 'connector') {
      const connector = connectorIn(equip, slot.id);
      if (!connector) return null;
      const spec = CONNECTORS.find((c) => c.id === connector.id);
      const note = connector.isOn ? connector.targets : connector.targets ? 'desligado' : 'diga o que ler';
      return { name: spec.name, note, icon: connectorIcon(spec.id), isOff: !connector.isOn };
    }
    if (slot.kind === 'routine') {
      const routine = equip.routines[slot.index];
      if (!routine) return null;
      const note = `${intervalText(routine.everyMinutes)} · ${routine.fromHour}h às ${routine.toHour}h${routine.isOn ? '' : ' · desligada'}`;
      return { name: routine.label || 'Rotina', note, icon: icon(slot.id), isOff: !routine.isOn };
    }
    return { name: `Armadura de ${ARMOR_NAMES[armorTier(state.level)].toLowerCase()}`, note: 'conquistada por nível', icon: icon('armor') };
  }

  function slotButton(slot, equip) {
    const item = slotItem(slot, equip);
    const node = button('ro-slot', undefined, () => {
      selectedSlot = slot.id;
      renderEquipment();
    });
    node.setAttribute('aria-pressed', String(selectedSlot === slot.id));
    node.classList.toggle('is-empty', !item);
    node.classList.toggle('is-locked', Boolean(item?.isLocked));
    node.classList.toggle('is-off', Boolean(item?.isOff));
    const iconBox = el('span', 'ro-slot-icon');
    iconBox.append(item?.icon ?? icon(slot.id === 'shield' ? 'plug' : slot.id));
    const text = el('span', 'ro-slot-text');
    text.append(el('span', 'ro-slot-name', item ? item.name : slot.name.toLowerCase()));
    if (item?.note) text.append(el('small', null, item.note));
    node.title = `${slot.name}: ${item ? item.name : 'vazio'}`;
    node.append(iconBox, text);
    const li = el('li');
    li.append(node);
    return li;
  }

  function renderEquipment() {
    if (!state) return;
    const equip = equipment();
    document.getElementById('ro-slots-left').replaceChildren(...SLOTS.filter((s) => s.side === 'left').map((slot) => slotButton(slot, equip)));
    document.getElementById('ro-slots-right').replaceChildren(...SLOTS.filter((s) => s.side === 'right').map((slot) => slotButton(slot, equip)));
    drawHero();
    renderStatus(equip);
    renderDetail(equip);
    renderBag(equip);
    document.getElementById('ro-dirty').textContent = draft ? 'Alterações por salvar.' : '';
  }

  // Ragnarok's six attributes, each one a real count of what the scout did.
  function renderStatus(equip) {
    const weekAgo = Date.now() - 7 * DAY_MS;
    const taken = state.journal.filter((d) => d.kind === 'taken').length;
    const dismissed = state.journal.filter((d) => d.kind === 'dismissed').length;
    const rounds = state.journal.filter((d) => d.kind === 'round');
    const urgent = state.missions.filter((m) => m.severity === 'critical' || m.severity === 'high').length;
    const precision = taken + dismissed > 0 ? `${Math.round((taken / (taken + dismissed)) * 100)}%` : '—';
    const to = LEVEL_XP[state.level] ?? null;
    const attributes = [
      ['FOR', taken, 'Força: missões que um aldeão levou'],
      ['AGI', rounds.filter((d) => d.at >= weekAgo).length, 'Agilidade: rondas nos últimos 7 dias'],
      ['VIT', rounds.length, 'Vitalidade: rondas que voltaram com relatório'],
      ['INT', equip.skills.length, 'Inteligência: skills que ele carrega'],
      ['DES', precision, 'Destreza: das missões que você decidiu, quantas levou'],
      ['SOR', urgent, 'Sorte: missões urgentes que ele achou'],
    ];
    const derived = [
      ['Nível', `${state.level} · ${levelTitle(state.level)}`],
      ['XP', to ? `${state.xp} / ${to}` : `${state.xp}`],
      ['Missões', state.missions.filter((m) => m.status === 'open').length],
      ['Fontes', `${equip.connectors.filter((c) => c.isOn).length} / ${CONNECTORS.length}`],
      ['Rotinas', `${equip.routines.filter((r) => r.isOn).length} / ${MAX_ROUTINES}`],
      ['Aldeia', `${state.village.length} bases`],
    ];
    const column = (rows) => {
      const list = el('dl', 'ro-stats');
      for (const [name, value, hint] of rows) {
        const row = el('div', 'ro-stat');
        if (hint) row.title = hint;
        row.append(el('dt', null, name), el('dd', null, String(value)));
        list.append(row);
      }
      return list;
    };
    document.getElementById('ro-status').replaceChildren(column(attributes), column(derived));
  }

  function renderDetail(equip) {
    const slot = SLOTS.find((s) => s.id === selectedSlot);
    const parts = [el('p', 'ro-detail-title', slot.name)];
    if (slot.kind === 'connector') parts.push(...connectorDetail(slot, equip));
    else if (slot.kind === 'skill') parts.push(...skillDetail(slot, equip));
    else if (slot.kind === 'routine') parts.push(...routineDetail(slot, equip));
    else parts.push(armorDetail());
    detailEl.replaceChildren(...parts);
  }

  // A list of every connector it can carry: the one in this slot pressed, the ones elsewhere movable.
  function connectorPicker(slot, equip) {
    const list = el('ul', 'ro-pick');
    for (const spec of CONNECTORS) {
      const connector = equip.connectors.find((c) => c.id === spec.id);
      const isHere = connector?.slot === slot.id;
      const elsewhere = connector?.slot && !isHere ? SLOTS.find((s) => s.id === connector.slot).name.toLowerCase() : null;
      const isLinked = !linked || linked.some((item) => item.id === spec.id);
      const pick = button('ro-pick-item', undefined, () => placeConnector(spec.id, slot.id));
      pick.setAttribute('aria-pressed', String(isHere));
      const note = isHere ? 'neste espaço' : elsewhere ? `está em: ${elsewhere} (trazer para cá)` : isLinked ? spec.hint : 'não aparece vinculado ao seu Claude';
      const text = el('span');
      text.append(el('strong', null, spec.name), el('small', null, note));
      pick.append(connectorIcon(spec.id), text);
      const item = el('li');
      item.append(pick);
      list.append(item);
    }
    return list;
  }

  function connectorDetail(slot, equip) {
    const connector = connectorIn(equip, slot.id);
    if (!connector) {
      return [el('p', 'ro-detail-hint', 'Um conector da sua conta do Claude, só para ler. Escolha qual vai neste espaço:'), connectorPicker(slot, equip)];
    }
    const spec = CONNECTORS.find((c) => c.id === connector.id);
    const toggle = switchLabel(connector.isOn, el('span', 'toggle-text', `Ler o ${spec.name}`), (isOn) => {
      edit().connectors.find((c) => c.id === spec.id).isOn = isOn;
      renderEquipment();
    });
    const field = el('input', 'field');
    field.type = 'text';
    field.spellcheck = false;
    field.value = connector.targets;
    field.placeholder = spec.placeholder;
    field.setAttribute('aria-label', `${spec.name}: ${spec.label}`);
    field.addEventListener('input', () => {
      edit().connectors.find((c) => c.id === spec.id).targets = field.value;
      markDirty();
    });
    field.addEventListener('change', renderEquipment);
    const parts = [el('p', 'ro-detail-item', spec.name), toggle, el('span', 'field-label', spec.label), field, el('small', 'ro-detail-hint', spec.hint)];
    if (linked && !linked.some((item) => item.id === spec.id)) {
      parts.push(el('p', 'ro-detail-warn', `O ${spec.name} não aparece vinculado ao seu Claude. Vincule em claude.ai › Configurações › Conectores.`));
    }
    const swap = el('details', 'ro-swap');
    swap.append(el('summary', null, 'Trocar por outro conector'), connectorPicker(slot, equip));
    parts.push(
      swap,
      button('btn btn-ghost', 'Tirar do espaço', () => {
        Object.assign(edit().connectors.find((c) => c.id === spec.id), { slot: '', isOn: false });
        renderEquipment();
      }),
    );
    return parts;
  }

  function skillDetail(slot, equip) {
    if (slot.index >= state.skillSlots) {
      const level = SKILL_SLOT_LEVELS[slot.index];
      return [el('p', 'ro-detail-hint', `Este espaço abre no nível ${level} (${levelTitle(level)}). Ele sobe trazendo missões que os aldeões levam.`)];
    }
    if (skills === null) return [el('p', 'ro-detail-hint', 'Lendo suas skills…')];
    if (skills.length === 0) return [el('p', 'ro-detail-hint', 'Nenhuma skill em ~/.claude/skills.')];
    const current = equip.skills[slot.index] ?? null;
    const list = el('ul', 'ro-pick');
    for (const skill of skills) {
      const isElsewhere = equip.skills.includes(skill.name) && skill.name !== current;
      const pick = button('ro-pick-item', undefined, () => {
        const chosen = edit().skills;
        if (slot.index < chosen.length) chosen[slot.index] = skill.name;
        else chosen.push(skill.name);
        renderEquipment();
      });
      pick.disabled = isElsewhere;
      pick.setAttribute('aria-pressed', String(skill.name === current));
      const text = el('span');
      text.append(el('strong', null, skill.name), el('small', null, isElsewhere ? 'já está em outro espaço' : skill.description));
      pick.append(icon('skill'), text);
      const item = el('li');
      item.append(pick);
      list.append(item);
    }
    const parts = [el('p', 'ro-detail-hint', 'As instruções da skill vão com ele em cada ronda e guiam como julga e escreve as missões.'), list];
    if (current) {
      parts.push(
        button('btn btn-ghost', 'Tirar a skill', () => {
          edit().skills.splice(slot.index, 1);
          renderEquipment();
        }),
      );
    }
    return parts;
  }

  // A jewel holds a routine; its flow (when, where, what, delivery) is edited in the Rotinas tab.
  function routineDetail(slot, equip) {
    const routine = equip.routines[slot.index];
    if (!routine) {
      return [
        el('p', 'ro-detail-hint', 'Uma rotina é um fluxo que roda sozinho: quando ele sai, onde lê, o que procura e o que entrega.'),
        button('btn btn-primary', 'Criar uma rotina', () => {
          edit().routines.push({ ...NEW_ROUTINE, connectors: [] });
          openFlows.add(draft.routines.length - 1);
          open({ tab: 'scout-tab-routines' });
        }),
      ];
    }
    const { text, last } = routineState(routine);
    return [
      el('p', 'ro-detail-item', routine.label || 'Rotina'),
      el('p', 'ro-detail-hint', `${scheduleText(routine)}. ${text} (${last}).`),
      button('btn btn-primary', 'Abrir o fluxo da rotina', () => open({ tab: 'scout-tab-routines' })),
    ];
  }

  function armorDetail() {
    const tiers = ARMOR_NAMES.map((name, index) => `${name.toLowerCase()} no nível ${[1, 3, 5, 7][index]}`).join(', ');
    return el('p', 'ro-detail-hint', `A armadura não se equipa: vem com a experiência (${tiers}). Agora: ${ARMOR_NAMES[armorTier(state.level)].toLowerCase()}.`);
  }

  // The bag: what the user's Claude has linked, and the skills it can carry.
  function renderBag(equip) {
    const connectorItems = el('ul', 'ro-bag-grid');
    if (linked === null) connectorItems.append(el('li', 'ro-bag-empty', 'Lendo…'));
    else if (linked.length === 0) connectorItems.append(el('li', 'ro-bag-empty', 'Nenhum conector vinculado. Vincule em claude.ai › Configurações › Conectores.'));
    for (const item of linked ?? []) {
      const connector = item.id ? equip.connectors.find((c) => c.id === item.id) : null;
      const slot = connector?.slot ? SLOTS.find((s) => s.id === connector.slot) : null;
      const status = !item.id ? 'sem leitura segura ainda' : slot ? `${connector.isOn ? 'equipado' : 'desligado'}: ${slot.name.toLowerCase()}` : 'clique para equipar';
      const tile = button('ro-item', undefined, () => {
        selectRoTab('ro-tab-general');
        if (slot) {
          selectedSlot = slot.id;
          renderEquipment();
          return;
        }
        const chosen = SLOTS.find((s) => s.id === selectedSlot && s.kind === 'connector' && !connectorIn(equip, s.id));
        const free = chosen ?? SLOTS.find((s) => s.kind === 'connector' && !connectorIn(equip, s.id));
        if (free) placeConnector(item.id, free.id);
        else showToast('Os quatro espaços de conector estão ocupados: tire um antes', true);
      });
      tile.disabled = !item.id;
      tile.classList.toggle('is-equipped', Boolean(connector?.isOn));
      tile.title = item.id ? `${item.name}: ${status}` : `${item.name}: o batedor ainda não sabe quais ferramentas dele só leem`;
      const text = el('span');
      text.append(el('strong', null, item.name), el('small', null, status));
      tile.append(connectorIcon(item.id), text);
      const li = el('li');
      li.append(tile);
      connectorItems.append(li);
    }
    const skillItems = el('ul', 'ro-bag-grid');
    if (skills === null) skillItems.append(el('li', 'ro-bag-empty', 'Lendo…'));
    else if (skills.length === 0) skillItems.append(el('li', 'ro-bag-empty', 'Nenhuma skill em ~/.claude/skills.'));
    for (const skill of skills ?? []) {
      const at = equip.skills.indexOf(skill.name);
      const tile = button('ro-item', undefined, () => equipSkill(skill.name));
      tile.classList.toggle('is-equipped', at >= 0);
      tile.title = skill.description;
      const slotName = at >= 0 ? SLOTS.find((s) => s.kind === 'skill' && s.index === at).name.toLowerCase() : null;
      const text = el('span');
      text.append(el('strong', null, skill.name), el('small', null, slotName ? `equipada: ${slotName}` : 'clique para equipar'));
      tile.append(icon('skill'), text);
      const li = el('li');
      li.append(tile);
      skillItems.append(li);
    }
    bagEl.replaceChildren(el('p', 'ro-bag-title', 'Conectores vinculados ao seu Claude'), connectorItems, el('p', 'ro-bag-title', 'Skills (~/.claude/skills)'), skillItems);
  }

  function equipSkill(name) {
    if (equipment().skills.includes(name)) return;
    if (equipment().skills.length >= state.skillSlots) {
      const next = SKILL_SLOT_LEVELS[state.skillSlots];
      showToast(next ? `Os espaços de skill estão cheios: o próximo abre no nível ${next}` : 'Os três espaços de skill estão cheios', true);
      return;
    }
    const chosen = edit().skills;
    chosen.push(name);
    selectedSlot = SLOTS.find((s) => s.kind === 'skill' && s.index === chosen.length - 1).id;
    renderEquipment();
  }

  async function saveEquipment() {
    if (!draft) {
      showToast('Nada mudou no equipamento');
      return true;
    }
    try {
      const saved = await invoke('set_scout_equipment', { equipment: draft });
      draft = null;
      apply(saved);
      renderEquipment();
      showToast('Batedor equipado');
      return true;
    } catch (err) {
      showToast(String(err), true);
      return false;
    }
  }

  // ---------- Routines: each one a flow ----------

  function renderFlows() {
    const equip = equipment();
    const flows = equip.routines.map((routine, index) => flowCard(routine, index, equip));
    if (flows.length === 0) flows.push(el('li', 'scout-empty', 'Sem rotinas: ele só sai quando você manda.'));
    document.getElementById('scout-flows').replaceChildren(...flows);
    document.getElementById('scout-flow-add').disabled = equip.routines.length >= MAX_ROUTINES;
  }

  // The sources a routine reads, by name: its own pick, or every one that is on.
  function sourceNames(routine, equip) {
    const ready = equip.connectors.filter((c) => c.isOn).map((c) => c.id);
    const reads = routine.connectors.length === 0 ? ready : routine.connectors.filter((id) => ready.includes(id));
    return reads.map((id) => CONNECTORS.find((c) => c.id === id)?.name ?? id);
  }

  // One line when closed (name, next round, schedule, sources); a short form when open.
  function flowCard(routine, index, equip) {
    const slot = SLOTS.find((s) => s.kind === 'routine' && s.index === index);
    const isOpen = openFlows.has(index);
    const change = (key, value, isRedraw = true) => {
      edit().routines[index][key] = value;
      if (isRedraw) renderFlows();
      else markDirty();
    };
    const card = el('li', 'flow');
    card.classList.toggle('is-off', !routine.isOn);
    const iconBox = el('span', 'ro-slot-icon');
    iconBox.append(icon(slot.id));
    const { text } = routineState(routine);
    const names = sourceNames(routine, equip);
    const summary = el('div', 'flow-summary');
    summary.append(
      el('strong', null, routine.label || 'Rotina sem nome'),
      el('small', null, `${text} · ${intervalText(routine.everyMinutes)}, ${routine.fromHour}h às ${routine.toHour}h${routine.isWeekdaysOnly ? ', seg a sex' : ''} · ${names.length ? `lê ${names.join(', ')}` : 'sem fonte ligada'}`),
    );
    const toggle = switchLabel(routine.isOn, el('span', 'sr-only', 'Rotina ligada'), (isOn) => change('isOn', isOn));
    toggle.title = routine.isOn ? 'Ligada: desligue para ela parar de sair sozinha' : 'Desligada';
    const run = button('btn', 'Rodar agora', () => runRoutine(index));
    run.disabled = state.isScouting;
    const more = button('btn btn-ghost', isOpen ? 'Fechar' : 'Editar', () => {
      if (isOpen) openFlows.delete(index);
      else openFlows.add(index);
      renderFlows();
    });
    more.setAttribute('aria-expanded', String(isOpen));
    const head = el('div', 'flow-head');
    head.append(iconBox, summary, toggle, run, more);
    card.append(head);
    if (isOpen) card.append(flowForm(routine, index, equip, change));
    return card;
  }

  function flowForm(routine, index, equip, change) {
    const form = el('div', 'flow-form');
    const name = el('input', 'field');
    name.type = 'text';
    name.value = routine.label;
    name.maxLength = 40;
    name.setAttribute('aria-label', 'Nome da rotina');
    name.addEventListener('input', () => change('label', name.value, false));
    name.addEventListener('change', renderFlows);
    const prompt = el('textarea', 'field');
    prompt.rows = 3;
    prompt.maxLength = 1000;
    prompt.value = routine.focus;
    prompt.placeholder = 'Opcional. Ex.: só bugs críticos e altos do #ac-tickets.';
    prompt.setAttribute('aria-label', 'O que esta rotina procura');
    prompt.addEventListener('input', () => change('focus', prompt.value, false));
    const preview = button('link-button', 'Ver o texto completo', async () => {
      if (draft && !(await saveEquipment())) return;
      const routineId = state.equipment.routines[index]?.id;
      const pre = form.querySelector('pre') ?? el('pre', 'flow-prompt');
      form.append(pre);
      loadPrompt(pre, routineId);
    });
    const remove = button('link-button', 'Tirar a rotina', () => {
      edit().routines.splice(index, 1);
      openFlows.clear();
      renderFlows();
      renderEquipment();
    });
    const links = el('div', 'flow-links');
    links.append(preview, remove);
    form.append(flowRow('Nome', name), flowRow('Quando', scheduleControls(routine, change)), flowRow('Lê', sourceChips(routine, index, equip)), flowRow('Procura', prompt), links);
    return form;
  }

  function flowRow(label, control) {
    const row = el('div', 'flow-row');
    row.append(el('span', 'flow-label', label), control);
    return row;
  }

  function scheduleControls(routine, change) {
    const every = el('select', 'field');
    every.setAttribute('aria-label', 'Frequência');
    for (const [minutes, text] of INTERVALS) {
      const option = el('option', null, text);
      option.value = String(minutes);
      option.selected = minutes === routine.everyMinutes;
      every.append(option);
    }
    every.addEventListener('change', () => change('everyMinutes', Number(every.value)));
    const hours = (value, key, label) => {
      const select = el('select', 'field');
      select.setAttribute('aria-label', label);
      for (let hour = key === 'fromHour' ? 0 : 1; hour <= (key === 'fromHour' ? 23 : 24); hour++) {
        const option = el('option', null, `${hour}h`);
        option.value = String(hour);
        option.selected = hour === value;
        select.append(option);
      }
      select.addEventListener('change', () => change(key, Number(select.value)));
      return select;
    };
    const weekdays = el('label', 'scout-weekdays');
    const weekdaysInput = el('input');
    weekdaysInput.type = 'checkbox';
    weekdaysInput.checked = routine.isWeekdaysOnly;
    weekdaysInput.addEventListener('change', () => change('isWeekdaysOnly', weekdaysInput.checked));
    weekdays.append(weekdaysInput, el('span', null, 'seg a sex'));
    const line = el('div', 'flow-line');
    line.append(every, hours(routine.fromHour, 'fromHour', 'Começa às'), el('span', null, 'às'), hours(routine.toHour, 'toHour', 'Termina às'), weekdays);
    return line;
  }

  // Only the sources that are on: pick the ones this routine reads (none picked reads them all).
  function sourceChips(routine, index, equip) {
    const ready = equip.connectors.filter((c) => c.isOn).map((c) => c.id);
    const line = el('div', 'flow-line');
    if (ready.length === 0) {
      line.append(
        button('link-button', 'Equipar uma fonte', () => {
          selectTab('scout-tab-equipment');
          selectRoTab('ro-tab-general');
          renderEquipment();
        }),
      );
      return line;
    }
    for (const id of ready) {
      const spec = CONNECTORS.find((c) => c.id === id);
      const isPicked = routine.connectors.length === 0 || routine.connectors.includes(id);
      const chip = button('flow-chip', undefined, () => {
        const picked = routine.connectors.length === 0 ? [...ready] : [...routine.connectors];
        const next = isPicked ? picked.filter((other) => other !== id) : [...picked, id];
        if (next.length === 0) return; // a routine reads at least one source
        edit().routines[index].connectors = next.length === ready.length ? [] : next;
        renderFlows();
      });
      chip.setAttribute('aria-pressed', String(isPicked));
      chip.append(connectorIcon(id), el('span', null, spec?.name ?? id));
      line.append(chip);
    }
    return line;
  }

  async function runRoutine(index) {
    if (draft && !(await saveEquipment())) return;
    const routine = state.equipment.routines[index];
    if (!routine?.id) return;
    try {
      await invoke('run_routine', { id: routine.id });
      showToast(`O batedor saiu na rotina ${routine.label || 'sem nome'}`);
    } catch (err) {
      showToast(String(err), true);
    }
  }

  async function loadPrompt(pre, routineId = null) {
    pre.textContent = 'Montando o texto da próxima ronda…';
    try {
      pre.textContent = await invoke('scout_prompt', { routineId });
    } catch (err) {
      pre.textContent = `Não consegui montar o texto: ${err}`;
    }
  }

  // ---------- Abilities: what it can do, and the rules it follows ----------

  function renderAbilities() {
    const equip = state.equipment;
    const abilities = [];
    for (const connector of equip.connectors.filter((c) => c.isOn)) {
      const spec = CONNECTORS.find((c) => c.id === connector.id);
      const slot = SLOTS.find((s) => s.id === connector.slot);
      abilities.push([connectorIcon(connector.id), `Lê o ${spec?.name ?? connector.id}`, `${connector.targets}${slot ? ` · ${slot.name.toLowerCase()}` : ''}`]);
    }
    for (const name of equip.skills) {
      const skill = skills?.find((s) => s.name === name);
      abilities.push([icon('skill'), `Skill: ${name}`, skill?.description ?? 'Instruções que ele carrega em toda ronda.']);
    }
    abilities.push(
      [icon('helm'), 'Triagem', 'Separa o que pode virar código de conversa e aviso, junta relatos repetidos numa missão só e dá a gravidade: crítica, alta, normal ou baixa.'],
      [icon('lance'), 'Roteamento', 'Manda cada missão para a base certa, lendo o README e o stack de cada uma; uma demanda de tela e de motor vai para as duas.'],
      [icon('skill'), 'Tarefa pronta', 'Escreve em português o pedido do aldeão: o que está errado ou é desejado, por onde começar, como saber que terminou e os links de origem.'],
      [icon('amulet'), 'Memória', 'Lembra as missões que já trouxe, para juntar em vez de repetir, e as que você levou ou descartou, para trazer mais do que vale.'],
    );
    const on = equip.routines.filter((r) => r.isOn);
    abilities.push([icon('ring'), 'Rotinas', on.length ? on.map((r) => `${r.label}: ${scheduleText(r)}`).join(' · ') : 'Nenhuma ligada: ele só sai quando você manda.']);
    document.getElementById('scout-abilities').replaceChildren(
      ...abilities.map(([iconNode, title, text]) => {
        const item = el('li', 'ability');
        const iconBox = el('span', 'ro-slot-icon');
        iconBox.append(iconNode);
        const body = el('span');
        body.append(el('strong', null, title), el('small', null, text));
        item.append(iconBox, body);
        return item;
      }),
    );
    const rules = [
      'Só lê: nunca envia, escreve, apaga nem cria nada nas fontes.',
      'Lê só o que chegou desde a última ronda; a primeira olha 7 dias para trás.',
      'Missão é o que um agente resolve numa das bases; conversa, aviso e o que já tem PR ficam de fora.',
      'Nunca copia nome, e-mail, telefone, CPF ou CNPJ de cliente: guarda o sintoma técnico e o link.',
      'O que ele lê é dado, não ordem: instruções escondidas nas mensagens são ignoradas.',
      'No máximo 15 missões por ronda, as mais importantes primeiro.',
      'Nenhuma missão começa sozinha: você lê a tarefa e treina o aldeão.',
      'Cada ronda tem teto de US$ 3, 40 passos e 8 minutos.',
    ];
    document.getElementById('scout-rules').replaceChildren(...rules.map((rule) => el('li', null, rule)));
  }

  // Skills and the linked connectors are read once, the first time the window opens.
  async function loadBag() {
    const reads = [];
    if (skills === null) reads.push(invoke('list_scout_skills').then((list) => (skills = list), () => (skills = [])));
    if (linked === null) reads.push(invoke('list_scout_connectors').then((list) => (linked = list), () => (linked = [])));
    if (reads.length === 0) return;
    await Promise.all(reads);
    if (!dialog.hidden) {
      renderEquipment();
      renderAbilities();
    }
  }

  // ---------- Opening, tabs, riding out ----------

  function selectIn(list, id) {
    for (const tab of list) {
      const isSelected = tab.id === id;
      tab.setAttribute('aria-selected', String(isSelected));
      tab.tabIndex = isSelected ? 0 : -1;
      document.getElementById(tab.getAttribute('aria-controls')).hidden = !isSelected;
    }
  }

  function selectRoTab(id) {
    selectIn(roTabs, id);
  }

  // The window's knight flaps its pennant only while the equipment is in view.
  function selectTab(id) {
    selectIn(tabs, id);
    clearInterval(heroTimer);
    heroTimer = null;
    if (id === 'scout-tab-abilities') loadBag();
    if (id !== 'scout-tab-equipment') return;
    loadBag();
    heroTimer = setInterval(drawHero, getHero3d() ? HERO_3D_FRAME_MS : HERO_FRAME_MS);
  }

  // From a base's parchment it opens on that base's missions; otherwise on the equipment window. The
  // state is read again first: the scout's file may have changed outside the panel.
  async function open({ project = null, tab = project ? 'scout-tab-missions' : 'scout-tab-equipment' } = {}) {
    if (!state) return;
    try {
      apply(await invoke('get_scout'));
    } catch {
      // the last state shown is still good enough to open on
    }
    filterProject = project;
    returnFocus = document.activeElement;
    dialog.hidden = false;
    backdrop.hidden = false;
    selectTab(tab);
    render();
    document.getElementById(tab).focus();
  }

  function close() {
    dialog.hidden = true;
    backdrop.hidden = true;
    clearInterval(heroTimer);
    heroTimer = null;
    draft = null; // unsaved equipment is dropped, as with Cancelar
    returnFocus?.focus?.();
  }

  async function send() {
    syncVillage();
    try {
      await invoke('start_scout', { bases: getBases() });
      showToast('O batedor saiu em ronda');
    } catch (err) {
      showToast(String(err), true);
    }
  }

  /** After "Treinar aldeão": the villager took the mission (and the scout earns for it). */
  function taken(mission, project) {
    setStatus(mission, 'started', project);
  }

  sendButton.addEventListener('click', send);
  document.getElementById('scout-flow-add').addEventListener('click', () => {
    edit().routines.push({ ...NEW_ROUTINE, connectors: [] });
    openFlows.add(draft.routines.length - 1);
    renderFlows();
    renderEquipment();
  });
  document.getElementById('scout-flows-save').addEventListener('click', saveEquipment);
  const fullPrompt = document.getElementById('scout-prompt');
  fullPrompt.addEventListener('toggle', () => {
    if (fullPrompt.open) loadPrompt(document.getElementById('scout-prompt-text'));
  });
  document.getElementById('scout-equip-save').addEventListener('click', saveEquipment);
  filterEl.querySelector('button').addEventListener('click', () => {
    filterProject = null;
    renderMissions();
  });
  const arrowKeys = (list, select) => (event) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const index = list.findIndex((tab) => tab.getAttribute('aria-selected') === 'true');
    const next = list[(index + (event.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length];
    select(next.id);
    next.focus();
  };
  for (const tab of tabs) tab.addEventListener('click', () => selectTab(tab.id));
  for (const tab of roTabs) tab.addEventListener('click', () => selectRoTab(tab.id));
  dialog.querySelector('.scout-tabs').addEventListener('keydown', arrowKeys(tabs, selectTab));
  dialog.querySelector('.ro-tabs').addEventListener('keydown', arrowKeys(roTabs, selectRoTab));
  // The bottom bar's button: a click brings the camera to it and shows its suggestions in the side
  // panel, a double click opens the full panel.
  const barButton = document.getElementById('scout-open');
  barButton.addEventListener('click', () => {
    onFocus();
    showStrip();
  });
  barButton.addEventListener('dblclick', () => open());
  document.getElementById('scout-close').addEventListener('click', close);
  backdrop.addEventListener('click', close);
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  });
  // The "há 3 min" of the status and the cards move on while the panel is open.
  setInterval(() => {
    if (!dialog.hidden && state) statusEl.textContent = statusText();
  }, 30 * 1000);

  return { apply, open, close, isOpen: () => !dialog.hidden, taken, syncVillage };
}
