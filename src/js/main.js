import { createDeployDialog } from './deploy.js';
import { createBaseCard } from './basecard.js';
import { createBuildMenu, createSummon } from './hud.js';
import { createDesignDialog } from './design.js';
import { HEADLINE_RESOURCES, createOverview, formatResource, resourceIcon, sumResources } from './overview.js';
import { createActionMenu, icon } from './menu.js';
import { PHASES, featureBranch, formatElapsed, isObserver, kindInfo, phaseOf } from './kinds.js';
import { Empire, KNIGHT_ID, RECRUIT_CLOTH, WONDERS, mapClock } from './empire.js';
import { createScout } from './scout.js';
import { createPhonePanel } from './phone.js';
import { createProgress } from './progress.js';
import { createOnboarding } from './onboarding.js';
import { createCampaign, createHelp } from './guide.js';
import * as sfx from './sfx.js';
import { ERAS, TEAM_COLORS, TOWN_STYLES, drawKeepIcon, drawVillager, makeLook } from './sprites.js';

const ENTRYPOINT_LABELS = {
  'claude-vscode': 'VS Code',
  'claude-desktop': 'Desktop',
  cli: 'terminal',
  'sdk-cli': 'SDK',
};

const listEl = document.getElementById('agent-list');
const countsEl = document.getElementById('counts');
const statusEl = document.getElementById('status');
const emptyEl = document.getElementById('empty');
const tooltipEl = document.getElementById('tooltip');
const toastEl = document.getElementById('toast');
const refreshButton = document.getElementById('refresh');
const clockEl = document.getElementById('map-clock');
const groupToggle = document.getElementById('group-toggle');
const soundToggle = document.getElementById('sound-toggle');
const musicToggle = document.getElementById('music-toggle');
const musicVolumeInput = document.getElementById('music-volume');
const musicStationSelect = document.getElementById('music-station');
const musicNowEl = document.getElementById('music-now');
const musicNextButton = document.getElementById('music-next');
const musicQuickButton = document.getElementById('music-quick');
const approvalsEl = document.getElementById('approvals');
const settingsEl = document.getElementById('settings');
const settingsBackdrop = document.getElementById('settings-backdrop');
const settingsOpenButton = document.getElementById('settings-open');
const GROUP_PREF_KEY = 'cpo.groupByProject';
const SOUND_PREF_KEY = 'cpo.sound';
const MUSIC_PREF_KEY = 'cpo.music';
const MUSIC_VOLUME_KEY = 'cpo.musicVolume';
const MUSIC_STATION_KEY = 'cpo.musicStation';
const MUSIC_STATIONS = ['lofi', 'town'];
const DEFAULT_MUSIC_VOLUME = 100;
const DISMISSED_KEY = 'cpo.dismissed';
const COLLAPSED_KEY = 'cpo.collapsedProjects';
const LIMITS_PREF_KEY = 'cpo.limits';
// Same as usage::ALERT_PERCENT in the backend, which sends the matching desktop notification.
const LIMIT_ALERT_PERCENT = 90;
const ZOOM_PREF_KEY = 'cpo.zoom';
const ZOOM_STEPS = [0.75, 0.85, 0.9, 1, 1.1, 1.25, 1.4, 1.6];
const VIEW_ZOOM_KEY = 'cpo.viewZoom';
// The map's view: { mode: 'top' | 'iso', rotation: 0..3 }.
const MAP_VIEW_KEY = 'cpo.mapView';
const MAP_ONLY_KEY = 'cpo.mapOnly';
const PANEL_COLLAPSED_KEY = 'cpo.panelCollapsed';
const PANEL_LEFT_KEY = 'cpo.panelLeft';
// The saved view's format: v2 made the 3D isometric the default and replaced the pixel one.
const MAP_VIEW_VERSION = 2;
const VIEW_LABELS = { top: '2D', iso: 'ISO', '3d': '3D' };
// Which repositories stay on the map (and where), which are hidden, and how each base looks:
// { pinned, hidden, paths, orders, designs }.
const LAYOUT_KEY = 'cpo.empireLayout';
const VIEW_ZOOM_BUTTON_STEP = 1.25;
const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const TOAST_MS = 3500;
// Long enough to reach "Ver" when it pops up mid-task.
const NEEDS_YOU_TOAST_MS = 10 * 1000;
// The empire's numbers change slowly, but the balloons of the session's tokens should keep up; the
// backend only rereads what changed (a few milliseconds).
const EMPIRE_REFRESH_MS = 60 * 1000;

let agents = [];
let rawAgents = [];
let hasSnapshot = false;
let approvals = [];
let hostedIds = new Set(); // sessions the app runs itself (deploy "aqui no app")
let conflicts = new Map(); // agent id -> [{ rel, otherTitle }]
let selectedId = null;
let isGrouped = readPref(GROUP_PREF_KEY, false);
let isSoundOn = readPref(SOUND_PREF_KEY, true);
let isMusicOn = readPref(MUSIC_PREF_KEY, true);
let dismissed = new Set(readDismissed());
let collapsedProjects = new Set(readList(COLLAPSED_KEY));
let usage = null;
let isLimitsOn = readPref(LIMITS_PREF_KEY, true);
const limitsEl = document.getElementById('limits');
const limitsToggle = document.getElementById('limits-toggle');
let hiddenCount = 0;
let previousById = null;
let openingId = null;
let toastTimer = null;
let linkedId = null; // agent under the pointer on the map: its card and approval light up
let empireStats = null; // { generatedAt, repos: [...] } from get_empire, null until the first count

// Achievements, the empire's history and the usage metrics, kept on this machine.
const progress = createProgress();
const campaign = createCampaign({ before: document.getElementById('approvals'), showToast: (message) => showToast(message) });

// O Batedor's panel; created once the deploy dialog it trains villagers with exists.
let scoutPanel = null;

const empire = new Empire(document.getElementById('map'), document.getElementById('overlay'), {
  onHover: showTooltip,
  // The knight on the map opens on its routines: what it does, when and where.
  onSelect: (id, point) => (id === KNIGHT_ID ? scoutPanel?.open({ tab: 'scout-tab-routines' }) : handleAgentClick(id, point)),
  onMenu: (id, anchor, opener) => (id === KNIGHT_ID ? scoutPanel?.open() : openAgentMenu(id, anchor, opener)),
  onMissions: (project) => scoutPanel?.open({ project }),
  onProjectClick: (project, point) => {
    tooltipEl.hidden = true; // the card says it all; the hover tip would sit behind it
    baseCard.open(project, point);
  },
  onLandMenu: (spot, anchor, ground) => openLandMenu(spot, anchor, ground),
  onBaseMenu: (project, anchor) => openBaseMenu(project, anchor),
  onOrder: (ids, project) => openOrder(ids, project),
  onSelectionChange: (ids) => renderSelection(ids),
  onLink: (id) => markLinked(id),
  onFogClick: () => overview.open({ section: 'fog' }),
  onPlace: (project, spot, path) => {
    empire.pinBase(project, spot, path);
    showToast(`${empire.displayName(project)}: base construída`);
  },
  onAgeUp: (project, era) => celebrateAgeUp(project, era),
  onEvent: (event) => recordEmpireEvent(event),
  view: readMapView(),
  layout: readLayout(),
  onLayoutChange: (layout) => {
    saveLayout(layout);
    scoutPanel?.syncVillage();
  },
});

const actionMenu = createActionMenu();

const deployDialog = createDeployDialog({
  invoke: (command, args) => window.__TAURI__.core.invoke(command, args),
  showToast: (message, isError) => showToast(message, isError),
  getAgents: () => agents,
  getTeam: (project) => empire.teamOf(project),
  getDesign: (project) => empire.designOf(project),
  onDeployed: ({ spot, project, hint }) => {
    empire.reserveLand(spot, project.name, hint);
    campaign.complete('train');
  },
  onPinned: ({ spot, project }) => {
    empire.pinBase(project.name, spot, project.path);
    showToast(`${project.name}: base fixa no mapa`);
  },
  openMenu: (anchor, title, items, opener) => actionMenu.open(anchor, title, items, opener),
});

scoutPanel = createScout({
  invoke: (command, args) => window.__TAURI__.core.invoke(command, args),
  showToast: (message, isError, action) => showToast(message, isError, action),
  getBases: () => empire.baseProjects(),
  displayName: (project) => empire.displayName(project),
  // The task goes to the full dialog to be read and adjusted; only a started agent takes the mission.
  onTrain: (mission, project) => deployDialog.open(null, mission.task, project, null, () => scoutPanel.taken(mission, project)),
  onState: (scout) => empire.setScout(scout),
  onFocus: () => {
    if (!empire.focusKnight()) showToast('O batedor está em campo, lendo as fontes: ele volta com o relatório');
  },
  onShowPanel: () => setPanelCollapsed(false),
  getHero3d: () => (empire.is3d ? empire.world3d : null),
});

createPhonePanel({
  invoke: (command, args) => window.__TAURI__.core.invoke(command, args),
  showToast: (message, isError) => showToast(message, isError),
});

const designDialog = createDesignDialog({
  getDesign: (project) => empire.designOf(project),
  onSave: (project, design) => {
    empire.setDesign(project, design);
    const { era, style } = empire.designOf(project);
    const styleName = TOWN_STYLES.find((s) => s.id === style)?.name;
    showToast(`${empire.displayName(project)}: ${eraName(era)} · ${styleName}`);
    refreshView(); // cards and swatches take the new team color
    checkAchievements();
  },
  getPreview3d: () => (empire.is3d ? empire.world3d : null),
});

// ---------- The empire: resources, overview, fog of war ----------

// A repository belongs to the empire once an agent explored it, or while its base is on the map.
function isInEmpire(name) {
  return empire.hasBase(name) || Boolean(empireStats?.repos.find((repo) => repo.name === name)?.isExplored);
}

const overview = createOverview({
  getStats: () => empireStats,
  designOf: (project) => empire.designOf(project),
  isInEmpire,
  hasBase: (project) => empire.hasBase(project),
  onShowBase: (project) => empire.highlightBase(project),
  onPlaceBase: (repo) => {
    empire.pinBase(repo.name, null, repo.path);
    showToast(`${repo.name}: base fixa no mapa`);
  },
  onExplore: (project) => deployDialog.open(null, '', project),
  teamOf: (project) => empire.teamOf(project),
  displayName: (project) => empire.displayName(project),
  wondersOf: (project) => empire.wondersOf(project),
  getAchievements: () => progress.achievements(),
  getEvents: () => progress.events(),
  getUsage: () => progress.usage(),
  onOpen: () => progress.overviewOpened(),
});

// ---------- Progression: eras earned, wonders and achievements, all from real work ----------

function eraName(id) {
  return ERAS.find((era) => era.id === id)?.name ?? '';
}

// A repository's color on cards and swatches: its team color (picked or automatic).
function projectColor(project) {
  return empire.teamOf(project)[0];
}

// An agent's color: the base it works at now, the same as its villager's tunic on the map.
function agentColor(agent) {
  return projectColor(empire.workProjectOf(agent));
}

function celebrateAgeUp(project, era) {
  const name = empire.displayName(project);
  progress.addEvent('age', `${name} chegou à Era ${eraName(era)}`, project);
  showToast(`${name} avançou para a Era ${eraName(era)}!`);
  if (isSoundOn) sfx.playAgeUp();
  checkAchievements();
}

function recordEmpireEvent({ kind, project, wonder }) {
  const name = empire.displayName(project);
  if (kind === 'founded') progress.addEvent('founded', `Base fundada: ${name}`, project);
  if (kind === 'wonder') {
    const title = WONDERS.find((w) => w.id === wonder)?.name ?? 'Maravilha';
    progress.addEvent('wonder', `${title} em ${name}`, project);
    showToast(`Maravilha erguida em ${name}: ${title}`);
    if (isSoundOn) sfx.playAchievement();
  }
  checkAchievements();
}

// What the achievements look at: the empire's numbers and the sessions right now.
function achievementState() {
  const repos = empireStats?.repos ?? [];
  const inEmpire = repos.filter((repo) => isInEmpire(repo.name));
  const total = sumResources(inEmpire);
  return {
    bases: inEmpire.length,
    maxEra: Math.max(0, ...inEmpire.map((repo) => empire.designOf(repo.name).suggestedEra)),
    working: rawAgents.filter((agent) => !isObserver(agent) && agent.status === 'busy').length,
    commitsWeek: total.gold,
    hoursWeek: total.food / 60,
    explored: repos.filter((repo) => repo.isExplored).length,
    personalized: Object.keys(empire.getLayout().designs).length,
    wonders: repos.reduce((sum, repo) => sum + empire.wondersOf(repo.name).length, 0),
  };
}

function checkAchievements() {
  if (!empireStats) return; // the counts need the empire's numbers
  const fresh = progress.checkAchievements(achievementState());
  if (fresh.length === 0) return;
  showToast(fresh.length === 1 ? `Conquista desbloqueada: ${fresh[0].name}` : `${fresh.length} conquistas desbloqueadas: veja na Visão do império (I)`);
  if (isSoundOn) sfx.playAchievement();
}

const resourcesEl = document.getElementById('resources');

function renderResources() {
  if (!empireStats) return;
  const total = sumResources(empireStats.repos.filter((repo) => isInEmpire(repo.name)));
  const population = rawAgents.filter((agent) => !isObserver(agent)).length;
  const key = `${JSON.stringify(total)}|${population}`;
  if (resourcesEl.dataset.key === key) return;
  resourcesEl.dataset.key = key;
  const items = HEADLINE_RESOURCES.map((resource) => {
    const item = el('span', 'resource');
    item.title = `${resource.name}: ${resource.hint}`;
    item.append(resourceIcon(resource.id), el('span', null, formatResource(resource.id, total[resource.id])));
    return item;
  });
  const pop = el('span', 'resource resource-pop');
  pop.title = 'População: agentes trabalhando agora';
  pop.append(resourceIcon('pop'), el('span', null, String(population)));
  resourcesEl.replaceChildren(...items, pop);
}

// Repositories no agent explored, and with no base on the map, wait under the fog.
function renderFog() {
  if (!empireStats) return;
  empire.setFog(empireStats.repos.filter((repo) => !isInEmpire(repo.name)).map((repo) => repo.name));
}

async function refreshEmpire() {
  try {
    empireStats = await window.__TAURI__.core.invoke('get_empire');
  } catch (err) {
    if (overview.isOpen()) showToast(`Não consegui contar o império: ${err}`, true);
    return;
  }
  empire.setRepoPaths(empireStats.repos);
  empire.setEmpireStats(empireStats.repos); // eras earned and wonders raised
  renderFog();
  renderResources();
  renderSpend();
  checkAchievements();
  if (overview.isOpen()) overview.render();
}

resourcesEl.addEventListener('click', () => overview.open());
document.getElementById('overview-open').addEventListener('click', () => overview.open());
window.addEventListener('keydown', (event) => {
  const isTyping = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  if (event.key.toLowerCase() !== 'i' || isTyping || event.ctrlKey || event.metaKey || event.altKey) return;
  event.preventDefault();
  if (overview.isOpen()) overview.close();
  else overview.open();
});
window.addEventListener('keydown', (event) => {
  const isTyping = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  if (event.key.toLowerCase() !== 'k' || isTyping || event.ctrlKey || event.metaKey || event.altKey) return;
  event.preventDefault();
  if (scoutPanel.isOpen()) scoutPanel.close();
  else scoutPanel.open();
});

