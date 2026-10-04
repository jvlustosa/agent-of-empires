// "Novo agente" dialog: pick a repo, write the task, and choose where it runs (here in the app, Cursor, terminal).
// The repos show as a gallery of their town centers, and the chosen one as a preview (README, stack, git).
import { formatElapsed } from './kinds.js';
import { drawGrass, drawTownCenter } from './sprites.js';

const MAX_RESULTS = 50;
// Canvas size in map pixels: the 40 x 36 town center plus its spires, on a strip of grass.
const CARD_THUMB = { w: 128, h: 58 };
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

function changesText(count) {
  if (count === 0) return 'tudo commitado';
  return `${count} ${count === 1 ? 'arquivo alterado' : 'arquivos alterados'}`;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// getTeam and getDesign: the repo's flag colors and town center as the map draws them.
export function createDeployDialog({ invoke, showToast, getAgents, getTeam, getDesign, onDeployed, onPinned, openMenu }) {
  const dialog = document.getElementById('deploy');
  const backdrop = document.getElementById('deploy-backdrop');
  const search = document.getElementById('deploy-search');
  const list = document.getElementById('deploy-projects');
  const task = document.getElementById('deploy-task');
  const submit = document.getElementById('deploy-submit');
  const pinButton = document.getElementById('deploy-pin');
  const preview = document.getElementById('deploy-preview');
  const modeHint = document.getElementById('deploy-mode-hint');

  let projects = null; // null while list_projects runs
  let matches = [];
  let thumbs = new Map(); // card canvases by repo path, drawn once per opening
  let previews = new Map(); // project_preview results by repo path; { error } when it failed
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

  function townThumb(project, { w, h } = CARD_THUMB) {
    const canvas = el('canvas', 'project-thumb');
    canvas.width = w;
    canvas.height = h;
    canvas.setAttribute('aria-hidden', 'true');
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    drawGrass(ctx, 0, 0, w, h, 7);
    drawTownCenter(ctx, Math.round((w - 40) / 2), h - 40, getTeam(project.name), false, 1, getDesign(project.name), 0);
    return canvas;
  }

  function cardThumb(project) {
    if (!thumbs.has(project.path)) thumbs.set(project.path, townThumb(project));
    return thumbs.get(project.path);
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
      ...matches.map((project) => {
        const item = el('li');
        const button = el('button', 'project-card');
        button.type = 'button';
        button.setAttribute('role', 'option');
        button.title = homeRelative(project.path);
        button.append(cardThumb(project), el('strong', null, project.name), el('small', null, [recencyText(project), project.parent].filter(Boolean).join(' · ')));
        const badge = agentBadge(project);
        if (badge) button.append(badge); // over the town, so the name keeps the card's width
        button.addEventListener('click', () => choose(project));
        button.addEventListener('contextmenu', (event) => openProjectMenu(project, event, button));
        item.append(button);
        return item;
      }),
    );
    if (matches.length === 0) list.append(el('li', 'project-empty', 'Nenhum repositório com esse nome em ~/Code'));
    syncCards();
  }

  // Highlight and selection change without rebuilding the cards, so their canvases stay put.
  function syncCards() {
    list.querySelectorAll('.project-card').forEach((button, index) => {
      button.setAttribute('aria-selected', String(matches[index] === selected));
      button.classList.toggle('is-active', index === activeIndex);
    });
    list.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  }

  function columnCount() {
    return getComputedStyle(list).gridTemplateColumns.split(' ').length || 1;
  }

  // Up and down move a row; left and right a card, once the caret has no room that way in the search.
  function gridStep(event) {
    const isAtStart = search.selectionEnd === 0;
    const isAtEnd = search.selectionStart === search.value.length;
    if (event.key === 'ArrowDown') return columnCount();
    if (event.key === 'ArrowUp') return -columnCount();
    if (event.key === 'ArrowRight' && isAtEnd) return 1;
    if (event.key === 'ArrowLeft' && isAtStart) return -1;
    return 0;
  }

  function renderPreview() {
    if (!selected) {
      preview.replaceChildren(el('p', 'project-preview-empty', 'Escolha um projeto na galeria'));
      return;
    }
    const project = selected;
    const info = previews.get(project.path);
    const head = el('p', 'project-preview-name');
    head.append(el('strong', null, project.name), el('small', null, homeRelative(project.path)));
    head.title = project.path;
    const parts = [head];
    if (!info) parts.push(el('p', 'project-preview-note', 'Lendo o repositório…'));
    else if (info.error) parts.push(el('p', 'project-preview-note', `Não consegui ler o repositório: ${info.error}`));
    else parts.push(...previewDetails(project, info));
    preview.replaceChildren(...parts);
  }

  function previewDetails(project, info) {
    const details = [el('p', 'project-preview-summary', info.summary ?? 'Sem README para resumir.')];
    if (info.stack.length > 0) {
      const chips = el('ul', 'project-stack');
      chips.setAttribute('aria-label', 'Feito com');
      chips.append(...info.stack.map((label) => el('li', null, label)));
      details.push(chips);
    }
    const git = [info.branch, info.changes !== null && changesText(info.changes)].filter(Boolean).join(' · ');
    if (git) details.push(el('p', 'project-preview-git', git));
    if (info.lastCommit) {
      const commit = el('p', 'project-preview-commit');
      commit.append(el('small', null, `Último commit há ${age(info.lastCommitAt)}`), info.lastCommit);
      details.push(commit);
    }
    if (project.trackedFiles) details.push(el('p', 'project-preview-note', `${project.trackedFiles.toLocaleString('pt-BR')} arquivos no git`));
    return details;
  }

  // Read once per opening; a late answer for a repo no longer chosen is kept for when it comes back.
  async function loadPreview(project) {
    if (previews.has(project.path)) return;
    try {
      previews.set(project.path, await invoke('project_preview', { path: project.path }));
    } catch (err) {
      previews.set(project.path, { error: String(err) });
    }
    if (selected === project) renderPreview();
  }

  // New snapshots only swap the badges, so focus, scroll and the highlighted row stay put.
  function refreshBadges() {
    if (dialog.hidden) return;
    list.querySelectorAll('.project-card').forEach((button, index) => {
      button.querySelector('.project-agents')?.remove();
      const badge = agentBadge(matches[index]);
      if (badge) button.append(badge);
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
    activeIndex = Math.max(0, matches.indexOf(project)); // arrows go on from the chosen card
    syncCards();
    renderPreview();
    loadPreview(project);
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
    thumbs = new Map(); // a design or color may have changed since
    previews = new Map();
    renderPreview();
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
    renderList();
    if (start) choose(start);
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
    const step = gridStep(event);
    if (step !== 0 && matches.length > 0) {
      event.preventDefault();
      activeIndex = Math.min(matches.length - 1, Math.max(0, activeIndex + step));
      syncCards();
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
