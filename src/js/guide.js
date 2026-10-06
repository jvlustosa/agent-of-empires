// Guidance on the map after the first run: a campaign of objectives, like the AoE tutorial, that
// each tick off from the real action (never a fake step), and the keyboard shortcuts behind "?".

const CAMPAIGN_KEY = 'cpo.campaign';
const MISSIONS = [
  { id: 'train', title: 'Treine um aldeão', hint: 'Clique no Centro da Cidade de uma base, escreva a tarefa e aperte Enter.' },
  { id: 'inspect', title: 'Veja o que um aldeão faz', hint: 'Clique num aldeão no mapa, ou no card dele no painel.' },
  { id: 'approve', title: 'Responda a um pedido', hint: 'Quando um agente pedir permissão, use Aprovar ou Negar no painel.' },
  { id: 'view', title: 'Troque a vista do mapa', hint: 'Tecla V, ou o botão 2D/3D no canto do mapa.' },
  { id: 'move', title: 'Mude uma base de lugar', hint: 'Arraste o Centro da Cidade para outro ponto do mapa.' },
];

const SHORTCUTS = [
  ['Mapa', [
    ['Rodinha', 'aproxima e afasta no ponteiro (Shift anda para o lado)'],
    ['Setas ou WASD', 'andam pelo mapa'],
    ['Botão do meio ou Espaço + arrastar', 'puxa o mapa'],
    ['V', 'troca a vista: de cima, isométrica, 3D'],
    ['Q / E', 'giram a câmera'],
    ['F', 'só o mapa'],
    ['I', 'Visão do império'],
    ['K', 'O Batedor: missões, equipamento e diário'],
    ['B', 'Construir: funda uma base'],
    ['M', 'próxima música'],
  ]],
  ['Agentes', [
    ['Ctrl+K', 'novo agente'],
    ['/', 'campo de comando'],
    ['.', 'próximo aldeão ocioso'],
    ['Shift ou Ctrl + clique', 'soma à seleção'],
    ['Ctrl+A', 'seleciona todos'],
    ['T', 'tarefas dos selecionados, com um comando para cada'],
    ['Esc', 'limpa a seleção ou cancela'],
  ]],
  ['Interface', [
    ['Ctrl+= / Ctrl+- / Ctrl+0', 'zoom da interface'],
    ['Ctrl+B', 'recolhe e reabre o painel'],
    ['F5 ou Ctrl+R', 'relê tudo'],
    ['?', 'esta lista'],
  ]],
];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function isTyping() {
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
}

function readCampaign() {
  try {
    const saved = JSON.parse(localStorage.getItem(CAMPAIGN_KEY));
    if (saved && typeof saved === 'object') return { isActive: Boolean(saved.isActive), done: saved.done ?? {}, isCollapsed: Boolean(saved.isCollapsed) };
  } catch {
    // starts over below
  }
  return { isActive: false, done: {}, isCollapsed: false };
}

/** The objectives, at the top of the side panel (empty on a first run, and off the map's bases).
 * complete(id) ticks one off; observe* derive them from what the map saves. */