function deployToRepo(project, text, mode) {
  const path = empire.repoPathOf(project);
  if (!path) {
    deployDialog.open(null, text, project, mode); // folder not known yet: the full dialog finds it
    return null;
  }
  return deployDialog.deployNow({ name: project, path }, text, mode);
}

// Town center card: train a villager right there (task + where it runs), as a building's panel in AoE.
const baseCard = createBaseCard({
  describe: (project) => {
    const design = empire.designOf(project);
    const crew = agents.filter((agent) => !isObserver(agent) && agent.project === project).sort(compareAgents);
    const era = ERAS.find((e) => e.id === design.era)?.name;
    const style = TOWN_STYLES.find((s) => s.id === design.style)?.name;
    const folder = empire.displayName(project) === project ? null : `pasta ${project}`;
    return {
      title: empire.displayName(project),
      meta: [folder, `${era} · ${style}`, crew.length === 0 ? 'Nenhum aldeão agora' : null].filter(Boolean).join(' · '),
      waiting: crew.filter((agent) => attentionRank(agent) < 2).map(crewEntry),
      working: crew.filter((agent) => attentionRank(agent) === 2).map(crewEntry),
    };
  },
  deployTo: (project, text, mode) => deployToRepo(project, text, mode),
  openFull: (project, text) => deployDialog.open(null, text, project),
  openDesign: (project) => designDialog.open(project),
  openOptions: (project, point) => openBaseMenu(project, point),
  pickAgent: (id, point) => openQuick(id, point),
});

// A villager in its town center's card: blocked, "sua vez há 12min" or what it is doing, and its task.
function crewEntry(agent) {
  const kind = displayKind(agent);
  const status = isYourTurn(agent) ? `Sua vez há ${formatElapsed(agent.activity.since)}` : kindInfo(kind).label;
  return { id: agent.id, task: taskTitle(agent), status, color: kindInfo(kind).color };
}

// ---------- Game bar: build a repository's base, summon agents by drag and drop ----------

const buildMenu = createBuildMenu({
  getRepos: async () => {
    let repos = empireStats?.repos;
    if (!repos) {
      try {
        repos = await window.__TAURI__.core.invoke('list_projects');
      } catch (err) {
        showToast(`Não consegui listar os repositórios: ${err}`, true);
        return [];
      }
    }
    return repos.map((repo) => {
      const design = empire.designOf(repo.name);
      const era = ERAS.find((e) => e.id === design.era)?.name;
      const files = Number.isFinite(repo.trackedFiles) ? ` · ${repo.trackedFiles.toLocaleString('pt-BR')} arquivos` : '';
      return { name: repo.name, path: repo.path, isOnMap: empire.hasBase(repo.name), detail: `${era}${files}` };
    });
  },
  onBuild: (repo) => {
    empire.startPlacing(repo.name, repo.path);
    showToast(`Construir ${repo.name}: clique no mapa · Esc cancela`);
  },
});

// Construir and Recrutar wear pixel busts like the command chip's villager: one set, not two styles.
function drawHudIcons() {
  drawKeepIcon(document.getElementById('build-icon').getContext('2d'), 0, 0, ...TEAM_COLORS[0]);
  const recruit = { ...makeLook('recruta', ''), ...RECRUIT_CLOTH, shirt: RECRUIT_CLOTH.tunic, hat: 1 };
  drawVillager(document.getElementById('summon-icon').getContext('2d'), recruit, 6, 18, 's', 'stand', 0, 0);
}
drawHudIcons();

// The token is over the map (not over the bar, a dialog or the panel).
function isOverMap(event) {
  return document.elementFromPoint(event.clientX, event.clientY) === empire.viewCanvas;
}

// A recruit: a villager with no session yet. Pick it, click a base, and its session starts there, here in the app.
function summonRecruit(at = null) {
  const id = empire.addRecruit(at);
  // Picked at once (along with recruits already picked), so the next click on a base sends it.
  const picked = [...empire.selected];
  empire.setSelection(picked.every((other) => empire.recruitOf(other)) ? [...picked, id] : [id]);
  showToast('Novo recruta selecionado: clique numa base para pôr para trabalhar, ou botão direito nele');
}

createSummon({
  preview: (event) => (isOverMap(event) ? empire.previewSummon(event) : empire.clearSummon()),
  cancel: () => empire.clearSummon(),
  click: () => summonRecruit(),
  drop: (event, mode) => {
    if (!isOverMap(event)) return;
    const hit = empire.hitAt(event);
    const point = { x: event.clientX, y: event.clientY };
    const project = hit?.project ?? (hit?.id && agents.find((a) => a.id === hit.id)?.project);
    if (project) baseCard.open(project, point, { mode });
    else summonRecruit(empire.groundAt(event)); // off the bases it stands where dropped (or in the square)
  },
});

// "Aldeão ocioso", as in Age of Empires: jumps to the agents waiting on you, one at a time.
const idleButton = document.getElementById('idle-villager');
const idleCountEl = document.getElementById('idle-count');
let idleCursor = -1;

function idleAgents() {
  return agents.filter(isYourTurn).sort((a, b) => (a.activity.since ?? 0) - (b.activity.since ?? 0));
}

function renderIdleButton() {
  const count = idleAgents().length;
  idleCountEl.textContent = String(count);
  idleButton.disabled = count === 0;
}

function selectNextIdle() {
  const idle = idleAgents();
  if (idle.length === 0) return;
  idleCursor = (idleCursor + 1) % idle.length;
  selectAgent(idle[idleCursor].id);
  empire.setSelection([idle[idleCursor].id]); // ready for a right-click on a base, as in the game
}

idleButton.addEventListener('click', selectNextIdle);
window.addEventListener('keydown', (event) => {
  const isTyping = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  if (event.key !== '.' || isTyping || event.ctrlKey || event.metaKey || event.altKey) return;
  event.preventDefault();
  selectNextIdle();
});

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text; // transcript text is never parsed as HTML
  return node;
}

function needsAttention(agent) {
  return agent.status === 'busy' && agent.activity.kind === 'asking';
}

// What depends on the user comes first: blocked (0), then finished turns waiting for a reply (1).
// Observers (claude-mem) never need the user: they get their own section, out of the counters.
const SECTIONS = ['Precisa de você agora', 'Sua vez', 'Trabalhando', 'Observadores'];
const NEW_AGENT_TARGET = '__new';
// Where a new agent runs unless you pick otherwise: a prefilled Cursor tab has been the most reliable.
const DEFAULT_DEPLOY_MODE = 'cursor';
// Two agents editing the same file within this window is flagged as a conflict.
const CONFLICT_WINDOW_MS = 2 * 60 * 60 * 1000;
// Git safety follows the known traps of this machine: another agent commits in parallel, so no
// stash / add -A, no rewriting other people's commits, and never a push to main.
const SAFE_SYNC_PROMPT = [
  'Sincronize com a main de forma segura:',
  '1) Rode `git status --short` e `git log --oneline -8`. Se houver mudanças não commitadas que não são suas, pare e me avise: outro agente pode estar trabalhando aqui.',
  '2) `git fetch origin`.',
  '3) Se você estiver na main, não reescreva histórico: só me mostre o que chegou no origin/main e pare.',
  '4) Numa branch de trabalho, confira no log quais commits são seus e traga o origin/main com rebase só deles. Nunca use `git stash` nem `git add -A`.',
  '5) Em conflito, pare e me mostre os arquivos, sem resolver código de outra pessoa no chute.',
  '6) Rode os testes do projeto.',
  'Nunca faça push na main, nunca use --force e não faça push nenhum sem me perguntar.',
].join('\n');
const PRESETS = [
  { label: 'Seguir', hint: 'Segue em frente e sugere as melhores opções', text: null },
  { label: 'Sincronizar', hint: 'Com a main: rebase seguro, sem stash e sem push', text: SAFE_SYNC_PROMPT },
  { label: 'Testar', hint: 'Roda os testes e corrige o que falhar', text: 'Rode os testes do projeto. Corrija o que falhar sem mudar o comportamento esperado e me mostre um resumo do que mudou.' },
  { label: 'Resumir', hint: 'O que foi feito e o próximo passo, sem alterar nada', text: 'Sem alterar nada: resuma em até 5 linhas o que já foi feito, o que falta e o próximo passo que você recomenda.' },
];
const CONTINUE_PROMPT =
  'Siga em frente de onde parou. Se houver decisões pela frente, liste as melhores opções nesta linha de trabalho, recomende uma e continue com ela.';

function isYourTurn(agent) {
  return agent.status !== 'busy' && !isObserver(agent);
}

function attentionRank(agent) {
  if (isObserver(agent)) return 3;
  if (needsAttention(agent)) return 0;
  return isYourTurn(agent) ? 1 : 2;
}

// Most recently finished first inside "Sua vez"; the rest keep their arrival order.
function compareAgents(a, b) {
  const rank = attentionRank(a) - attentionRank(b);
  if (rank !== 0) return rank;
  if (isYourTurn(a)) return (b.activity.since ?? 0) - (a.activity.since ?? 0);
  return (a.startedAt ?? 0) - (b.startedAt ?? 0);
}

function displayKind(agent) {
  return isYourTurn(agent) ? 'yourturn' : agent.activity.kind;
}

function shortModel(model) {
  return model ? model.replace(/^claude-/, '').replace(/-\d{8}$/, '') : null;
}

function sinceEl(since) {
  const span = el('span', 'since', formatElapsed(since));
  if (Number.isFinite(since)) span.dataset.since = String(since);
  return span;
}

function renderCard(agent) {
  const kind = displayKind(agent);
  const info = kindInfo(kind);
  const button = el('button', 'card');
  button.type = 'button';
  button.dataset.id = agent.id;
  button.dataset.kind = kind;
  button.classList.toggle('is-selected', agent.id === selectedId);
  button.classList.toggle('is-linked', agent.id === linkedId);
  button.style.setProperty('--kind', info.color);
  button.style.setProperty('--team', agentColor(agent));
  button.title = agent.editor ? `Focar a aba no ${agent.editor}` : 'Sessão de terminal ou SDK';
  button.addEventListener('click', (event) => {
    if (event.shiftKey || event.ctrlKey || event.metaKey) empire.toggleSelected(agent.id); // pick several, as on the map
    else openQuick(agent.id, button);
  });
  button.addEventListener('dblclick', () => openInEditor(agent.id));

  const main = el('span', 'card-main');
  const top = el('span', 'card-top');
  top.append(el('strong', 'card-name', agent.name), el('span', 'chip', info.label));
  main.append(top);
  if (agent.title) main.append(el('span', 'card-title', agent.title));
  const branch = featureBranch(agent);
  if (branch) {
    const tag = el('span', 'branch-tag', branch);
    tag.title = `Na branch ${branch}`;
    main.append(tag);
  }

  const activity = el('span', 'card-activity');
  const label = isYourTurn(agent) ? 'Terminou, esperando sua resposta' : agent.activity.label;
  // Busy: how long the task (turn) has been going. Idle: how long it has waited for you.
  const age = sinceEl(isYourTurn(agent) ? agent.activity.since : agent.lastPromptAt);
  age.title = isYourTurn(agent) ? 'Esperando você há' : 'Tarefa em andamento há';
  activity.append(el('i', 'dot'), el('span', 'activity-label', label), age);
  main.append(activity);

  if (!isObserver(agent) && (agent.steps?.length || agent.status === 'busy')) main.append(renderProgress(agent));
  for (const conflict of conflicts.get(agent.id) ?? []) {
    main.append(el('span', 'card-conflict', `Mesmo arquivo que “${conflict.otherTitle}”: ${conflict.rel}`));
  }

  // When the move is yours, what Claude last said is what you have to answer.
  const isOnYou = attentionRank(agent) < 2;
  if (isOnYou && agent.lastReply) main.append(el('span', 'card-reply', agent.lastReply));
  else if (agent.lastPrompt) main.append(el('span', 'card-prompt', `“${agent.lastPrompt}”`));
  if (agent.subagents.length > 0) main.append(renderSubagents(agent.subagents));

  const host = hostedIds.has(agent.id) ? 'App' : agent.editor || ENTRYPOINT_LABELS[agent.entrypoint] || agent.entrypoint;
  const fileCount = agent.files?.length ? `${agent.files.length} arquivo${agent.files.length > 1 ? 's' : ''}` : null;
  const workProject = empire.workProjectOf(agent);
  const where = workProject === agent.project ? agent.project : `${agent.project} → ${workProject}`;
  const meta = [where, fileCount, shortModel(agent.model), host, `pid ${agent.pid}`];
  main.append(el('span', 'card-meta', meta.filter(Boolean).join(' · ')));

  button.append(el('span', 'swatch'), main);
  const more = el('button', 'card-more', '…');
  more.type = 'button';
  more.setAttribute('aria-label', `Ações de ${agent.name}`);
  more.setAttribute('aria-haspopup', 'menu');
  more.setAttribute('aria-expanded', 'false');
  more.addEventListener('click', () => openAgentMenu(agent.id, more, more));
  const item = el('li', 'card-item');
  item.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    // At the pointer; from the Menu key (no pointer position) at the "…".
    const anchor = event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : more;
    openAgentMenu(agent.id, anchor, more);
  });
  item.append(button, more);
  return item;
}

// Timeline of the turn (one block per tool call, colored by kind) plus the four-phase stepper.
function renderProgress(agent) {
  const steps = agent.steps ?? [];
  const box = el('span', 'progress');
  const strip = el('span', 'timeline');
  strip.title = `${steps.length} ações desde o seu pedido`;
  for (const step of steps) {
    const block = el('i', 'tl-step');
    block.style.background = kindInfo(step.kind).color;
    block.title = kindInfo(step.kind).label;
    strip.append(block);
  }
  const current = phaseOf(agent);
  const phases = el('span', 'phases');
  PHASES.forEach((name, index) => {
    const state = index < current ? 'is-done' : index === current ? 'is-current' : '';
    phases.append(el('span', `phase ${state}`, name));
  });
  box.append(strip, phases);
  return box;
}

// Same absolute path edited by two live agents recently: likely to step on each other.
function findConflicts(list) {
  const now = Date.now();
  const editors = new Map();
  for (const agent of list) {
    if (isObserver(agent)) continue;
    for (const file of agent.files ?? []) {
      if (!Number.isFinite(file.at) || now - file.at > CONFLICT_WINDOW_MS) continue;
      if (!editors.has(file.path)) editors.set(file.path, []);
      editors.get(file.path).push({ agent, rel: file.rel });
    }
  }
  const found = new Map();
  for (const touches of editors.values()) {
    if (touches.length < 2) continue;
    for (const { agent, rel } of touches) {
      const others = touches.filter((t) => t.agent.id !== agent.id);
      if (!found.has(agent.id)) found.set(agent.id, []);
      for (const other of others) found.get(agent.id).push({ rel, otherTitle: taskTitle(other.agent) });
    }
  }
  return found;
}

function readList(key) {
  try {
    const list = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function readDismissed() {
  return readList(DISMISSED_KEY);
}

function toggleProject(project) {
  if (collapsedProjects.has(project)) collapsedProjects.delete(project);
  else collapsedProjects.add(project);
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsedProjects]));
  } catch {
    // collapsing still works for this run
  }
  renderPanel();
}

function saveDismissed() {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...dismissed]));
  } catch {
    // losing it only means closed agents show up again after a reload
  }
}

function pendingApproval(agent) {
  return approvals.find((approval) => approval.sessionId === agent.id) ?? null;
}

