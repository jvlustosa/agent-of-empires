// "O Batedor": the village's hero. It reads the sources it is equipped with (Slack, Gmail, Notion,
// through the user's Claude connectors) and brings back missions for the bases. The panel shows the
// missions, its equipment (connectors, skills, routines) and its journal; it levels up as it works.
// Everything it read is untrusted text: it is only ever set with textContent, and a mission starts
// nothing until the user trains a villager with it.
import { formatElapsed } from './kinds.js';
import { drawKnight, drawSlackShield, makeLook } from './sprites.js';

// Same as scout::LEVEL_XP in the backend, which also opens the skill slots.
const LEVEL_XP = [0, 60, 180, 400, 750, 1250, 2000];
const LEVEL_TITLES = ['Escudeiro', 'Batedor', 'Cavaleiro', 'Cavaleiro veterano', 'Paladino', 'Campeão', 'Lenda da aldeia'];
const CONNECTORS = [
  { id: 'slack', name: 'Slack', label: 'Canais', placeholder: '#ac-tickets, #dev-bug-report', hint: 'Nomes ou IDs dos canais. Ele lê só o que chegou desde a última ronda.' },
  { id: 'gmail', name: 'Gmail', label: 'Busca', placeholder: 'label:clientes is:unread', hint: 'Uma busca do Gmail: ele lê as conversas novas que caem nela.' },
  { id: 'notion', name: 'Notion', label: 'Páginas', placeholder: 'Roadmap, Bugs do produto', hint: 'Páginas ou bancos de dados do Notion para acompanhar.' },
];
const SEVERITY_LABELS = { critical: 'Crítica', high: 'Alta', normal: 'Normal', low: 'Baixa' };
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
const NEW_ROUTINE = { id: '', label: 'Ronda do expediente', isOn: true, everyMinutes: 60, fromHour: 9, toHour: 18, isWeekdaysOnly: true, focus: '', lastRunAt: null };
const KNIGHT_HORSE = ['#d8d0c0', '#b0a690', '#6b6255'];

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

function levelTitle(level) {
  return LEVEL_TITLES[Math.min(level, LEVEL_TITLES.length) - 1];
}

