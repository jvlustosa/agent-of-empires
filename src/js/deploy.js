// "Novo agente" dialog: pick a repo, write the task, and choose where it runs (here in the app, Cursor, terminal).
import { formatElapsed } from './kinds.js';

const MAX_RESULTS = 50;
const DAY_MS = 24 * 60 * 60 * 1000;
// Under the staked land (or the town center) until the new agent shows up, per mode.
const ARRIVAL_HINTS = { office: 'Começando aqui no app', cursor: 'Confirme o pedido no Cursor', terminal: 'Abrindo no terminal' };

// Accent-insensitive, so "repositorios" finds "Repositórios".
function normalize(text) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Every word must appear, in any order: "shop ui" finds my-shop-ui.
function matchesQuery(project, words) {
  const haystack = normalize(`${project.name} ${project.parent}`);
  return words.every((word) => haystack.includes(word));
}

function isInside(cwd, root) {
  return typeof cwd === 'string' && (cwd === root || cwd.startsWith(`${root}/`));
}

function age(since, now = Date.now()) {
  return now - since >= DAY_MS ? `${Math.floor((now - since) / DAY_MS)}d` : formatElapsed(since, now);
}

// Names whichever signal put the repo where it is in the list.
function recencyText({ lastClaudeAt, lastGitAt }) {
  if ((lastClaudeAt ?? 0) >= (lastGitAt ?? 0)) return lastClaudeAt ? `Claude há ${age(lastClaudeAt)}` : null;
  return `git há ${age(lastGitAt)}`;
}