// The menu leads with what unblocks the agent: approve/deny when a panel prompt is pending,
// "seguir em frente" when it is your turn, then the common actions.
function agentActions(agent) {
  const isWorking = agent.status === 'busy';
  const isHosted = hostedIds.has(agent.id);
  const approval = pendingApproval(agent);
  const noEditorHint = 'Sessão de terminal ou SDK: continue pelo terminal dela';
  const items = [];
  if (approval) items.push({ section: 'Precisa de você' });
  if (approval?.kind === 'question') {
    items.push({
      icon: 'help',
      label: 'Responder a pergunta',
      hint: approval.questions?.[0]?.question ?? 'O agente espera sua escolha',
      onSelect: () => focusApproval(approval),
    });
  } else if (approval) {
    items.push(
      { icon: 'check', label: `Aprovar: ${approval.label}`, hint: approval.detail ?? 'Libera esta ação e o agente segue', onSelect: () => answerApproval(approval, 'allow') },
      { icon: 'x', label: 'Negar', hint: 'O agente recebe a recusa e decide outro caminho', onSelect: () => answerApproval(approval, 'deny') },
      { divider: true },
    );
  }
  // On its turn a hosted agent takes "Responder…" right here, so "Dar comando…" would say the same.
  const canReply = isYourTurn(agent) && isHosted;
  if (canReply) {
    items.push(
      { icon: 'play', label: 'Seguir em frente', hint: 'Envia agora: continuar e sugerir as melhores opções nesta linha', onSelect: () => sendToAgent(agent, CONTINUE_PROMPT) },
      { icon: 'message', label: 'Responder…', hint: 'Escreva a próxima mensagem para o agente', onSelect: () => openReply(agent) },
    );
  } else if (isYourTurn(agent)) {
    items.push({
      icon: 'play',
      label: 'Seguir em frente',
      hint: agent.editor ? 'Foca a aba e copia o pedido: continuar e sugerir as melhores opções. Cole e dê Enter' : noEditorHint,
      disabled: !agent.editor,
      onSelect: () => continueAgent(agent),
    });
  }
  if (!canReply) {
    items.push({
      icon: 'megaphone',
      label: 'Dar comando…',
      hint: isHosted ? 'Escreva na barra de comando: chega direto no agente' : 'Escreva na barra: o comando é copiado e a aba abre',
      onSelect: () => targetCommand(agent.id),
    });
  }
  items.push(
    {
      icon: 'send',
      label: 'Mandar para…',
      hint: 'Outra base: a ordem já vai escrita com o caminho dela',
      submenu: sendToMenu([agent.id], empire.workProjectOf(agent)),
    },
    { divider: true },
    isHosted
      ? {
          icon: 'external',
          label: 'Levar para o Cursor',
          hint: isWorking ? 'Espere o turno terminar para levar a sessão ao Cursor' : 'Para o agente aqui e retoma a mesma sessão numa aba do Cursor',
          disabled: isWorking,
          onSelect: () => moveToCursor(agent),
        }
      : {
          icon: 'external',
          label: `Abrir no ${agent.editor ?? 'editor'}`,
          hint: agent.editor ? `Foca a aba desta sessão no ${agent.editor}` : noEditorHint,
          disabled: !agent.editor,
          onSelect: () => openSession(agent.id),
        },
    {
      icon: 'eye-off',
      label: 'Tirar do mapa',
      hint: isWorking
        ? 'Só dá para tirar quem não está trabalhando nem esperando aprovação'
        : 'A sessão segue aberta e o aldeão volta se ela voltar a trabalhar',
      disabled: isWorking,
      onSelect: () => dismissAgent(agent),
    },
    {
      icon: 'power',
      label: 'Encerrar sessão',
      hint: isWorking ? 'Para o trabalho em andamento e fecha o processo do Claude, liberando espaço' : 'Fecha o processo do Claude desta sessão, liberando espaço',
      confirmLabel: 'Clique de novo para encerrar',
      isDanger: true,
      onSelect: () => endSession(agent),
    },
  );
  return items;
}

// A blocked agent with a panel prompt opens its menu (approve right there); others focus their tab.
// Blocked agents and the ones the app hosts (no tab to jump to) open their menu instead.
function handleAgentClick(id, point) {
  openQuick(id, point);
  campaign.complete('inspect');
}

// ---------- Command bar: type an order and send it straight to an agent ----------

const commandBar = document.getElementById('command-bar');
const commandTarget = document.getElementById('command-target');
const commandInput = document.getElementById('command-input');

const commandHint = document.getElementById('command-hint');
const presetList = document.getElementById('preset-list');

const commandPortrait = document.getElementById('command-portrait');
const COMMAND_VILLAGE_KEY = 'cpo.commandVillage';
let commandVillage = readCommandVillage(); // the base a new agent starts in, chosen before sending

function readCommandVillage() {
  try {
    return localStorage.getItem(COMMAND_VILLAGE_KEY);
  } catch {
    return null;
  }
}

// The bases on the map, the busiest first: where a new agent can start.
function commandVillages() {
  const crewSize = (project) => rawAgents.filter((a) => !isObserver(a) && a.project === project).length;
  return [...empire.bases.keys()].sort((a, b) => crewSize(b) - crewSize(a) || empire.displayName(a).localeCompare(empire.displayName(b)));
}

// The last pick while it is still on the map; otherwise the busiest base.
function resolveCommandVillage() {
  if (commandVillage && empire.hasBase(commandVillage)) return commandVillage;
  return commandVillages()[0] ?? null;
}

// A new agent, in this base.
function chooseCommandVillage(project) {
  commandVillage = project;
  try {
    localStorage.setItem(COMMAND_VILLAGE_KEY, project);
  } catch {
    // the pick still holds for this run
  }
  targetCommand(NEW_AGENT_TARGET);
}

// The unit's bust: the agent in its team color, or the next villager in the chosen base's color
// (undyed linen, like a recruit, when there is no base yet).
function renderCommandPortrait(agent, village) {
  const project = (agent && empire.workProjectOf(agent)) ?? village;
  const look = makeLook(agent?.id ?? 'novo aldeão', project ?? '');
  if (project) empire.dressInTeam(look, project);
  else Object.assign(look, RECRUIT_CLOTH, { shirt: RECRUIT_CLOTH.tunic });
  const ctx = commandPortrait.getContext('2d');
  ctx.clearRect(0, 0, commandPortrait.width, commandPortrait.height);
  drawVillager(ctx, look, commandPortrait.width / 2, 18, 's', 'stand', 0, 0); // feet below the frame: head and chest
}

function commandPlaceholder() {
  const id = commandTarget.value;
  return id === NEW_AGENT_TARGET ? 'Tarefa do novo agente…' : 'Dê um comando ao agente…';
}

function deliveryHint(id) {
  if (id === NEW_AGENT_TARGET) {
    const village = resolveCommandVillage();
    return village ? `Enter: abre uma aba do Claude no Cursor em ${village}, já com a tarefa; confirme lá.` : 'Enter escolhe o projeto e abre uma aba do Claude no Cursor, já com a tarefa.';
  }
  if (hostedIds.has(id)) return 'Chega direto no agente, sem sair daqui.';
  const agent = agents.find((a) => a.id === id);
  if (agent?.editor) return `Sessão do ${agent.editor}: ele não aceita comando de fora, então vai copiado e a aba abre.`;
  return 'Sessão de terminal: mande pelo terminal dela.';
}

const commandTargetButton = document.getElementById('command-target-button');

// The chip shows who gets the command, with the unit's portrait framed in its state: red if that
// agent needs you, amber on its turn. A new agent shows the base it will start in, tagged "novo".
function renderCommandTargetButton() {
  const agent = agents.find((a) => a.id === commandTarget.value);
  const village = agent ? null : resolveCommandVillage();
  const swatch = !agent ? 'var(--accent)' : attentionRank(agent) === 0 ? 'var(--danger)' : isYourTurn(agent) ? '#fbbf24' : agentColor(agent);
  document.getElementById('command-target-tag').hidden = Boolean(agent);
  document.getElementById('command-target-label').textContent = agent ? taskTitle(agent) : village ? empire.displayName(village) : 'Escolher vila';
  commandTargetButton.style.setProperty('--swatch', swatch);
  commandTargetButton.title = agent ? `Para: ${taskTitle(agent)} (${agent.project})` : village ? `Novo agente em ${village}: começa na pasta dela` : 'Novo agente: escolha a vila';
  commandTargetButton.setAttribute('aria-label', `Para quem: ${agent ? taskTitle(agent) : `novo agente em ${village ? empire.displayName(village) : 'escolher vila'}`}`);
  renderCommandPortrait(agent, village);
}

// One menu for both: an agent already working, or a new one in one of the bases.
function openCommandTargetMenu() {
  const live = [...commandTarget.options].map((option) => agents.find((a) => a.id === option.value)).filter(Boolean);
  const items = live.length ? [{ section: 'Agentes' }] : [];
  for (const agent of live) {
    const status = attentionRank(agent) === 0 ? 'Precisa de você' : isYourTurn(agent) ? 'Sua vez' : agent.activity.label;
    const where = hostedIds.has(agent.id) ? 'aqui no app' : agent.editor ?? 'terminal';
    items.push({ label: taskTitle(agent), hint: `${status} · ${agent.project} · ${where}`, onSelect: () => targetCommand(agent.id) });
  }
  items.push({ section: 'Novo agente em' });
  for (const project of commandVillages()) {
    const crew = rawAgents.filter((a) => !isObserver(a) && a.project === project);
    items.push({ label: empire.displayName(project), hint: statusSummary(crew) || 'Nenhum aldeão agora', onSelect: () => chooseCommandVillage(project) });
  }
  items.push({ label: 'Outro repositório…', hint: 'Busca em ~/Code, já com a tarefa escrita', onSelect: handOffToDialog });
  actionMenu.open(commandTargetButton, 'Para quem vai o comando', items, commandTargetButton);
}

function refreshCommandUi() {
  renderCommandTargetButton();
  commandInput.placeholder = commandPlaceholder();
  commandHint.textContent = deliveryHint(commandTarget.value);
  presetList.hidden = commandTarget.value === NEW_AGENT_TARGET; // shortcuts are for a live agent
}

function presetText(preset) {
  return preset.text ?? CONTINUE_PROMPT;
}

function renderPresetButtons(container, onPick) {
  container.replaceChildren(
    ...PRESETS.map((preset) => {
      const button = el('button', 'preset');
      button.type = 'button';
      button.title = `${preset.hint}\n\n${presetText(preset)}`;
      button.append(el('strong', null, preset.label), el('small', null, preset.hint));
      button.addEventListener('click', () => onPick(preset));
      return button;
    }),
  );
}

// One way to hand a command to an agent, whatever the entry point (sidebar, popover, preset).
async function deliverCommand(agent, text) {
  if (hostedIds.has(agent.id)) {
    await sendToAgent(agent, text);
    return true;
  }
  if (!agent.editor) {
    showToast('Sessão de terminal ou SDK: mande o comando pelo terminal dela', true);
    return false;
  }
  // Cursor tabs refuse prompts from outside, so the command travels by clipboard.
  const isCopied = await copyText(text);
  await openSession(agent.id);
  showToast(isCopied ? 'Comando copiado: na aba do Cursor, Ctrl+V e Enter' : 'Não consegui copiar; a aba está aberta para você colar');
  return true;
}

// Who needs you first; defaults to the hosted agent whose turn it is, else a new agent.
function renderCommandTargets() {
  const previous = commandTarget.value;
  const candidates = [...agents].filter((a) => !isObserver(a)).sort(compareAgents);
  const options = candidates.map((agent) => {
    const marker = attentionRank(agent) === 0 ? '● ' : isYourTurn(agent) ? '◆ ' : '';
    const where = hostedIds.has(agent.id) ? 'app' : agent.editor ?? 'terminal';
    const option = el('option', null, `${marker}${taskTitle(agent)} · ${where}`);
    option.value = agent.id;
    return option;
  });
  const fresh = el('option', null, '＋ Novo agente…');
  fresh.value = NEW_AGENT_TARGET;
  commandTarget.replaceChildren(...options, fresh);
  const fallback = candidates.find((a) => hostedIds.has(a.id) && isYourTurn(a)) ?? candidates.find((a) => hostedIds.has(a.id));
  const keep = [...commandTarget.options].some((o) => o.value === previous);
  commandTarget.value = keep ? previous : (fallback?.id ?? NEW_AGENT_TARGET);
  refreshCommandUi();
}

function targetCommand(id) {
  commandTarget.value = id;
  refreshCommandUi();
  commandInput.focus();
}

// Shift+Enter lines grow the field (the CSS caps it at five), so nothing typed hides under one line.
function fitCommandInput() {
  commandInput.style.height = 'auto';
  // empty: back to the CSS height (a wrapped placeholder would count in scrollHeight)
  commandInput.style.height = commandInput.value ? `${commandInput.scrollHeight}px` : '';
}

function clearCommandInput() {
  commandInput.value = '';
  fitCommandInput();
}

// The full dialog takes the text from here (it starts the agent, or you cancel it there).
function handOffToDialog() {
  const text = commandInput.value.trim();
  clearCommandInput();
  deployDialog.open(null, text);
}

// Says whether the text went (to an agent, or to a dialog that took it over).
async function sendCommand(id, text) {
  if (id !== NEW_AGENT_TARGET) {
    const agent = agents.find((a) => a.id === id);
    if (!agent) {
      showToast('Esse agente não está mais aqui', true);
      return false;
    }
    return deliverCommand(agent, text);
  }
  const village = resolveCommandVillage();
  // The base picked here is gone (its last agent left, or it was hidden): confirm in the dialog
  // rather than start somewhere you didn't pick.
  if (!village || (commandVillage && village !== commandVillage)) {
    deployDialog.open(null, text, village);
    return true;
  }
  return (await deployToRepo(village, text, DEFAULT_DEPLOY_MODE)) !== false;
}

// Cleared up front so a second Enter can't send it twice; it comes back if it didn't go (and
// nothing new was typed meanwhile).
async function submitCommand() {
  const text = commandInput.value.trim();
  if (!text) return;
  clearCommandInput();
  if (!(await sendCommand(commandTarget.value, text)) && !commandInput.value) {
    commandInput.value = text;
    fitCommandInput();
  }
}

commandBar.addEventListener('submit', (event) => {
  event.preventDefault();
  submitCommand();
});
// Enter sends, Shift+Enter breaks the line.
commandInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    if (!event.repeat) submitCommand();
  }
});
commandTarget.addEventListener('change', () => {
  refreshCommandUi();
  commandInput.focus();
});
commandInput.addEventListener('input', fitCommandInput);
commandTargetButton.addEventListener('click', openCommandTargetMenu);
// The build menu and the selection bar sit just above the game bar, however tall it grows.
const hudEl = document.getElementById('hud');
new ResizeObserver(() => hudEl.parentElement.style.setProperty('--hud-height', `${hudEl.offsetHeight}px`)).observe(hudEl);
renderPresetButtons(presetList, (preset) => {
  const agent = agents.find((a) => a.id === commandTarget.value);
  if (agent) deliverCommand(agent, presetText(preset));
});

// ---------- Quick popover: click a task, send a command or open it in Cursor ----------

const quickEl = document.getElementById('quick');
const quickInput = document.getElementById('quick-input');
const quickSend = document.getElementById('quick-send');
const quickCursor = document.getElementById('quick-cursor');
let quickAgentId = null;