function ago(at) {
  return `há ${formatElapsed(at)}`;
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

export function createScout({ invoke, showToast, getBases, displayName, onTrain, onState }) {
  const dialog = document.getElementById('scout');
  const backdrop = document.getElementById('scout-backdrop');
  const sendButton = document.getElementById('scout-send');
  const statusEl = document.getElementById('scout-status');
  const rankEl = document.getElementById('scout-rank');
  const xpEl = document.getElementById('scout-xp');
  const missionsEl = document.getElementById('scout-missions');
  const filterEl = document.getElementById('scout-filter');
  const connectorsEl = document.getElementById('scout-connectors');
  const skillsEl = document.getElementById('scout-skills');
  const slotsEl = document.getElementById('scout-skill-slots');
  const routinesEl = document.getElementById('scout-routines');
  const journalEl = document.getElementById('scout-journal');
  const badge = document.getElementById('scout-badge');
  const tabs = [...dialog.querySelectorAll('[role="tab"]')];

  let state = null;
  let skills = null; // the user's Claude Code skills, read when the equipment tab first opens
  let draft = null; // equipment being edited, saved with "Salvar equipamento"
  let filterProject = null;
  let returnFocus = null;
  let lastVillage = '';

  drawIcon();

  function drawIcon() {
    const canvas = document.getElementById('scout-icon');
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    drawSlackShield(ctx, 1, 1);
  }

  function drawPortrait() {
    const canvas = document.getElementById('scout-portrait');
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const look = { ...makeLook('knight:batedor', 'knight:batedor', 'knight'), horse: KNIGHT_HORSE };
    drawKnight(ctx, look, 14, 31, 'e', false, 0, performance.now() / 1000, state?.level ?? 1);
  }

  // ---------- State from the backend ----------

  function apply(next) {
    const wasScouting = state?.isScouting;
    const previousRound = state?.lastRound?.at;
    state = next;
    onState({ level: state.level, isScouting: state.isScouting, missions: missionsByBase(state) });
    renderBadge();
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
    showToast(text, false, { label: 'Ver', onClick: () => open() });
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
    sendButton.title = hasConnector ? 'Uma ronda agora pelas fontes equipadas' : 'Equipe um conector primeiro';
    renderMissions();
    renderJournal();
    if (!draft) renderEquipment();
  }

  function statusText() {
    if (state.isScouting) {
      const names = state.equipment.connectors.filter((c) => c.isOn).map((c) => CONNECTORS.find((known) => known.id === c.id)?.name ?? c.id);
      return `Em campo, lendo ${names.join(', ')}…`;
    }
    const round = state.lastRound;
    if (!round) {
      return state.equipment.connectors.some((c) => c.isOn) ? 'Pronto para a primeira ronda.' : 'Ainda sem equipamento: escolha de onde ele lê, em Equipamento.';
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

  // ---------- Equipment ----------

  function cloneEquipment() {
    const equipment = structuredClone(state.equipment);
    for (const spec of CONNECTORS) {
      if (!equipment.connectors.some((connector) => connector.id === spec.id)) equipment.connectors.push({ id: spec.id, isOn: false, targets: '' });
    }
    equipment.connectors.sort((a, b) => CONNECTORS.findIndex((c) => c.id === a.id) - CONNECTORS.findIndex((c) => c.id === b.id));
    return equipment;
  }

  function renderEquipment() {
    const equipment = draft ?? cloneEquipment();
    renderConnectors(equipment);
    renderSkills(equipment);
    renderRoutines(equipment);
  }

  function edit() {
    draft ??= cloneEquipment();
    return draft;
  }

  function renderConnectors(equipment) {
    connectorsEl.replaceChildren(
      ...equipment.connectors.map((connector) => {
        const spec = CONNECTORS.find((known) => known.id === connector.id);
        const row = el('div', 'scout-connector');
        row.classList.toggle('is-on', connector.isOn);
        const toggle = el('label', 'toggle');
        const input = el('input');
        input.type = 'checkbox';
        input.setAttribute('role', 'switch');
        input.checked = connector.isOn;
        input.addEventListener('change', () => {
          edit().connectors.find((c) => c.id === connector.id).isOn = input.checked;
          row.classList.toggle('is-on', input.checked);
        });
        toggle.append(input, el('strong', null, spec.name));
        const field = el('input', 'field');
        field.type = 'text';
        field.spellcheck = false;
        field.value = connector.targets;
        field.placeholder = spec.placeholder;
        field.setAttribute('aria-label', `${spec.name}: ${spec.label}`);
        field.addEventListener('input', () => {
          edit().connectors.find((c) => c.id === connector.id).targets = field.value;
        });
        row.append(toggle, field, el('small', null, spec.hint));
        return row;
      }),
    );
  }

  function renderSkills(equipment) {
    const slots = state.skillSlots;
    slotsEl.textContent = `${equipment.skills.length} de ${slots} ${slots === 1 ? 'espaço' : 'espaços'}`;
    if (skills === null) {
      skillsEl.replaceChildren(el('li', 'scout-empty', 'Lendo suas skills…'));
      return;
    }
    if (skills.length === 0) {
      skillsEl.replaceChildren(el('li', 'scout-empty', 'Nenhuma skill em ~/.claude/skills.'));
      return;
    }
    const isFull = equipment.skills.length >= slots;
    skillsEl.replaceChildren(
      ...skills.map((skill) => {
        const item = el('li', 'scout-skill');
        const label = el('label');
        const input = el('input');
        input.type = 'checkbox';
        input.checked = equipment.skills.includes(skill.name);
        input.disabled = !input.checked && isFull;
        input.addEventListener('change', () => {
          const chosen = edit().skills;
          if (input.checked) chosen.push(skill.name);
          else chosen.splice(chosen.indexOf(skill.name), 1);
          renderSkills(draft);
        });
        const text = el('span');
        text.append(el('strong', null, skill.name), el('small', null, skill.description));
        label.append(input, text);
        if (input.disabled) label.title = 'Todos os espaços ocupados: mais espaços abrem nos níveis 3 e 5';
        item.append(label);
        return item;
      }),
    );
  }

  function renderRoutines(equipment) {
    const rows = equipment.routines.map((routine, index) => {
      const row = el('li', 'scout-routine');
      const change = (key, value) => {
        edit().routines[index][key] = value;
      };
      const isOn = el('input');
      isOn.type = 'checkbox';
      isOn.setAttribute('role', 'switch');
      isOn.checked = routine.isOn;
      isOn.setAttribute('aria-label', 'Rotina ligada');
      isOn.addEventListener('change', () => change('isOn', isOn.checked));
      const name = el('input', 'field');
      name.type = 'text';
      name.value = routine.label;
      name.maxLength = 40;
      name.setAttribute('aria-label', 'Nome da rotina');
      name.addEventListener('input', () => change('label', name.value));
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
      weekdays.append(weekdaysInput, el('span', null, 'só seg a sex'));
      const focus = el('input', 'field');
      focus.type = 'text';
      focus.value = routine.focus;
      focus.placeholder = 'Foco (opcional): só bugs críticos, só o #ac-tickets…';
      focus.setAttribute('aria-label', 'Foco da rotina');
      focus.addEventListener('input', () => change('focus', focus.value));
      const remove = button('icon-button', '✕', () => {
        edit().routines.splice(index, 1);
        renderRoutines(draft);
      });
      remove.setAttribute('aria-label', `Remover a rotina ${routine.label}`);
      const when = el('div', 'scout-routine-when');
      when.append(every, el('span', null, 'das'), hours(routine.fromHour, 'fromHour', 'Começa às'), el('span', null, 'às'), hours(routine.toHour, 'toHour', 'Termina às'), weekdays);
      const top = el('div', 'scout-routine-top');
      top.append(isOn, name, remove);
      row.append(top, when, focus);
      if (routine.lastRunAt) row.append(el('small', null, `Última vez ${ago(routine.lastRunAt)}`));
      return row;
    });
    if (rows.length === 0) rows.push(el('li', 'scout-empty', 'Sem rotinas: ele só sai quando você manda.'));
    routinesEl.replaceChildren(...rows);
    document.getElementById('scout-routine-add').disabled = equipment.routines.length >= 5;
  }

  async function saveEquipment() {
    if (!draft) {
      showToast('Nada mudou no equipamento');
      return;
    }
    try {
      const saved = await invoke('set_scout_equipment', { equipment: draft });
      draft = null;
      apply(saved);
      renderEquipment();
      showToast('Batedor equipado');
    } catch (err) {
      showToast(String(err), true);
    }
  }

  async function loadSkills() {
    if (skills !== null) return;
    try {
      skills = await invoke('list_scout_skills');
    } catch {
      skills = [];
    }
    renderSkills(draft ?? cloneEquipment());
  }

  // ---------- Opening, tabs, riding out ----------

  function selectTab(id) {
    for (const tab of tabs) {
      const isSelected = tab.id === id;
      tab.setAttribute('aria-selected', String(isSelected));
      tab.tabIndex = isSelected ? 0 : -1;
      document.getElementById(tab.getAttribute('aria-controls')).hidden = !isSelected;
    }
    if (id === 'scout-tab-equipment') loadSkills();
  }

  function open({ project = null, tab = 'scout-tab-missions' } = {}) {
    if (!state) return;
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
  document.getElementById('scout-equip-save').addEventListener('click', saveEquipment);
  document.getElementById('scout-routine-add').addEventListener('click', () => {
    edit().routines.push({ ...NEW_ROUTINE });
    renderRoutines(draft);
  });
  filterEl.querySelector('button').addEventListener('click', () => {
    filterProject = null;
    renderMissions();
  });
  for (const tab of tabs) tab.addEventListener('click', () => selectTab(tab.id));
  dialog.querySelector('[role="tablist"]').addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const index = tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true');
    const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    selectTab(next.id);
    next.focus();
  });
  document.getElementById('scout-open').addEventListener('click', () => open());
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