function homeRelative(path) {
  return path.replace(/^\/(?:home|Users)\/[^/]+/, '~');
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createDeployDialog({ invoke, showToast, getAgents, getColor, onDeployed, onPinned, openMenu }) {
  const dialog = document.getElementById('deploy');
  const backdrop = document.getElementById('deploy-backdrop');
  const search = document.getElementById('deploy-search');
  const list = document.getElementById('deploy-projects');
  const task = document.getElementById('deploy-task');
  const submit = document.getElementById('deploy-submit');
  const pinButton = document.getElementById('deploy-pin');
  const chosen = document.getElementById('deploy-chosen');
  const modeHint = document.getElementById('deploy-mode-hint');

  let projects = null; // null while list_projects runs
  let matches = [];
  let activeIndex = 0;
  let selected = null;
  let spot = null; // where the new base stands, when the user picked land on the map
  let onStarted = null; // this opening's own follow-up once the agent starts (a recruit walking there)
  let returnFocus = null;

  function currentMode() {
    return dialog.querySelector('input[name="deploy-mode"]:checked')?.value ?? 'office';
  }

  // Sessions whose folder is the repo or inside it (a session started in src-tauri counts too).
  function agentBadge(project) {
    const live = getAgents().filter((agent) => isInside(agent.cwd, project.path));
    if (live.length === 0) return null;
    const working = live.filter((agent) => agent.status === 'busy').length;
    const badge = el('span', 'project-agents', `${live.length} agente${live.length > 1 ? 's' : ''}`);
    badge.classList.toggle('is-working', working > 0);
    badge.title = [working && `${working} trabalhando`, live.length - working && `${live.length - working} sua vez`].filter(Boolean).join(' · ');
    return badge;
  }

  function openProjectMenu(project, event, button) {
    event.preventDefault();
    const anchor = event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : button; // Menu key: no point
    const items = [
      { label: 'Escolher este projeto', hint: 'Depois escreva a tarefa e escolha onde ele trabalha', onSelect: () => choose(project) },
      {
        label: 'Abrir o claude num terminal aqui',
        hint: task.value.trim() ? 'Terminal novo na pasta, já com a tarefa escrita acima' : 'Terminal novo na pasta do projeto, com o claude rodando',
        onSelect: () => deploy(project, 'terminal'),
      },
    ];
    openMenu(anchor, `${project.name} · ${project.parent}`, items, button);
  }

  function renderList() {
    if (projects === null) {
      matches = [];
      list.replaceChildren(el('li', 'project-empty', 'Lendo os repositórios em ~/Code…'));
      return;
    }
    const words = normalize(search.value).split(/\s+/).filter(Boolean);
    matches = projects.filter((project) => matchesQuery(project, words)).slice(0, MAX_RESULTS);
    activeIndex = Math.min(activeIndex, Math.max(0, matches.length - 1));
    list.replaceChildren(
      ...matches.map((project, index) => {
        const item = el('li');
        const button = el('button', 'project-option');
        button.type = 'button';
        button.setAttribute('role', 'option');
        button.setAttribute('aria-selected', String(project === selected));
        button.classList.toggle('is-active', index === activeIndex);
        const top = el('span', 'project-top');
        const swatch = el('span', 'swatch');
        swatch.style.setProperty('--team', getColor(project.name)); // same flag color as its base on the map
        top.append(swatch, el('strong', null, project.name));
        const badge = agentBadge(project);
        if (badge) top.append(badge);
        button.append(top, el('small', null, [project.parent, recencyText(project)].filter(Boolean).join(' · ')));
        button.addEventListener('click', () => choose(project));
        button.addEventListener('contextmenu', (event) => openProjectMenu(project, event, button));
        item.append(button);
        return item;
      }),
    );
    if (matches.length === 0) list.append(el('li', 'project-empty', 'Nenhum repositório com esse nome em ~/Code'));
    list.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  }

  // New snapshots only swap the badges, so focus, scroll and the highlighted row stay put.
  function refreshBadges() {
    if (dialog.hidden) return;
    list.querySelectorAll('.project-option').forEach((button, index) => {
      const top = button.querySelector('.project-top');
      top.querySelector('.project-agents')?.remove();
      const badge = agentBadge(matches[index]);
      if (badge) top.append(badge);
    });
  }

  // A terminal can start on an empty prompt; the app and Cursor need a task.
  function refreshSubmit() {
    const isMissingTask = task.value.trim() === '' && currentMode() !== 'terminal';
    submit.disabled = !selected || isMissingTask;
    submit.title = !selected ? 'Escolha um projeto' : isMissingTask ? 'Escreva a tarefa (no terminal dá para abrir sem)' : '';
    pinButton.disabled = !selected;
    modeHint.textContent = dialog.querySelector('input[name="deploy-mode"]:checked')?.dataset.hint ?? '';
  }

  function choose(project) {
    selected = project;
    chosen.replaceChildren(el('strong', null, project.name), ` · ${homeRelative(project.path)}`);
    chosen.title = project.path;
    renderList();
    refreshSubmit();
    task.focus();
  }

  async function open(landSpot = null, presetTask = '', presetProject = null, presetMode = null, afterStart = null) {
    spot = landSpot;
    onStarted = afterStart;
    const modeInput = presetMode && dialog.querySelector(`input[name="deploy-mode"][value="${presetMode}"]`);
    if (modeInput) modeInput.checked = true;
    selected = null;
    activeIndex = 0;
    search.value = '';
    task.value = presetTask;
    chosen.textContent = 'Escolha um projeto na lista';
    chosen.title = '';
    returnFocus = document.activeElement;
    dialog.hidden = false;
    backdrop.hidden = false;
    search.focus();
    refreshSubmit();
    projects = null;
    renderList();
    try {
      projects = await invoke('list_projects');
    } catch (err) {
      projects = [];
      showToast(`Não consegui listar os projetos: ${err}`, true);
    }
    // The list comes most recent first: start on it (or on the project the user came from), so
    // the usual case is just "write and go".
    const start = (presetProject && projects.find((p) => p.name === presetProject)) || projects[0];
    if (start) choose(start);
    else renderList();
  }

  function close() {
    dialog.hidden = true;
    backdrop.hidden = true;
    returnFocus?.focus?.();
  }

  async function deploy(project = selected, mode = currentMode()) {
    if (!project) return;
    submit.disabled = true;
    try {
      showToast(await invoke('deploy_agent', { path: project.path, task: task.value, mode }));
      onDeployed({ spot, project, hint: ARRIVAL_HINTS[mode] });
      onStarted?.(project);
      close();
    } catch (err) {
      showToast(String(err), true);
      refreshSubmit();
    }
  }

  search.addEventListener('input', () => {
    activeIndex = 0;
    renderList();
  });
  search.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      activeIndex = (activeIndex + step + matches.length) % Math.max(1, matches.length);
      renderList();
    } else if (event.key === 'Enter' && matches[activeIndex]) {
      event.preventDefault();
      choose(matches[activeIndex]);
    }
  });
  task.addEventListener('input', refreshSubmit);
  task.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      if (!submit.disabled) deploy();
    }
  });
  dialog.querySelector('.deploy-modes').addEventListener('change', refreshSubmit);
  submit.addEventListener('click', () => deploy());
  // Only the base: the repository goes on the map (pinned) without starting an agent.
  pinButton.addEventListener('click', () => {
    if (!selected) return;
    onPinned({ spot, project: selected });
    close();
  });
  document.getElementById('deploy-cancel').addEventListener('click', close);
  document.getElementById('deploy-close').addEventListener('click', close);
  backdrop.addEventListener('click', close);
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  });

  // Straight from a town center's card (or a recruit's order): same call, and the same "new villager"
  // bar on that base. Says whether the agent started.
  async function deployNow(project, text, mode) {
    try {
      showToast(await invoke('deploy_agent', { path: project.path, task: text, mode }));
      onDeployed({ spot: null, project, hint: ARRIVAL_HINTS[mode] });
      return true;
    } catch (err) {
      showToast(String(err), true);
      return false;
    }
  }

  return { open, isOpen: () => !dialog.hidden, refresh: refreshBadges, deployNow };
}