// How long the current task has been going: the turn started with the last prompt.
function taskAge(agent) {
  if (isYourTurn(agent)) return `sua vez há ${formatElapsed(agent.activity.since)}`;
  return `trabalhando há ${formatElapsed(agent.lastPromptAt)}`;
}

function closeQuick() {
  quickEl.hidden = true;
  quickAgentId = null;
}

function openQuick(id, anchor) {
  empire.setSelection([id]);
  const agent = agents.find((a) => a.id === id);
  if (!agent) return;
  actionMenu.close({ restoreFocus: false });
  quickAgentId = id;
  const isHosted = hostedIds.has(id);
  document.getElementById('quick-title').textContent = taskTitle(agent);
  document.getElementById('quick-meta').textContent = `${taskAge(agent)} · ${agent.activity.label}`;
  const progressBox = document.getElementById('quick-progress');
  progressBox.replaceChildren();
  if (agent.steps?.length || agent.status === 'busy') progressBox.append(renderProgress(agent));
  if (agent.files?.length) {
    const names = agent.files.slice(0, 5).map((file) => file.rel);
    const more = agent.files.length > 5 ? ` +${agent.files.length - 5}` : '';
    progressBox.append(el('p', 'quick-files', `Arquivos: ${names.join(', ')}${more}`));
  }
  for (const conflict of conflicts.get(agent.id) ?? []) {
    progressBox.append(el('p', 'card-conflict', `Mesmo arquivo que “${conflict.otherTitle}”: ${conflict.rel}`));
  }
  const approvalBox = document.getElementById('quick-approval');
  approvalBox.replaceChildren();
  const approval = pendingApproval(agent);
  if (approval?.kind === 'question') {
    const answer = el('button', 'btn btn-primary', 'Responder a pergunta');
    answer.type = 'button';
    answer.addEventListener('click', () => {
      closeQuick();
      focusApproval(approval);
    });
    approvalBox.append(answer);
  } else if (approval) {
    for (const [decision, label, className] of [['allow', `Aprovar: ${approval.label}`, 'btn btn-allow'], ['deny', 'Negar', 'btn btn-deny']]) {
      const button = el('button', className, label);
      button.type = 'button';
      button.addEventListener('click', () => {
        closeQuick();
        answerApproval(approval, decision);
      });
      approvalBox.append(button);
    }
  }
  renderPresetButtons(document.getElementById('quick-presets'), (preset) => {
    closeQuick();
    deliverCommand(agent, presetText(preset));
  });
  quickInput.value = '';
  quickInput.placeholder = isHosted ? 'Comando: chega direto no agente' : 'Comando: vai copiado para a aba';
  quickSend.textContent = isHosted ? 'Enviar' : 'Copiar e abrir';
  quickSend.disabled = !isHosted && !agent.editor;
  quickCursor.textContent = isHosted ? '↗ Levar para o Cursor' : agent.editor ? `↗ Abrir no ${agent.editor}` : 'Sessão de terminal: abra pelo terminal';
  quickCursor.disabled = isHosted ? agent.status === 'busy' : !agent.editor;
  quickCursor.title = isHosted && agent.status === 'busy' ? 'Espere o turno terminar para levar ao Cursor' : '';
  quickEl.hidden = false;
  const rect = anchor instanceof Element ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
  const box = quickEl.getBoundingClientRect();
  quickEl.style.left = `${Math.min(Math.max(8, rect.left), window.innerWidth - box.width - 8)}px`;
  const below = rect.bottom + 6;
  quickEl.style.top = `${below + box.height > window.innerHeight - 8 ? Math.max(8, rect.top - box.height - 6) : below}px`;
  // Cursor sessions: opening the tab is the usual move, so Enter right away does it. Hosted
  // agents take commands directly, so the input gets the focus there.
  if (!isHosted && agent.editor) quickCursor.focus();
  else quickInput.focus();
}

// Double click (robot or card): straight to the session in Cursor, no popover.
function openInEditor(id) {
  closeQuick();
  const agent = agents.find((a) => a.id === id);
  if (!agent) return;
  if (hostedIds.has(id)) moveToCursor(agent);
  else if (agent.editor) openSession(id);
  else showToast('Sessão de terminal ou SDK: abra pelo terminal dela', true);
}

document.getElementById('map').addEventListener('agentdblclick', (event) => openInEditor(event.detail));

document.getElementById('quick-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const agent = agents.find((a) => a.id === quickAgentId);
  const text = quickInput.value.trim();
  if (!agent || !text) return;
  closeQuick();
  await deliverCommand(agent, text);
});
quickCursor.addEventListener('click', () => {
  const agent = agents.find((a) => a.id === quickAgentId);
  closeQuick();
  if (!agent) return;
  if (hostedIds.has(agent.id)) moveToCursor(agent);
  else openSession(agent.id);
});
document.getElementById('quick-more').addEventListener('click', () => {
  const id = quickAgentId;
  const box = quickEl.getBoundingClientRect();
  closeQuick();
  if (id) openAgentMenu(id, { x: box.left, y: box.top });
});
quickEl.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.stopPropagation();
    closeQuick();
  }
});
document.addEventListener('pointerdown', (event) => {
  if (!quickEl.hidden && !quickEl.contains(event.target)) closeQuick();
});
// "/" jumps to the command bar, unless you are already typing somewhere.
window.addEventListener('keydown', (event) => {
  const isTyping = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  if (event.key === '/' && !isTyping && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    commandInput.focus();
  }
});

async function sendToAgent(agent, text) {
  try {
    await window.__TAURI__.core.invoke('send_to_agent', { sessionId: agent.id, text });
    showToast(`${taskTitle(agent)}: mensagem enviada`);
  } catch (err) {
    showToast(String(err), true);
  }
}

async function moveToCursor(agent) {
  showToast(`Levando ${taskTitle(agent)} para o Cursor…`);
  try {
    showToast(await window.__TAURI__.core.invoke('move_to_cursor', { sessionId: agent.id }));
  } catch (err) {
    showToast(String(err), true);
  }
}

function focusApproval(approval) {
  const card = approvalsEl.querySelector(`[data-approval="${approval.id}"]`);
  card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  card?.querySelector('button')?.focus();
}

const replyEl = document.getElementById('reply');
const replyBackdrop = document.getElementById('reply-backdrop');
const replyText = document.getElementById('reply-text');
let replyAgent = null;

function openReply(agent) {
  replyAgent = agent;
  document.getElementById('reply-for').textContent = taskTitle(agent);
  document.getElementById('reply-last').textContent = agent.lastReply ?? '';
  replyText.value = '';
  replyEl.hidden = false;
  replyBackdrop.hidden = false;
  replyText.focus();
}

function closeReply() {
  replyEl.hidden = true;
  replyBackdrop.hidden = true;
  replyAgent = null;
}

async function sendReply() {
  const text = replyText.value.trim();
  if (!text || !replyAgent) return;
  const agent = replyAgent;
  closeReply();
  await sendToAgent(agent, text);
}

document.getElementById('reply-send').addEventListener('click', sendReply);
document.getElementById('reply-cancel').addEventListener('click', closeReply);
document.getElementById('reply-close').addEventListener('click', closeReply);
replyBackdrop.addEventListener('click', closeReply);
replyEl.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.stopPropagation();
    closeReply();
  } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    sendReply();
  }
});

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = el('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const isCopied = document.execCommand('copy');
    area.remove();
    return isCopied;
  }
}

// The extension ignores prompts for an already open tab, so the text goes via the clipboard.
async function continueAgent(agent) {
  const isCopied = await copyText(CONTINUE_PROMPT);
  await openSession(agent.id);
  showToast(isCopied ? 'Pedido copiado: na aba do Cursor, Ctrl+V e Enter' : 'Não consegui copiar; a aba está aberta para você escrever');
}

// Right-click on a recruit acts on the whole selection when it is part of it, else on that one.
function crewFor(id) {
  const picked = [...empire.selected].filter((other) => crewMember(other));
  return empire.selected.has(id) && picked.length > 1 ? picked : [id];
}

function baseHint(project) {
  const crew = rawAgents.filter((agent) => !isObserver(agent) && agent.project === project);
  const folder = empire.displayName(project) === project ? '' : `pasta ${project} · `;
  return `${folder}${statusSummary(crew) || 'Nenhum aldeão agora'}`;
}

// "Mandar para…": the bases on the map, by name. Picking one opens the order, as clicking that base does.
function sendToMenu(ids, except = null) {
  const items = empire
    .baseProjects()
    .filter((project) => project !== except)
    .sort((a, b) => empire.displayName(a).localeCompare(empire.displayName(b), 'pt-BR'))
    .map((project) => ({ label: empire.displayName(project), swatch: projectColor(project), hint: baseHint(project), onSelect: () => openOrder(ids, project) }));
  if (items.length === 0) items.push({ label: 'Nenhuma outra base no mapa', hint: 'Construa uma com B, ou use a terra livre', disabled: true });
  return { title: 'Mandar para…', items };
}

function openRecruitMenu(id, recruit, anchor, opener) {
  const crew = crewFor(id);
  const send = sendToMenu(crew);
  // A repository off the map: the full dialog finds it in ~/Code, stakes its land and this recruit walks there.
  if (crew.length === 1) {
    send.items.push(
      { section: 'Fora do mapa' },
      {
        icon: 'search',
        label: 'Outro repositório…',
        hint: 'Busca em ~/Code; a base nasce e ele vai para lá',
        onSelect: () => deployDialog.open(null, '', null, DEFAULT_DEPLOY_MODE, (project) => empire.sendRecruits([id], project.name)),
      },
    );
  }
  actionMenu.open(anchor, crew.length > 1 ? `${crew.length} selecionados` : 'Recruta', [
    recruit.target
      ? { icon: 'send', label: `A caminho de ${empire.displayName(recruit.target)}`, hint: 'A sessão já começou lá', disabled: true }
      : { icon: 'send', label: 'Mandar trabalhar em…', hint: 'Escolha a base e escreva a tarefa', submenu: send },
    { icon: 'user-x', label: 'Dispensar', hint: 'Ele sai do mapa pela estrada; nenhuma sessão começou', onSelect: () => empire.dismissRecruit(id) },
  ], opener);
}

function openAgentMenu(id, anchor, opener = null) {
  const recruit = empire.recruitOf(id);
  if (recruit) {
    openRecruitMenu(id, recruit, anchor, opener);
    return;
  }
  const agent = agents.find((a) => a.id === id);
  if (agent) actionMenu.open(anchor, taskTitle(agent), agentActions(agent), opener);
}

function openLandMenu(spot, anchor, ground) {
  actionMenu.open(anchor, 'Terra livre', [
    { icon: 'user-plus', label: 'Recrutar aldeão aqui', hint: 'Aparece neste ponto, já selecionado: clique numa base para mandá-lo trabalhar', onSelect: () => summonRecruit(ground) },
    { icon: 'map-pin', label: 'Nova base aqui…', hint: 'Escolha o repositório e a tarefa; a base nasce neste lugar (ou só a base, sem agente)', onSelect: () => deployDialog.open(spot) },
  ]);
}

// ---------- Session history: past Claude conversations of a repository, to pick one back up ----------

const DAY_MS = 24 * 60 * 60 * 1000;
const RESUME_TASK_MAX = 4000;
const RESUME_HINTS = { office: 'Retomando aqui no app', cursor: 'Retomando no Cursor', terminal: 'Retomando no terminal' };

function sessionAge(at, now = Date.now()) {
  return now - at >= DAY_MS ? `${Math.floor((now - at) / DAY_MS)}d` : formatElapsed(at, now);
}

async function resumeSession(project, path, session, mode, task = '') {
  try {
    showToast(await window.__TAURI__.core.invoke('resume_session', { path, sessionId: session.id, mode, task }));
    empire.reserveLand(null, project, RESUME_HINTS[mode]);
  } catch (err) {
    showToast(String(err), true);
  }
}

// A session still open is already a villager: resuming it again would put two processes on one conversation.
function sessionActions(project, path, session) {
  if (agents.some((agent) => agent.id === session.id)) {
    return [{ icon: 'external', label: 'Abrir a sessão', hint: 'Ela está aberta agora: foca a aba e acende o aldeão', onSelect: () => openSession(session.id) }];
  }
  const nextTurn = {
    field: {
      label: 'Próximo pedido',
      placeholder: 'O que ele faz agora',
      maxLength: RESUME_TASK_MAX,
      hint: 'A conversa continua aqui no app com este pedido; aprovações aparecem no painel.',
      submitLabel: 'Enviar',
      onSubmit: (text) => resumeSession(project, path, session, 'office', text),
    },
  };
  return [
    { icon: 'send', label: 'Continuar aqui no app', hint: 'Escreva o próximo pedido e Enter', submenu: { title: session.title, items: [nextTurn] } },
    { icon: 'terminal', label: 'Retomar no terminal', hint: 'Terminal novo com claude --resume, na pasta onde ela rodou', onSelect: () => resumeSession(project, path, session, 'terminal') },
    { icon: 'external', label: 'Retomar no Cursor', hint: 'Abre a conversa numa aba do Claude', onSelect: () => resumeSession(project, path, session, 'cursor') },
  ];
}

function sessionHint(session, path, now) {
  const isOpen = agents.some((agent) => agent.id === session.id);
  const folder = session.cwd === path ? null : session.cwd.slice(path.length + 1); // started in a subfolder
  const prompt = session.lastPrompt && session.lastPrompt !== session.title ? `“${session.lastPrompt}”` : null;
  return [isOpen ? 'aberta agora' : `há ${sessionAge(session.updatedAt, now)}`, folder, prompt].filter(Boolean).join(' · ');
}

// Read when opened, so the list is as fresh as the transcripts on disk.
function sessionHistoryMenu(project, path) {
  return async () => {
    const title = `Histórico · ${empire.displayName(project)}`;
    let sessions;
    try {
      sessions = await window.__TAURI__.core.invoke('list_sessions', { path });
    } catch (err) {
      return { title, items: [{ label: 'Não consegui ler o histórico', hint: String(err), disabled: true }] };
    }
    if (sessions.length === 0) {
      return { title, items: [{ label: 'Nenhuma sessão de IA aqui ainda', hint: 'As conversas do Claude Code neste repositório aparecem aqui', disabled: true }] };
    }
    const now = Date.now();
    return {
      title,
      items: sessions.map((session) => ({
        label: session.title,
        hint: sessionHint(session, path, now),
        submenu: { title: session.title, items: sessionActions(project, path, session) },
      })),
    };
  };
}