export function createCampaign({ before, showToast }) {
  let state = readCampaign();
  let firstView = null;
  let pinnedSpots = null; // project -> "x,y" from the last saved layout

  const panel = el('aside', 'campaign');
  panel.setAttribute('aria-label', 'Objetivos');
  const head = el('header', 'campaign-head');
  const toggle = el('button', 'campaign-toggle');
  toggle.type = 'button';
  const dismiss = el('button', 'icon-button campaign-dismiss', '✕');
  dismiss.type = 'button';
  dismiss.setAttribute('aria-label', 'Dispensar os objetivos');
  head.append(toggle, dismiss);
  const list = el('ol', 'campaign-list');
  panel.append(head, list);
  before.before(panel);

  function save() {
    try {
      localStorage.setItem(CAMPAIGN_KEY, JSON.stringify(state));
    } catch {
      // this run keeps its progress
    }
  }

  function render() {
    panel.hidden = !state.isActive;
    if (!state.isActive) return;
    const doneCount = MISSIONS.filter((mission) => state.done[mission.id]).length;
    const isComplete = doneCount === MISSIONS.length;
    toggle.textContent = `${isComplete ? 'Campanha concluída' : 'Objetivos'} ${doneCount}/${MISSIONS.length} ${state.isCollapsed ? '▸' : '▾'}`;
    toggle.setAttribute('aria-expanded', String(!state.isCollapsed));
    list.hidden = state.isCollapsed;
    list.replaceChildren();
    const current = MISSIONS.find((mission) => !state.done[mission.id]);
    for (const mission of MISSIONS) {
      const isDone = Boolean(state.done[mission.id]);
      const item = el('li', `campaign-mission${isDone ? ' is-done' : ''}${mission === current ? ' is-current' : ''}`);
      item.append(el('span', 'campaign-mark', isDone ? '✓' : '·'), el('span', 'campaign-title', mission.title));
      if (mission === current) item.append(el('small', 'campaign-hint', mission.hint));
      list.append(item);
    }
    if (isComplete) list.append(el('li', 'campaign-hint', 'Você já sabe o essencial. Tecla ? mostra todos os atalhos.'));
  }

  function complete(id) {
    if (!state.isActive || state.done[id] || !MISSIONS.some((mission) => mission.id === id)) return;
    state.done[id] = Date.now();
    save();
    render();
    const mission = MISSIONS.find((m) => m.id === id);
    showToast(`Objetivo cumprido: ${mission.title}`);
  }

  toggle.addEventListener('click', () => {
    state.isCollapsed = !state.isCollapsed;
    save();
    render();
  });
  dismiss.addEventListener('click', () => {
    state.isActive = false;
    save();
    render();
  });

  render();
  return {
    start() {
      state = { isActive: true, done: {}, isCollapsed: false };
      save();
      render();
    },
    complete,
    /** The map's view on every change; switching away from the first one seen completes "view". */
    observeView(mode) {
      if (firstView === null) firstView = mode;
      else if (mode !== firstView) complete('view');
    },
    /** Every saved layout; a pinned base that moved completes "move" (new pins do not count). */
    observeLayout(layout) {
      const spots = new Map(Object.entries(layout?.pinned ?? {}).map(([project, pos]) => [project, `${pos.x},${pos.y}`]));
      if (pinnedSpots && [...spots].some(([project, spot]) => pinnedSpots.has(project) && pinnedSpots.get(project) !== spot)) complete('move');
      pinnedSpots = spots;
    },
  };
}

/** The keyboard shortcuts, behind the "?" key or a button. */
export function createHelp() {
  const backdrop = el('div', 'settings-backdrop');
  const dialog = el('section', 'modal shortcuts');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'shortcuts-title');
  backdrop.hidden = true;
  dialog.hidden = true;
  const head = el('header', 'settings-head');
  const title = el('h2', '', 'Atalhos do teclado');
  title.id = 'shortcuts-title';
  const closeButton = el('button', 'icon-button', '✕');
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', 'Fechar');
  head.append(title, closeButton);
  const body = el('div', 'modal-body shortcuts-body');
  for (const [group, keys] of SHORTCUTS) {
    const section = el('section');
    section.append(el('h3', 'field-label', group));
    const table = el('dl', 'shortcuts-list');
    for (const [key, action] of keys) table.append(el('dt', '', key), el('dd', '', action));
    section.append(table);
    body.append(section);
  }
  body.append(el('p', 'modal-note', 'As teclas do mapa só valem com o foco nele, nunca enquanto você digita.'));
  dialog.append(head, body);
  document.body.append(backdrop, dialog);

  function close() {
    dialog.hidden = true;
    backdrop.hidden = true;
  }

  function open() {
    dialog.hidden = false;
    backdrop.hidden = false;
    closeButton.focus();
  }

  closeButton.addEventListener('click', close);
  backdrop.addEventListener('click', close);
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    close();
  });
  window.addEventListener('keydown', (event) => {
    if (event.key !== '?' || isTyping() || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    if (dialog.hidden) open();
    else close();
  });
  return { open, close };
}