function openBaseMenu(project, anchor) {
  const isPinned = empire.isPinned(project);
  const name = empire.displayName(project);
  const path = empire.repoPathOf(project);
  const waiting = empire.idleRecruitIds();
  // Right-click trains at once: the task box comes focused, Enter starts it the usual way. Where it
  // runs and several at once live in the town center's card ("Personalizar treino"), renaming in
  // "Personalizar base", not here twice.
  const items = [
    {
      field: {
        label: 'Tarefa do novo aldeão',
        placeholder: 'Treinar aldeão: a tarefa dele',
        hint: 'Enter: abre uma aba do Claude no Cursor já com a tarefa',
        submitLabel: 'Treinar',
        onSubmit: (text) => deployToRepo(project, text, DEFAULT_DEPLOY_MODE),
      },
    },
    {
      icon: 'sliders',
      label: 'Personalizar treino…',
      hint: 'Onde ele roda (aqui no app, no Cursor ou no terminal) e vários aldeões de uma vez, cada um com a sua tarefa',
      onSelect: () => baseCard.open(project, anchor),
    },
  ];
  if (waiting.length > 0) {
    items.push({
      icon: 'send',
      label: waiting.length > 1 ? `Mandar os ${waiting.length} recrutas para cá` : 'Mandar o recruta para cá',
      hint: 'Escreva a tarefa; cada um vira uma sessão nova neste repositório',
      onSelect: () => openOrder(waiting, project),
    });
  }
  items.push(
    {
      icon: 'history',
      label: 'Histórico de sessões',
      hint: path ? 'Retomar uma conversa antiga do Claude neste repositório' : 'Ainda não sei a pasta deste repositório',
      disabled: !path,
      submenu: sessionHistoryMenu(project, path),
    },
    { divider: true },
    { icon: 'brush', label: 'Personalizar base…', hint: 'Era, tamanho, giro, estilo da cidade, cor do time e nome no mapa', onSelect: () => designDialog.open(project) },
    { icon: 'rotate', label: 'Girar castelo', hint: 'Um quarto de volta, na vista 3D', onSelect: () => empire.rotateDesign(project) },
    { icon: 'move', label: 'Mover base', hint: 'A base segue o ponteiro; clique onde ela fica. Esc cancela', onSelect: () => empire.startPlacing(project, path) },
    { icon: 'square-plus', label: 'Fundar base vizinha…', hint: 'Outro repositório colado a este, para juntar os que andam juntos', onSelect: () => deployDialog.open(empire.spotBeside(project)) },
    { divider: true },
    isPinned
      ? { icon: 'pin-off', label: 'Não fixar mais', hint: 'A base sai do mapa quando não tiver agentes', onSelect: () => empire.unpinBase(project) }
      : { icon: 'pin', label: 'Fixar no mapa', hint: 'A base fica neste lugar mesmo sem agentes', onSelect: () => empire.pinBase(project) },
    {
      icon: 'copy',
      label: 'Copiar caminho',
      hint: path ?? 'Ainda não sei a pasta deste repositório',
      disabled: !path,
      onSelect: async () => {
        const isCopied = await copyText(path);
        showToast(isCopied ? `Caminho copiado: ${path}` : 'Não consegui copiar o caminho', !isCopied);
      },
    },
    { icon: 'eye-off', label: 'Remover da vila', hint: 'Some do mapa com os aldeões; volta em Configurações › Bases no mapa', onSelect: () => empire.setHidden(project, true) },
  );
  actionMenu.open(anchor, name === project ? project : `${name} · ${project}`, items);
}

// ---------- Orders: picked villagers sent to work at another repository ----------

const orderEl = document.getElementById('order');
const orderBackdrop = document.getElementById('order-backdrop');
const orderTask = document.getElementById('order-task');
const orderSubmit = document.getElementById('order-submit');
let order = null; // { ids, project }

function deliveryLabel(agent) {
  if (agent.isRecruit) return 'novo agente, abre no Cursor na pasta do repositório';
  if (hostedIds.has(agent.id)) return 'chega direto';
  if (agent.editor) return `vai copiado e a aba do ${agent.editor} abre`;
  return 'sessão de terminal: mande por lá';
}

const ORDER_HINT = document.getElementById('order-hint').textContent;
const RECRUIT_ORDER_HINT = 'Cada recruta vira uma sessão nova que começa na pasta do repositório, com esta tarefa. No mapa ele entra no Centro da Cidade e sai trabalhando.';

// A picked villager: a live agent, or a recruit with no session yet (one already on its way is not anyone's to order).
function crewMember(id) {
  const recruit = empire.recruitOf(id);
  if (recruit) return recruit.target ? null : recruit;
  return agents.find((a) => a.id === id) ?? null;
}

function openOrder(ids, project) {
  const crew = ids.map(crewMember).filter(Boolean);
  if (crew.length === 0) return;
  order = { ids: crew.map((a) => a.id), project };
  const isCrew = crew.length > 1; // several picked: each one gets its own task under its name
  const isHome = crew.every((a) => a.project === project);
  const isAllRecruits = crew.every((a) => a.isRecruit);
  const path = empire.repoPathOf(project);
  document.getElementById('order-title').textContent = `Mandar para ${project}`;
  document.getElementById('order-who').replaceChildren(
    ...crew.map((agent) => {
      const item = el('li');
      item.style.setProperty('--team', agent.isRecruit ? RECRUIT_CLOTH.tunic : agentColor(agent));
      item.append(el('span', 'swatch'), el('strong', null, taskTitle(agent)), el('small', null, deliveryLabel(agent)));
      if (isCrew) {
        const own = el('textarea', 'field order-own');
        own.rows = 2;
        own.spellcheck = false;
        own.dataset.id = agent.id;
        own.placeholder = `O que este faz em ${project}`;
        own.setAttribute('aria-label', `Tarefa de ${taskTitle(agent)}`);
        item.append(own);
      }
      return item;
    }),
  );
  document.getElementById('order-task-label').textContent = isCrew ? 'Para todos (vai antes da tarefa de cada um)' : 'O que ele deve fazer lá';
  // A recruit's session already starts in the repository: the order is just the task.
  if (isCrew) orderTask.placeholder = 'Opcional: contexto que todos recebem';
  else orderTask.placeholder = isAllRecruits ? `O que ele faz em ${project}` : '';
  document.getElementById('order-hint').textContent = crew.some((a) => a.isRecruit) ? RECRUIT_ORDER_HINT : ORDER_HINT;
  if (isAllRecruits) orderTask.value = '';
  else orderTask.value = isHome ? `Volte a trabalhar em ${project}. ` : `Agora trabalhe no repositório ${project}${path ? ` (${path})` : ''}. `;
  orderEl.hidden = false;
  orderBackdrop.hidden = false;
  if (isCrew) {
    orderEl.querySelector('.order-own').focus();
    return;
  }
  orderTask.focus();
  orderTask.setSelectionRange(orderTask.value.length, orderTask.value.length);
}

function closeOrder() {
  orderEl.hidden = true;
  orderBackdrop.hidden = true;
  order = null;
}

// The recruit's session starts in the repository's folder, so it reads that repo's CLAUDE.md like any other.
async function deployRecruit(project, text) {
  const path = empire.repoPathOf(project);
  if (!path) {
    showToast(`Não sei a pasta de ${project}: use "Treinar aldeão" na base`, true);
    return false;
  }
  return deployDialog.deployNow({ name: project, path }, text, DEFAULT_DEPLOY_MODE);
}

// Each one picked gets the shared text plus its own task (a recruit gets it as its first task); anyone
// left with nothing to do stays put. Only the ones that got it move on the map.
async function submitOrder() {
  if (!order) return;
  const shared = orderTask.value.trim();
  const ownTasks = new Map([...orderEl.querySelectorAll('.order-own')].map((field) => [field.dataset.id, field.value.trim()]));
  const { ids, project } = order;
  const crew = ids.map(crewMember).filter(Boolean);
  const messages = new Map(crew.map((agent) => [agent.id, [shared, ownTasks.get(agent.id)].filter(Boolean).join('\n\n')]));
  if (![...messages.values()].some(Boolean)) return;
  orderSubmit.disabled = true;
  const sent = [];
  const recruited = [];
  for (const agent of crew) {
    const text = messages.get(agent.id);
    if (!text) continue;
    if (agent.isRecruit) {
      if (await deployRecruit(project, text)) recruited.push(agent.id);
    } else if (await deliverCommand(agent, text)) sent.push(agent.id);
  }
  orderSubmit.disabled = false;
  const count = sent.length + recruited.length;
  if (count === 0) return;
  if (sent.length > 0) empire.orderTo(sent, project);
  if (recruited.length > 0) empire.sendRecruits(recruited, project);
  closeOrder();
  showToast(count > 1 ? `${count} aldeões a caminho de ${project}` : `A caminho de ${project}`);
}

orderSubmit.addEventListener('click', submitOrder);
orderEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    submitOrder();
  }
});
document.getElementById('order-cancel').addEventListener('click', closeOrder);
document.getElementById('order-close').addEventListener('click', closeOrder);
orderBackdrop.addEventListener('click', closeOrder);
orderEl.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.stopPropagation();
    closeOrder();
  }
});

// Picked villagers: a bar on the map says how many and what a right-click on a base does.
const selectionBar = document.getElementById('selection-bar');

function renderSelection(ids) {
  for (const card of listEl.querySelectorAll('.card')) card.classList.toggle('is-picked', ids.includes(card.dataset.id));
  selectionBar.hidden = ids.length === 0;
  if (ids.length === 0) return;
  const first = crewMember(ids[0]);
  const recruits = ids.filter((id) => empire.recruitOf(id)).length;
  const who = ids.length > 1 ? `${ids.length} ${recruits === ids.length ? 'recrutas selecionados' : 'aldeões selecionados'}` : `${first ? taskTitle(first) : 'Aldeão'} selecionado`;
  const what = recruits > 0 ? 'clique numa base para pôr para trabalhar lá · botão direito no chão: mover' : 'clique numa base para mandar para lá';
  document.getElementById('selection-text').textContent = `${who} · ${what} · Shift+clique soma`;
}

document.getElementById('selection-clear').addEventListener('click', () => empire.setSelection([]));
document.getElementById('selection-all').addEventListener('click', () => empire.selectAll());
window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || selectionBar.hidden) return;
  const isOverlayOpen = [orderEl, settingsEl, document.getElementById('deploy'), document.getElementById('design')].some((node) => !node.hidden);
  if (!isOverlayOpen) empire.setSelection([]);
});

function readMapView() {
  try {
    const view = JSON.parse(localStorage.getItem(MAP_VIEW_KEY) ?? 'null');
    if (view?.v === MAP_VIEW_VERSION) return view;
    return { mode: '3d', rotation: 0 }; // first run of v2: open in 3D (it falls back to 2D without WebGL)
  } catch {
    return { mode: '3d', rotation: 0 };
  }
}

function readLayout() {
  try {
    const layout = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? 'null');
    return layout && typeof layout === 'object' ? layout : {};
  } catch {
    return {};
  }
}

function saveLayout(layout) {
  campaign.observeLayout(layout);
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // the map keeps this layout until the app closes
  }
  if (!settingsEl.hidden) renderBaseList();
}

// Settings › Bases no mapa: pinned and hidden repositories, plus the ones with agents right now.
function renderBaseList() {
  const crews = new Map();
  for (const agent of rawAgents) if (!isObserver(agent)) crews.set(agent.project, (crews.get(agent.project) ?? 0) + 1);
  const { pinned, hidden } = empire.getLayout();
  const projects = [...new Set([...Object.keys(pinned), ...hidden, ...crews.keys()])].sort((a, b) => a.localeCompare(b));
  const rows = projects.map((project) => {
    const isPinned = project in pinned;
    const isHidden = hidden.includes(project);
    const count = crews.get(project) ?? 0;
    const item = el('li', 'base-row');
    item.classList.toggle('is-hidden', isHidden);
    item.style.setProperty('--team', projectColor(project));
    const text = el('span', 'base-row-text');
    const design = empire.designOf(project);
    const look = `${ERAS.find((e) => e.id === design.era)?.name} · ${TOWN_STYLES.find((s) => s.id === design.style)?.name}`;
    // Pinned is the usual case and the pin button already shows it; only the exceptions get a word.
    const status = [isPinned ? null : 'temporária', isHidden ? 'escondida' : null, count ? `${count} agente${count > 1 ? 's' : ''}` : null, look];
    const name = el('strong', null, project);
    name.title = project; // long names are cut with an ellipsis
    text.append(name, el('small', null, status.filter(Boolean).join(' · ')));
    const pin = el('button', 'icon-button');
    pin.type = 'button';
    pin.setAttribute('aria-pressed', String(isPinned));
    pin.setAttribute('aria-label', `Fixar ${project} no mapa`);
    pin.title = isPinned ? 'Fixa: fica no mapa mesmo sem agentes. Clique para desafixar.' : 'Temporária: some quando não há agentes. Clique para fixar.';
    pin.append(icon(isPinned ? 'pin' : 'pin-off', 'base-row-icon'));
    pin.addEventListener('click', () => (isPinned ? empire.unpinBase(project) : empire.pinBase(project)));
    const customize = el('button', 'icon-button');
    customize.type = 'button';
    customize.setAttribute('aria-label', `Personalizar ${project}`);
    customize.title = 'Personalizar: era, tamanho e estilo da cidade';
    customize.append(icon('brush', 'base-row-icon'));
    customize.addEventListener('click', () => {
      setSettingsOpen(false);
      designDialog.open(project);
    });
    const show = el('label', 'toggle base-row-show');
    show.title = 'Mostrar no mapa';
    const checkbox = el('input');
    checkbox.type = 'checkbox';
    checkbox.setAttribute('role', 'switch');
    checkbox.checked = !isHidden;
    checkbox.setAttribute('aria-label', `Mostrar ${project} no mapa`);
    checkbox.addEventListener('change', () => empire.setHidden(project, !checkbox.checked));
    const track = el('span', 'toggle-track');
    track.setAttribute('aria-hidden', 'true');
    show.append(checkbox, track);
    item.append(el('span', 'swatch'), text, pin, customize, show);
    return item;
  });
  if (rows.length === 0) rows.push(el('li', 'base-empty', 'Nenhuma base ainda. Adicione um repositório ou coloque um agente para trabalhar.'));
  document.getElementById('base-list').replaceChildren(...rows);
}

function markLinked(id) {
  linkedId = id;
  for (const node of document.querySelectorAll('.card[data-id], .approval[data-session]')) {
    node.classList.toggle('is-linked', (node.dataset.id ?? node.dataset.session) === id);
  }
  if (id) listEl.querySelector(`.card[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
}

// Hovering a card or a pending approval lights that agent's villager and base on the map.
// Delegated, so it survives the list being rebuilt under the pointer on every snapshot.
function linkOnHover(container, selector, idOf) {
  container.addEventListener('pointerover', (event) => {
    const node = event.target.closest(selector);
    empire.setLinkedAgent(node ? idOf(node) : null);
  });
  container.addEventListener('pointerleave', () => empire.setLinkedAgent(null));
}

function taskTitle(agent) {
  return agent.title || agent.name;
}

function dismissAgent(agent) {
  dismissed.add(agent.id);
  saveDismissed();
  refreshView();
  showToast(`${taskTitle(agent)}: fechado no mapa`, false, {
    label: 'Desfazer',
    onClick: () => {
      dismissed.delete(agent.id);
      saveDismissed();
      refreshView();
    },
  });
}

async function endSession(agent) {
  showToast(`Encerrando ${agent.name}…`);
  try {
    await window.__TAURI__.core.invoke('end_session', { sessionId: agent.id });
    showToast(`${taskTitle(agent)}: encerrado`);
  } catch (err) {
    showToast(String(err), true);
  }
}

function renderSubagents(subagents) {
  const list = el('span', 'card-subs');
  for (const sub of subagents) {
    const row = el('span', 'sub');
    row.style.setProperty('--kind', kindInfo(sub.activity.kind).color);
    const text = sub.description ? `${sub.description} · ${sub.activity.label}` : sub.activity.label;
    row.append(el('i', 'dot'), el('span', 'sub-type', sub.type), el('span', 'sub-label', text));
    list.append(row);
  }
  return list;
}

function readPref(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === '1';
  } catch {
    return fallback; // storage blocked: use the default
  }
}

function savePref(key, value) {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    // a lost preference only means the toggle starts at its default next time
  }
}

// SDK sessions (claude-mem observers) start and stop all the time: they never make noise.
function playTransitions(next) {
  const before = previousById;
  previousById = new Map(next.map((agent) => [agent.id, agent]));
  if (!before) return; // first snapshot after (re)load is the baseline
  let hasFinished = false;
  const needsYou = [];
  for (const agent of next) {
    const previous = before.get(agent.id);
    if (!previous || isObserver(agent)) continue;
    if (needsAttention(agent) && !needsAttention(previous)) needsYou.push(agent);
    else if (previous.status === 'busy' && agent.status === 'idle') hasFinished = true;
  }
  // The toast shows even with the sound off: it is how a muted map still tells you who is blocked.
  if (needsYou.length) toastNeedsYou(needsYou);
  if (!isSoundOn) return;
  if (needsYou.length) sfx.playNeedsYou();
  else if (hasFinished) sfx.playFinished();
}

function toastNeedsYou(list) {
  const [first] = list;
  const message = list.length === 1 ? `${taskTitle(first)} precisa de você · ${first.activity.label}` : `${list.length} agentes precisam de você`;
  showToast(message, false, { label: 'Ver', onClick: () => revealAgent(first.id) }, NEEDS_YOU_TOAST_MS);
}

// Same popover as a click on the card: it carries the approve / deny / answer buttons.
function revealAgent(id) {
  const card = listEl.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
  if (!card?.offsetParent) {
    openQuick(id, { x: window.innerWidth / 2, y: 56 }); // list hidden (map only): under the toast
    return;
  }
  card.scrollIntoView({ block: 'nearest' });
  openQuick(id, card);
}

function countByRank(list) {
  const counts = [0, 0, 0, 0];
  for (const agent of list) counts[attentionRank(agent)]++;
  return counts;
}

function statusSummary(list) {
  const [blocked, yourTurn, working, observing] = countByRank(list);
  const parts = [];
  if (blocked) parts.push(`${blocked} precisa${blocked > 1 ? 'm' : ''} de você`);
  if (yourTurn) parts.push(`${yourTurn} sua vez`);
  if (working) parts.push(`${working} trabalhando`);
  if (observing) parts.push(`${observing} observando`);
  return parts.join(' · ');
}

// One chip per attention rank (colored square + number) so the header never wraps; the
// spelled-out summary goes to the tooltip and the toggle's accessible name.
function groupChips(members) {
  const chips = el('span', 'group-chips');
  chips.setAttribute('aria-hidden', 'true');
  countByRank(members).forEach((count, rank) => {
    if (count === 0) return;
    const chip = el('span', 'group-chip', String(count));
    chip.dataset.rank = String(rank);
    chips.append(chip);
  });
  return chips;
}

function renderSections(sorted) {
  const items = [];
  let currentRank = -1;
  const counts = countByRank(sorted);
  for (const agent of sorted) {
    const rank = attentionRank(agent);
    if (rank !== currentRank) {
      currentRank = rank;
      const head = el('li', 'section-head', `${SECTIONS[rank]} · ${counts[rank]}`);
      head.dataset.rank = String(rank);
      items.push(head);
    }
    items.push(renderCard(agent));
  }
  return items;
}

function renderCounts() {
  const [blocked, yourTurn, working] = countByRank(agents);
  const pills = [
    [blocked, `${blocked} precisa${blocked === 1 ? '' : 'm'} de você`, 'pill-blocked'],
    [conflicts.size, `${conflicts.size} em conflito`, 'pill-conflict'],
    [yourTurn, `${yourTurn} sua vez`, 'pill-yourturn'],
    [working, `${working} trabalhando`, 'pill-working'],
  ].filter(([count]) => count > 0);
  countsEl.replaceChildren(...pills.map(([, text, className]) => el('span', `pill ${className}`, text)));
  if (pills.length === 0) countsEl.textContent = 'Nenhuma sessão aberta';
  document.title = blocked ? `(! ${blocked}) Agent of Empires` : yourTurn ? `(${yourTurn}) Agent of Empires` : 'Agent of Empires';
}

// Projects with someone needing you come first, then the busiest, then by name.
function renderGroups(sorted) {
  const byProject = new Map();
  for (const agent of sorted) {
    if (!byProject.has(agent.project)) byProject.set(agent.project, []);
    byProject.get(agent.project).push(agent);
  }
  const groups = [...byProject.entries()].sort(
    ([nameA, a], [nameB, b]) => attentionRank(a[0]) - attentionRank(b[0]) || nameA.localeCompare(nameB),
  );
  return groups.map(([project, members]) => {
    const item = el('li', 'group');
    item.style.setProperty('--team', projectColor(project));
    const isCollapsed = collapsedProjects.has(project);
    const head = el('div', 'group-head');
    const summary = statusSummary(members);
    // The name collapses the group; on hover "+ Agente" takes the chips' place and deploys here.
    const toggle = el('button', 'group-toggle');
    toggle.type = 'button';
    const name = empire.displayName(project);
    toggle.title = `${name === project ? project : `${name} · pasta ${project}`}\n${summary}`;
    toggle.setAttribute('aria-expanded', String(!isCollapsed));
    toggle.setAttribute('aria-label', `${name}: ${summary}`);
    toggle.append(el('span', 'group-caret', isCollapsed ? '▸' : '▾'), el('span', 'swatch'), el('strong', 'group-name', name));
    toggle.addEventListener('click', () => toggleProject(project));
    const add = el('button', 'group-add', '+ Agente');
    add.type = 'button';
    add.setAttribute('aria-label', `Novo agente em ${project}`);
    add.addEventListener('click', () => deployDialog.open(null, '', project));
    const meta = el('span', 'group-meta');
    meta.append(groupChips(members), add);
    head.append(toggle, meta);
    item.append(head);
    if (!isCollapsed) {
      const list = el('ol', 'group-list');
      list.append(...members.map(renderCard));
      item.append(list);
    }
    return item;
  });
}

function renderPanel() {
  const focusedId = document.activeElement?.dataset?.id;
  const sorted = [...agents].sort(compareAgents);
  listEl.replaceChildren(...(isGrouped ? renderGroups(sorted) : renderSections(sorted)));
  if (hiddenCount > 0) listEl.append(renderDismissedRow());
  if (focusedId) listEl.querySelector(`[data-id="${CSS.escape(focusedId)}"]`)?.focus();
  renderCounts();
  renderCommandTargets();
  emptyEl.hidden = agents.length > 0;
}

// "reinicia em 34min (22:00)" within a day, "reinicia dom 04:00" beyond, in local time.
function formatReset(resetsAt, now = Date.now()) {
  if (!Number.isFinite(resetsAt)) return '';
  const minutes = Math.max(0, Math.round((resetsAt - now) / 60000));
  const local = new Date(resetsAt);
  const clock = `${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`;
  if (minutes >= 24 * 60) return `reinicia ${WEEKDAYS[local.getDay()]} ${clock}`;
  const inText = minutes < 60 ? `${minutes}min` : `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`;
  return `reinicia em ${inText} (${clock})`;
}

// Balloons over the town centers: the tokens each base's agents spent since the plan's session
// window opened, and its part of the session's percent (split by each base's weighted share).
// Without the limits (turned off, or no window open) they show the last 5 h of tokens alone.
function renderSpend() {
  if (!empireStats) return;
  const session = isLimitsOn ? usage?.limits.find((limit) => limit.kind === 'session') : null;
  const isWindowOpen = Boolean(session) && session.resetsAt > Date.now();
  const spend = new Map();
  for (const repo of empireStats.repos) {
    if (!repo.tokensSession) continue;
    spend.set(repo.name, {
      tokens: repo.tokensSession,
      percent: isWindowOpen ? repo.sessionShare * session.percent : null,
      sessionPercent: isWindowOpen ? session.percent : null,
      severity: session ? limitSeverity(session) : 'normal',
    });
  }
  empire.setSpend(spend);
}

function spendSummary(project) {
  const spend = empire.spendOf(project);
  if (!spend) return null;
  const tokens = `${formatResource('tokens', spend.tokens)} tokens`;
  if (spend.percent === null) return `${tokens} nas últimas 5 h`;
  const percent = spend.percent > 0 && spend.percent < 1 ? 'menos de 1%' : `${Math.round(spend.percent)}%`;
  return `${tokens} nesta sessão: ≈${percent} da sessão de 5 h, que está em ${Math.round(spend.sessionPercent)}%`;
}

// Past the backend's ALERT_PERCENT a limit always reads critical, whatever severity the API sent,
// until its window resets (a stale copy can still hold a window that already rolled over).
function isLimitAlarming(limit, now = Date.now()) {
  return limit.percent >= LIMIT_ALERT_PERCENT && !(Number.isFinite(limit.resetsAt) && limit.resetsAt <= now);
}

function limitSeverity(limit) {
  return isLimitAlarming(limit) ? 'critical' : limit.severity;
}

// The clear warning over the bars: which limits are near the end and when each one frees up.
function renderLimitAlert(limits) {
  const alert = el('div', 'limit-alert');
  alert.setAttribute('role', 'status');
  const isExhausted = limits.some((limit) => limit.percent >= 100);
  alert.append(el('strong', 'limit-alert-title', isExhausted ? '⚠ Limite do Claude esgotado' : '⚠ Limite do Claude quase no fim'));
  for (const limit of limits) {
    const line = el('span', 'limit-alert-line', `${limit.label}: ${Math.round(limit.percent)}%`);
    if (Number.isFinite(limit.resetsAt)) {
      const reset = el('span', '', formatReset(limit.resetsAt));
      reset.dataset.resets = String(limit.resetsAt);
      line.append(' · ', reset);
    }
    alert.append(line);
  }
  return alert;
}

function renderLimits() {
  renderSpend(); // the balloons split the session bar: they follow it
  const limits = usage?.limits ?? [];
  limitsEl.hidden = !isLimitsOn || limits.length === 0;
  if (limitsEl.hidden) return;
  const fetchedAt = new Date(usage.fetchedAt);
  limitsEl.title = `Atualizado às ${String(fetchedAt.getHours()).padStart(2, '0')}:${String(fetchedAt.getMinutes()).padStart(2, '0')}, a cada 1 min`;
  const rows = limits.map((limit) => {
    const row = el('div', 'limit');
    row.dataset.severity = limitSeverity(limit);
    row.dataset.label = limit.label;
    const bar = el('span', 'limit-bar');
    const fill = el('span', 'limit-fill');
    fill.style.width = `${Math.min(100, Math.max(0, limit.percent))}%`;
    bar.append(fill);
    const reset = el('span', 'limit-reset', formatReset(limit.resetsAt));
    if (Number.isFinite(limit.resetsAt)) reset.dataset.resets = String(limit.resetsAt);
    row.append(el('span', 'limit-label', limit.label), bar, el('strong', 'limit-percent', `${Math.round(limit.percent)}%`), reset);
    return row;
  });
  if (usage.isStale) rows.push(el('p', 'limit-stale', `Sem conexão: dados de ${formatElapsed(usage.fetchedAt)} atrás`));
  const alarming = limits.filter((limit) => isLimitAlarming(limit));
  if (alarming.length) rows.unshift(renderLimitAlert(alarming));
  limitsEl.replaceChildren(...rows);
}

function applyUsage(next) {
  if (!next) return;
  usage = next;
  renderLimits();
}

// A pressing plan limit reset; the backend holds this until the map is in view, so it greets you
// on opening the app: the charge on a bugle, a toast and the fresh bars glowing.
function celebrateLimitReset(limits) {
  if (!limits?.length) return;
  const labels = limits.map((limit) => limit.label);
  const names = labels.length > 1 ? `${labels.slice(0, -1).join(', ')} e ${labels.at(-1)}` : labels[0];
  showToast(`Limite do Claude reiniciado: ${names}. Os aldeões podem voltar ao trabalho!`);
  if (isSoundOn) sfx.playLimitReset();
  for (const row of limitsEl.querySelectorAll('.limit')) row.classList.toggle('is-reset', labels.includes(row.dataset.label));
}

function renderDismissedRow() {
  const row = el('li', 'dismissed-row');
  const button = el('button', 'link-button', 'Mostrar');
  button.type = 'button';
  button.addEventListener('click', () => {
    dismissed.clear();
    saveDismissed();
    refreshView();
  });
  row.append(el('span', null, `${hiddenCount} fechado${hiddenCount > 1 ? 's' : ''} no mapa`), button);
  return row;
}

function selectAgent(id) {
  selectedId = id;
  empire.highlightAgent(id);
  for (const card of listEl.querySelectorAll('.card')) card.classList.toggle('is-selected', card.dataset.id === id);
  listEl.querySelector(`[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function showToast(message, isError = false, action = null, ms = TOAST_MS) {
  toastEl.replaceChildren(el('span', null, message));
  if (action) {
    const button = el('button', 'toast-action', action.label);
    button.type = 'button';
    button.addEventListener('click', () => {
      toastEl.hidden = true;
      action.onClick();
    });
    toastEl.append(button);
  }
  toastEl.classList.toggle('is-error', isError);
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.hidden = true;
  }, ms);
}

async function openSession(id) {
  const agent = agents.find((a) => a.id === id);
  if (!agent || openingId === id) return;
  selectAgent(id);
  if (!agent.editor) {
    showToast('Sessão de terminal ou SDK: abra pelo terminal onde ela roda.', true);
    return;
  }
  openingId = id;
  showToast(`Focando a aba de ${agent.name} no ${agent.editor}…`);
  try {
    showToast(await window.__TAURI__.core.invoke('open_session', { sessionId: id }));
  } catch (err) {
    showToast(String(err), true);
  } finally {
    openingId = null;
  }
}

function showTooltip(hit) {
  if (baseCard.isOpen()) {
    tooltipEl.hidden = true; // the town center card is open over the map
    return;
  }
  if (hit?.fog) {
    placeTooltip(hit, [
      ['strong', 'Névoa de guerra'],
      ['span', `${hit.fog} ${hit.fog > 1 ? 'repositórios' : 'repositório'} de ~/Code onde nenhum agente trabalhou ainda`],
      ['small', 'Clique para ver as terras inexploradas e mandar o primeiro agente'],
    ]);
    return;
  }
  if (hit?.square) {
    placeTooltip(hit, [
      ['strong', 'Praça'],
      ['span', 'Poço, mercado e fogueira: aqui descansam os aldeões ociosos e esperam os recrutas'],
      ['small', 'Arraste o mercado ou o calçamento: mudar a praça de lugar (na terra aberta ou de volta à estrada principal)'],
    ]);
    return;
  }
  if (hit?.project) {
    const members = agents.filter((a) => a.project === hit.project);
    const name = empire.displayName(hit.project);
    placeTooltip(hit, [
      ['strong', name],
      ...(name === hit.project ? [] : [['em', `pasta ${hit.project}`]]),
      ['span', statusSummary(members) || 'Nenhum aldeão agora'],
      ['span', spendSummary(hit.project)],
      ['small', 'Clique: treinar aldeões aqui, um ou vários · arraste: mudar a base de lugar · botão direito: treinar na hora, personalizar, fixar ou ocultar'],
    ]);
    return;
  }
  if (hit?.id === KNIGHT_ID) {
    placeTooltip(hit, [
      ['strong', 'O Batedor'],
      ['span', 'Lê o Slack, o Gmail e o Notion e traz missões para as bases'],
      ['small', 'Clique: missões, equipamento e diário (tecla K) · arraste: pegar no colo'],
    ]);
    return;
  }
  const recruit = hit?.id && empire.recruitOf(hit.id);
  if (recruit) {
    placeTooltip(hit, [
      ['strong', 'Recruta'],
      ['span', recruit.target ? `A caminho de ${recruit.target}: a sessão começa lá` : 'Novo agente, ainda sem repositório'],
      ['small', 'Clique: selecionar · depois clique numa base: ele vai trabalhar lá · botão direito: escolher o repositório ou dispensar'],
    ]);
    return;
  }
  const agent = hit && agents.find((a) => a.id === hit.id);
  if (!agent) {
    tooltipEl.hidden = true;
    return;
  }
  const sub = hit.botId && agent.subagents.find((s) => s.id === hit.botId);
  const rows = sub
    ? [['strong', `Subagente ${sub.type}`], ['span', sub.description], ['em', sub.activity.label], ['small', `de ${agent.name}`]]
    : [
        ['strong', agent.name],
        ['span', agent.title],
        ['em', agent.status === 'busy' ? agent.activity.label : 'Aguardando você'],
        ['small', agent.lastPrompt ? `“${agent.lastPrompt}”` : null],
        ['small', agent.editor ? `Clique: opções · duplo clique: abrir no ${agent.editor}` : 'Clique: opções'],
      ];
  placeTooltip(hit, rows);
}

function placeTooltip(hit, rows) {
  tooltipEl.replaceChildren(...rows.filter(([, text]) => text).map(([tag, text]) => el(tag, null, text)));
  tooltipEl.hidden = false;
  const { innerWidth, innerHeight } = window;
  const box = tooltipEl.getBoundingClientRect();
  tooltipEl.style.left = `${Math.min(hit.x + 14, innerWidth - box.width - 8)}px`;
  tooltipEl.style.top = `${Math.min(hit.y + 14, innerHeight - box.height - 8)}px`;
}

// A pending panel approval makes that agent "needs you" everywhere (map, card, sound).
function mergeApprovals(list) {
  const bySession = new Map(approvals.map((approval) => [approval.sessionId, approval]));
  return list.map((agent) => {
    const approval = bySession.get(agent.id);
    if (!approval) return agent;
    const activity = { kind: 'asking', label: `Aprovar: ${approval.label}`, since: approval.requestedAt };
    return { ...agent, status: 'busy', activity };
  });
}

// A closed agent comes back as soon as it works again or needs you: nothing that needs you hides.
function applyDismissed(list) {
  const liveIds = new Set(list.map((agent) => agent.id));
  let changed = false;
  for (const id of dismissed) {
    const agent = list.find((a) => a.id === id);
    if (!liveIds.has(id) || agent?.status === 'busy') {
      dismissed.delete(id);
      changed = true;
    }
  }
  if (changed) saveDismissed();
  const visible = list.filter((agent) => !dismissed.has(agent.id));
  hiddenCount = list.length - visible.length;
  return visible;
}

function refreshView() {
  const merged = mergeApprovals(rawAgents);
  playTransitions(merged);
  agents = applyDismissed(merged);
  conflicts = findConflicts(agents);
  empire.setConflicts(new Set(conflicts.keys()));
  // The map's first sync places everyone where they are; an empty one before the snapshot would
  // make them all walk in instead.
  if (hasSnapshot) empire.setAgents(agents);
  renderFog(); // a first agent in an unexplored repository brings its base out of the fog
  renderResources();
  progress.trackWaiting(agents.filter(isYourTurn));
  checkAchievements();
  renderIdleButton();
  renderPanel();
  renderSelection([...empire.selected]);
  renderApprovals();
  deployDialog.refresh();
}

function applySnapshot(snapshot) {
  if (!snapshot) return;
  hasSnapshot = true;
  rawAgents = snapshot.agents;
  refreshView();
}

function applyApprovals(list) {
  approvals = Array.isArray(list) ? list : [];
  progress.approvalsShown(approvals);
  refreshView();
}

function approvalTimer(expiresAt, now = Date.now()) {
  if (!Number.isFinite(expiresAt)) return 'esperando você';
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  return `o Cursor assume em ${seconds}s`;
}

function renderApprovals() {
  approvalsEl.hidden = approvals.length === 0;
  approvalsEl.replaceChildren(...approvals.map(renderApproval));
}

function renderApproval(approval) {
  const agent = agents.find((a) => a.id === approval.sessionId);
  const item = el('li', 'approval');
  item.dataset.approval = String(approval.id);
  item.dataset.session = approval.sessionId;
  item.classList.toggle('is-linked', approval.sessionId === linkedId);
  item.style.setProperty('--team', agent ? agentColor(agent) : 'var(--danger)');
  const head = el('div', 'approval-head');
  const timer = el('span', 'approval-timer', approvalTimer(approval.expiresAt));
  if (Number.isFinite(approval.expiresAt)) timer.dataset.expires = String(approval.expiresAt);
  head.append(el('span', 'swatch'), el('strong', null, agent ? agent.title || agent.name : 'Sessão do Claude'), timer);
  item.append(head, el('p', 'approval-label', approval.label));
  if (approval.kind === 'question') {
    renderQuestionForm(approval, item);
    return item;
  }
  if (approval.detail) item.append(el('pre', 'approval-detail', approval.detail));
  const actions = el('div', 'approval-actions');
  const choices = [
    ['allow', 'Aprovar', 'btn-allow'],
    ['deny', 'Negar', 'btn-deny'],
  ];
  // Hosted agents have no editor dialog to fall back to.
  if (!approval.isHosted) choices.push(['ask', 'Responder no Cursor', 'btn-editor']);
  const buttons = choices.map(([decision, label, className]) => {
    const button = el('button', className, label);
    button.type = 'button';
    button.addEventListener('click', () => answerApproval(approval, decision, buttons));
    return button;
  });
  actions.append(...buttons);
  item.append(actions);
  return item;
}

// ---------- Auto-approve: every permission prompt allowed for 10 min (questions and plans still ask) ----------

const autoApproveToggle = document.getElementById('auto-approve-toggle');
const autoApproveBar = document.getElementById('auto-approve');
let autoApproveUntil = null; // ms since the epoch; the backend keeps the same clock

function renderAutoApprove(now = Date.now()) {
  if (autoApproveUntil !== null && autoApproveUntil <= now) autoApproveUntil = null;
  const isOn = autoApproveUntil !== null;
  autoApproveBar.hidden = !isOn;
  autoApproveToggle.setAttribute('aria-pressed', String(isOn));
  if (!isOn) return;
  const seconds = Math.ceil((autoApproveUntil - now) / 1000);
  document.getElementById('auto-approve-left').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

async function setAutoApprove(isOn) {
  try {
    autoApproveUntil = (await window.__TAURI__.core.invoke('set_auto_approve', { isOn })) ?? null;
    showToast(isOn ? 'Aprovando tudo sozinho por 10 min' : 'Aprovação automática desligada');
  } catch (err) {
    showToast(`Não consegui mudar a aprovação automática: ${err}`, true);
  }
  renderAutoApprove();
}

autoApproveToggle.addEventListener('click', () => setAutoApprove(autoApproveUntil === null));
document.getElementById('auto-approve-stop').addEventListener('click', () => setAutoApprove(false));

// AskUserQuestion: one block per question, options as toggle buttons plus a free-text answer.
function renderQuestionForm(approval, item) {
  const questions = approval.questions ?? [];
  const chosen = new Map();
  const typed = new Map();
  const submit = el('button', 'btn-allow', 'Responder');
  const deny = el('button', 'btn-deny', 'Não responder');
  submit.type = 'button';
  deny.type = 'button';
  const isAnswered = (q) => chosen.get(q.question).size > 0 || typed.get(q.question).value.trim() !== '';
  const refresh = () => {
    submit.disabled = !questions.every(isAnswered);
  };
  for (const q of questions) {
    const block = el('div', 'question');
    block.append(el('p', 'question-text', q.header ? `${q.header} · ${q.question}` : q.question));
    const options = el('div', 'question-options');
    const picked = new Set();
    chosen.set(q.question, picked);
    for (const option of q.options ?? []) {
      const button = el('button', 'option');
      button.type = 'button';
      button.setAttribute('aria-pressed', 'false');
      button.append(el('strong', null, option.label));
      if (option.description) button.append(el('small', null, option.description));
      button.addEventListener('click', () => {
        const isOn = picked.has(option.label);
        if (!q.multiSelect) {
          picked.clear();
          for (const other of options.querySelectorAll('.option')) other.setAttribute('aria-pressed', 'false');
        }
        if (isOn) picked.delete(option.label);
        else picked.add(option.label);
        button.setAttribute('aria-pressed', String(!isOn));
        refresh();
      });
      options.append(button);
    }
    const other = el('input', 'field option-other');
    other.placeholder = 'Outra resposta…';
    other.addEventListener('input', refresh);
    typed.set(q.question, other);
    block.append(options, other);
    item.append(block);
  }
  submit.addEventListener('click', () => {
    const answers = {};
    for (const q of questions) answers[q.question] = typed.get(q.question).value.trim() || [...chosen.get(q.question)].join(', ');
    answerApproval(approval, 'allow', [submit, deny], answers);
  });
  deny.addEventListener('click', () => answerApproval(approval, 'deny', [submit, deny]));
  const actions = el('div', 'approval-actions');
  actions.append(submit, deny);
  item.append(actions);
  refresh();
}

async function answerApproval(approval, decision, buttons = [], answers = null) {
  for (const button of buttons) button.disabled = true;
  try {
    await window.__TAURI__.core.invoke('resolve_approval', { id: approval.id, decision, answers });
    progress.approvalAnswered(approval.id);
    campaign.complete('approve');
    // Handing it back to the editor: bring its tab up so the dialog is right there.
    if (decision === 'ask') openSession(approval.sessionId);
  } catch (err) {
    showToast(String(err), true);
    for (const button of buttons) button.disabled = false;
  }
}

function renderClock() {
  const { hours, minutes } = mapClock();
  clockEl.textContent = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

// Rescans every session from scratch, then reloads the view so the map is rebuilt too.
async function refreshAll() {
  refreshButton.disabled = true;
  try {
    await window.__TAURI__?.core.invoke('refresh_snapshot');
    await window.__TAURI__?.core.invoke('refresh_usage');
  } catch (err) {
    showToast(String(err), true);
  }
  location.reload();
}

linkOnHover(listEl, '.card-item', (node) => node.querySelector('.card')?.dataset.id ?? null);
linkOnHover(approvalsEl, '.approval', (node) => node.dataset.session);

refreshButton.addEventListener('click', refreshAll);
document.getElementById('deploy-open').addEventListener('click', () => deployDialog.open(null));
groupToggle.checked = isGrouped;
groupToggle.addEventListener('change', () => {
  isGrouped = groupToggle.checked;
  savePref(GROUP_PREF_KEY, isGrouped);
  renderPanel();
});
window.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    if (!deployDialog.isOpen()) deployDialog.open(null);
    return;
  }
  const isReloadKey = event.key === 'F5' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r');
  if (!isReloadKey) return;
  event.preventDefault();
  refreshAll();
});

function setSettingsOpen(isOpen) {
  settingsEl.hidden = !isOpen;
  settingsBackdrop.hidden = !isOpen;
  settingsOpenButton.setAttribute('aria-expanded', String(isOpen));
  if (isOpen) renderBaseList();
  if (isOpen) settingsEl.querySelector('input')?.focus();
  else settingsOpenButton.focus();
}

document.getElementById('onboarding-open').addEventListener('click', () => {
  setSettingsOpen(false);
  onboarding.open();
});
document.getElementById('shortcuts-open').addEventListener('click', () => {
  setSettingsOpen(false);
  help.open();
});

// Picking the repository reuses the "Novo agente" search; "Só fundar a base" there pins it.
document.getElementById('base-add').addEventListener('click', () => {
  setSettingsOpen(false);
  deployDialog.open(null);
});

settingsOpenButton.addEventListener('click', () => setSettingsOpen(settingsEl.hidden));
document.getElementById('settings-close').addEventListener('click', () => setSettingsOpen(false));
settingsBackdrop.addEventListener('click', () => setSettingsOpen(false));
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !settingsEl.hidden) setSettingsOpen(false);
});

// Native webview zoom (not CSS zoom): it scales layout and pointer coordinates alike, so clicks on
// the canvas keep landing where they look.
function readZoom() {
  try {
    const value = Number(localStorage.getItem(ZOOM_PREF_KEY));
    return ZOOM_STEPS.includes(value) ? value : 1;
  } catch {
    return 1;
  }
}

let zoom = readZoom();

async function applyZoom(next) {
  zoom = next;
  document.getElementById('zoom-value').textContent = `${Math.round(zoom * 100)}%`;
  document.getElementById('zoom-out').disabled = zoom === ZOOM_STEPS[0];
  document.getElementById('zoom-in').disabled = zoom === ZOOM_STEPS[ZOOM_STEPS.length - 1];
  document.getElementById('zoom-reset').disabled = zoom === 1;
  try {
    localStorage.setItem(ZOOM_PREF_KEY, String(zoom));
  } catch {
    // the zoom still applies for this run
  }
  const webview = window.__TAURI__?.webview?.getCurrentWebview?.();
  if (!webview) return; // plain browser: nothing to zoom natively
  try {
    await webview.setZoom(zoom);
  } catch (err) {
    showToast(`Não consegui aplicar o zoom: ${err}`, true);
  }
}

function stepZoom(direction) {
  const index = ZOOM_STEPS.indexOf(zoom);
  const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, index + direction))];
  if (next !== zoom) applyZoom(next);
}

document.getElementById('zoom-in').addEventListener('click', () => stepZoom(1));
document.getElementById('zoom-out').addEventListener('click', () => stepZoom(-1));
document.getElementById('zoom-reset').addEventListener('click', () => applyZoom(1));
window.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey)) return;
  if (event.key === '=' || event.key === '+') stepZoom(1);
  else if (event.key === '-') stepZoom(-1);
  else if (event.key === '0') applyZoom(1);
  else return;
  event.preventDefault();
});
applyZoom(zoom);

// Map zoom (the 2D view), separate from the UI zoom above.
const mapCanvas = document.getElementById('map');
const viewZoomValue = document.getElementById('view-zoom-value');

function showViewZoom(value) {
  viewZoomValue.textContent = `${Math.round(value * 100)}%`;
  document.getElementById('view-zoom-out').disabled = value <= 1;
  try {
    localStorage.setItem(VIEW_ZOOM_KEY, String(value));
  } catch {
    // the zoom still applies for this run
  }
}

// The minimap shows only while the map is zoomed in: at fit the whole map is already on screen.
const minimapEl = document.getElementById('minimap');
// Hidden for now: flip back to true to bring the minimap back as it was.
const SHOULD_SHOW_MINIMAP = false;

function showMinimap(viewZoom) {
  const isZoomed = SHOULD_SHOW_MINIMAP && viewZoom > 1;
  minimapEl.hidden = !isZoomed;
  empire.setMinimap(isZoomed ? minimapEl : null);
}

minimapEl.addEventListener('click', (event) => empire.centerOnMinimap(event));

// ---------- View (from above or isometric) and moving around the map ----------

const viewToggle = document.getElementById('view-toggle');
const viewRotate = document.getElementById('view-rotate');
const mapOnlyButton = document.getElementById('map-only');

function showMapView({ mode, rotation }) {
  campaign.observeView(mode);
  document.getElementById('view-label').textContent = VIEW_LABELS[mode];
  viewToggle.setAttribute('aria-label', `Vista do mapa: ${VIEW_LABELS[mode]}. Trocar`);
  viewRotate.hidden = mode === 'top';
  const radio = document.querySelector(`input[name="map-view"][value="${mode}"]`);
  if (radio) radio.checked = true;
  try {
    localStorage.setItem(MAP_VIEW_KEY, JSON.stringify({ mode, rotation, v: MAP_VIEW_VERSION }));
  } catch {
    // this run keeps the view
  }
}

// V: from above ⇄ 3D (from the pixel isometric, V goes to 3D).
function toggleMapView() {
  empire.setView(empire.viewMode === '3d' ? 'top' : '3d');
}

// "Só o mapa": the command column and the panel step aside so the map gets the whole window.
function setMapOnly(isMapOnly) {
  document.querySelector('.app').classList.toggle('is-map-only', isMapOnly);
  mapOnlyButton.setAttribute('aria-pressed', String(isMapOnly));
  savePref(MAP_ONLY_KEY, isMapOnly);
}

mapCanvas.addEventListener('viewchange', (event) => showMapView(event.detail));
mapCanvas.addEventListener('viewerror', (event) => showToast(`Não consegui abrir a vista 3D: ${event.detail}`, true));
document.querySelectorAll('input[name="map-view"]').forEach((radio) => radio.addEventListener('change', () => empire.setView(radio.value)));
viewToggle.addEventListener('click', toggleMapView);
viewRotate.addEventListener('click', () => empire.rotateView(1));
mapOnlyButton.addEventListener('click', () => setMapOnly(mapOnlyButton.getAttribute('aria-pressed') !== 'true'));
showMapView({ mode: empire.viewMode, rotation: empire.viewRotation });
setMapOnly(readPref(MAP_ONLY_KEY, false));

// The panel: collapsed to a rail (Ctrl+B or the » button) and on the right (default) or the left.
// The arrows point where the panel goes: toward the window's edge to collapse, back out to reopen.
const panelCollapseButton = document.getElementById('panel-collapse');
const panelRail = document.getElementById('panel-rail');

function setPanelCollapsed(isCollapsed, { shouldFocus = false } = {}) {
  document.querySelector('.app').classList.toggle('is-panel-collapsed', isCollapsed);
  savePref(PANEL_COLLAPSED_KEY, isCollapsed);
  if (shouldFocus) (isCollapsed ? panelRail : panelCollapseButton).focus();
}

function setPanelLeft(isLeft) {
  document.querySelector('.app').classList.toggle('is-panel-left', isLeft);
  panelCollapseButton.textContent = isLeft ? '«' : '»';
  document.getElementById('panel-rail-arrow').textContent = isLeft ? '»' : '«';
  document.querySelector(`input[name="panel-side"][value="${isLeft ? 'left' : 'right'}"]`).checked = true;
  savePref(PANEL_LEFT_KEY, isLeft);
}

panelCollapseButton.addEventListener('click', () => setPanelCollapsed(true, { shouldFocus: true }));
panelRail.addEventListener('click', () => setPanelCollapsed(false, { shouldFocus: true }));
document.querySelectorAll('input[name="panel-side"]').forEach((radio) => radio.addEventListener('change', () => setPanelLeft(radio.value === 'left')));
document.querySelector(`input[name="map-border"][value="${empire.hasBorderWall ? 'wall' : 'forest'}"]`).checked = true;
document.querySelectorAll('input[name="map-border"]').forEach((radio) => radio.addEventListener('change', () => empire.setBorderWall(radio.value === 'wall')));
window.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== 'b') return;
  event.preventDefault();
  const isCollapsed = !document.querySelector('.app').classList.contains('is-panel-collapsed');
  // Keep focus inside the panel only when it was there; from the map or a field, stay put.
  setPanelCollapsed(isCollapsed, { shouldFocus: Boolean(document.activeElement?.closest('.panel')) });
});
setPanelLeft(readPref(PANEL_LEFT_KEY, false));
setPanelCollapsed(readPref(PANEL_COLLAPSED_KEY, false));

// As in the game: arrows / WASD pan, Space + drag pans, Q / E turn the isometric camera, V switches
// the view. Only with the map in focus: never while typing, in a dialog or in the panel.
function isMapKey(event) {
  const active = document.activeElement;
  const isMapFocus = !active || active === document.body || Boolean(active.closest('.stage-wrap'));
  const isDialogOpen = Boolean(document.querySelector('.modal:not([hidden]), .settings:not([hidden]), .action-menu:not([hidden])'));
  const isTyping = ['INPUT', 'TEXTAREA', 'SELECT'].includes(active?.tagName);
  return isMapFocus && !isDialogOpen && !isTyping && !event.ctrlKey && !event.metaKey && !event.altKey;
}

window.addEventListener('keydown', (event) => {
  if (!isMapKey(event)) return;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (empire.setPanKey(event.key, true)) {
    event.preventDefault();
    if ((empire.viewZoom ?? 1) === 1) empire.setViewZoom(2); // at fit nothing moves: get closer first
  } else if (key === ' ' && document.activeElement?.tagName !== 'BUTTON') {
    event.preventDefault();
    empire.isPanKeyDown = true;
    mapCanvas.style.cursor = 'grab';
  } else if (key === 'q' || key === 'e') {
    event.preventDefault();
    empire.rotateView(key === 'e' ? 1 : -1);
  } else if (key === 'v') {
    event.preventDefault();
    toggleMapView();
  } else if (key === 'f') {
    event.preventDefault();
    setMapOnly(mapOnlyButton.getAttribute('aria-pressed') !== 'true');
  } else if (key === 'm') {
    event.preventDefault();
    skipMusicTrack();
  }
});
// Ctrl+A picks every villager; Esc first drops a base being built; B opens the build menu.
window.addEventListener('keydown', (event) => {
  const isTyping = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  if (event.key === 'Escape' && empire.placing) {
    event.preventDefault();
    event.stopImmediatePropagation();
    empire.cancelPlacing();
    return;
  }
  if (isTyping || document.querySelector('.modal:not([hidden]), .settings:not([hidden])')) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
    event.preventDefault();
    empire.selectAll();
  } else if (event.key.toLowerCase() === 'b' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    if (buildMenu.isOpen()) buildMenu.close();
    else buildMenu.open();
  }
}, true);
window.addEventListener('keyup', (event) => {
  empire.setPanKey(event.key, false);
  if (event.key !== ' ') return;
  empire.isPanKeyDown = false;
  mapCanvas.style.cursor = 'default';
});
window.addEventListener('blur', () => {
  empire.panKeys.clear(); // a key let go in another window never sends its keyup here
  empire.isPanKeyDown = false;
});
mapCanvas.addEventListener('viewzoom', (event) => {
  showViewZoom(event.detail);
  showMinimap(event.detail);
});
document.getElementById('view-zoom-in').addEventListener('click', () => empire.setViewZoom((empire.viewZoom ?? 1) * VIEW_ZOOM_BUTTON_STEP));
document.getElementById('view-zoom-out').addEventListener('click', () => empire.setViewZoom((empire.viewZoom ?? 1) / VIEW_ZOOM_BUTTON_STEP));
document.getElementById('view-zoom-fit').addEventListener('click', () => empire.setViewZoom(1));
try {
  const saved = Number(localStorage.getItem(VIEW_ZOOM_KEY));
  empire.setViewZoom(Number.isFinite(saved) && saved >= 1 ? saved : 1);
} catch {
  showViewZoom(1);
}

limitsToggle.checked = isLimitsOn;
limitsToggle.addEventListener('change', () => {
  isLimitsOn = limitsToggle.checked;
  savePref(LIMITS_PREF_KEY, isLimitsOn);
  renderLimits();
  // Off also stops the fetch: it is the app's only network call.
  window.__TAURI__?.core
    .invoke('set_usage_on', { isOn: isLimitsOn })
    .then(() => isLimitsOn && window.__TAURI__.core.invoke('refresh_usage'))
    .catch((err) => showToast(String(err), true));
});

soundToggle.checked = isSoundOn;
soundToggle.addEventListener('change', () => {
  isSoundOn = soundToggle.checked;
  savePref(SOUND_PREF_KEY, isSoundOn);
  if (isSoundOn) sfx.playFinished(); // preview, and the click unlocks audio
});
musicToggle.checked = isMusicOn;
musicToggle.addEventListener('change', () => setMusicOn(musicToggle.checked));
// The note in the map's corner: same switch as Configurações › Som, one click away.
musicQuickButton.addEventListener('click', () => setMusicOn(!isMusicOn));

function setMusicOn(isOn) {
  isMusicOn = isOn;
  musicToggle.checked = isOn;
  savePref(MUSIC_PREF_KEY, isOn);
  applyMusicOn();
  sfx.setMusic(isOn);
}

function applyMusicOn() {
  musicVolumeInput.disabled = !isMusicOn;
  musicStationSelect.disabled = !isMusicOn;
  musicNextButton.disabled = !isMusicOn;
  musicQuickButton.setAttribute('aria-pressed', String(isMusicOn));
  musicQuickButton.title = isMusicOn ? 'Trilha sonora ligada: clique para desligar' : 'Trilha sonora desligada: clique para ligar';
  if (!isMusicOn) showMusicTrack(null);
}

/** The song playing, or "…" while the next one renders (about a second). */
function showMusicTrack(title) {
  musicNowEl.textContent = title ? `♪ ${title}` : '…';
}

function skipMusicTrack() {
  if (!isMusicOn) return;
  showMusicTrack(null);
  sfx.skipMusicTrack();
}

function readMusicStation() {
  try {
    const stored = localStorage.getItem(MUSIC_STATION_KEY);
    return MUSIC_STATIONS.includes(stored) ? stored : MUSIC_STATIONS[0];
  } catch {
    return MUSIC_STATIONS[0];
  }
}

musicStationSelect.value = readMusicStation();
musicStationSelect.addEventListener('change', () => {
  showMusicTrack(null);
  sfx.setMusicStation(musicStationSelect.value);
  try {
    localStorage.setItem(MUSIC_STATION_KEY, musicStationSelect.value);
  } catch {
    // the station still plays for this run
  }
});
musicNextButton.addEventListener('click', skipMusicTrack);

// Percent of the mix as written (the slider goes to 150).
function readMusicVolume() {
  try {
    const stored = localStorage.getItem(MUSIC_VOLUME_KEY);
    const value = Number(stored);
    return stored !== null && value >= 0 && value <= Number(musicVolumeInput.max) ? value : DEFAULT_MUSIC_VOLUME;
  } catch {
    return DEFAULT_MUSIC_VOLUME;
  }
}

function applyMusicVolume() {
  document.getElementById('music-volume-value').textContent = `${musicVolumeInput.value}%`;
  sfx.setMusicVolume(Number(musicVolumeInput.value) / 100);
}

musicVolumeInput.value = String(readMusicVolume());
applyMusicOn();
musicVolumeInput.addEventListener('input', () => {
  applyMusicVolume();
  try {
    localStorage.setItem(MUSIC_VOLUME_KEY, musicVolumeInput.value);
  } catch {
    // the volume still applies for this run
  }
});
applyMusicVolume(); // before the music starts, so the first notes already play at this level
sfx.setMusicStation(musicStationSelect.value);
sfx.setMusic(isMusicOn);
sfx.unlockOnFirstGesture();
document.getElementById('play-finished').addEventListener('click', () => sfx.playFinished());
document.getElementById('play-needs-you').addEventListener('click', () => sfx.playNeedsYou());

renderClock();
setInterval(() => {
  const now = Date.now();
  for (const span of listEl.querySelectorAll('[data-since]')) span.textContent = formatElapsed(Number(span.dataset.since), now);
  for (const span of approvalsEl.querySelectorAll('[data-expires]')) span.textContent = approvalTimer(Number(span.dataset.expires), now);
  for (const span of limitsEl.querySelectorAll('[data-resets]')) span.textContent = formatReset(Number(span.dataset.resets), now);
  renderAutoApprove(now);
  renderClock();
}, 1000);

// ---------- First run: "Fundar o império", then the campaign of objectives ----------

const onboarding = createOnboarding({
  invoke: (command, args) => window.__TAURI__.core.invoke(command, args),
  isPinned: (project) => empire.isPinned(project),
  isSoundOn: () => isSoundOn,
  showToast: (message, isError) => showToast(message, isError),
  onFinish: finishOnboarding,
});
const help = createHelp();

function finishOnboarding({ bases, isSkipped, isLimitsOn: isLimitsChosen, isSoundOn: isSoundChosen }) {
  for (const project of bases) empire.pinBase(project.name, null, project.path);
  isSoundOn = isSoundChosen;
  soundToggle.checked = isSoundOn;
  savePref(SOUND_PREF_KEY, isSoundOn);
  isLimitsOn = isLimitsChosen;
  limitsToggle.checked = isLimitsOn;
  savePref(LIMITS_PREF_KEY, isLimitsOn);
  renderLimits();
  if (isLimitsOn) window.__TAURI__.core.invoke('refresh_usage').catch(() => {});
  // The projects folder may have changed: the search, the paths and the fog follow it.
  window.__TAURI__.core
    .invoke('list_projects')
    .then((projects) => empire.setRepoPaths(projects))
    .catch(() => {});
  refreshEmpire();
  if (isSkipped) return;
  campaign.start();
  showToast(bases.length ? `Império fundado com ${bases.length} ${bases.length === 1 ? 'base' : 'bases'}` : 'Império fundado');
}

async function start() {
  const tauri = window.__TAURI__;
  if (!tauri) {
    statusEl.textContent = 'Abra pelo app: fora do Tauri não há acesso às sessões.';
    return;
  }
  // Listen before fetching so no change slips between the two.
  await tauri.event.listen('snapshot', (event) => applySnapshot(event.payload));
  await tauri.event.listen('approvals', (event) => applyApprovals(event.payload));
  await tauri.event.listen('usage', (event) => applyUsage(event.payload));
  await tauri.event.listen('limit_reset', (event) => celebrateLimitReset(event.payload));
  await tauri.event.listen('music_track', (event) => {
    if (isMusicOn) showMusicTrack(event.payload);
  });
  // A reload (F5) finds the music already playing: its song started before this page.
  tauri.core.invoke('get_music_track').then((title) => {
    if (isMusicOn) showMusicTrack(title);
  }).catch(() => {});
  await tauri.event.listen('scout', (event) => scoutPanel.apply(event.payload));
  await tauri.event.listen('hosted', (event) => {
    hostedIds = new Set(event.payload ?? []);
    refreshView();
  });
  hostedIds = new Set(await tauri.core.invoke('get_hosted'));
  refreshEmpire();
  setInterval(refreshEmpire, EMPIRE_REFRESH_MS);
  // Repository folders tell the map where an edited file lives (agents working outside their folder).
  tauri.core
    .invoke('list_projects')
    .then((projects) => {
      empire.setRepoPaths(projects);
      if (hasSnapshot) refreshView();
    })
    .catch(() => {});
  applySnapshot(await tauri.core.invoke('get_snapshot'));
  applyApprovals(await tauri.core.invoke('get_approvals'));
  autoApproveUntil = (await tauri.core.invoke('get_auto_approve')) ?? null;
  renderAutoApprove();
  applyUsage(await tauri.core.invoke('get_usage'));
  scoutPanel.apply(await tauri.core.invoke('get_scout'));
  scoutPanel.syncVillage();
  const config = await tauri.core.invoke('get_config');
  if (!config.onboardedAt) onboarding.open({ isFirst: true });
}

start().catch((err) => {
  statusEl.textContent = `Erro ao ler as sessões: ${err}`;
});
