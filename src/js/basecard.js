// Clicking a town center: a small card, like a building's command panel in AoE, to train
// villagers (deploy agents) right in that repository: write the task, pick where it runs, and queue
// more villagers, each with its own task. It also lists who is in the building, the ones waiting
// for the user apart from the ones working.

const CREW_SECTIONS = [
  ['waiting', 'Aguardando você'],
  ['working', 'Trabalhando'],
];

// Where Enter trains the villager, said in the empty field, since a dropped token can change it.
const ENTER_LABELS = { office: 'aqui no app', cursor: 'no Cursor', terminal: 'no terminal' };

// The training queue, as AoE's five: one session per task, all working in this repository at once.
const MAX_TRAINEES = 5;

export function createBaseCard({ describe, deployTo, openFull, openDesign, openOptions, pickAgent }) {
  const card = document.getElementById('base-card');
  const title = document.getElementById('base-card-title');
  const meta = document.getElementById('base-card-meta');
  const crewBox = document.getElementById('base-card-crew');
  const form = document.getElementById('base-card-form');
  const input = document.getElementById('base-card-task');
  const addButton = document.getElementById('base-card-add');
  const count = document.getElementById('base-card-count');
  const modes = [...card.querySelectorAll('[data-mode]')];
  let project = null;
  let preferred = 'cursor'; // the mode Enter uses: the token dropped here, or Cursor

  function taskFields() {
    return [...form.querySelectorAll('.field')];
  }

  function tasks() {
    return taskFields()
      .map((field) => field.value.trim())
      .filter(Boolean);
  }

  // Here in the app and in Cursor the agent needs a task; the terminal can open a bare claude.
  function refresh() {
    const ready = tasks().length;
    for (const button of modes) button.disabled = button.dataset.needsTask === 'true' && ready === 0;
    const queued = taskFields().length;
    addButton.disabled = queued >= MAX_TRAINEES;
    count.hidden = queued < 2;
    count.textContent = ready === 0 ? 'Escreva a tarefa de cada um' : `Treina ${ready} ${ready === 1 ? 'aldeão' : 'aldeões'}`;
  }

  // Another villager in the queue: its own task box, and a button to take it back out.
  function addTrainee() {
    if (taskFields().length >= MAX_TRAINEES) return;
    const row = document.createElement('div');
    row.className = 'base-card-row';
    const field = document.createElement('input');
    field.className = 'field';
    field.type = 'text';
    field.spellcheck = false;
    field.placeholder = 'Tarefa de outro aldeão';
    field.setAttribute('aria-label', 'Tarefa de outro aldeão');
    const remove = document.createElement('button');
    remove.className = 'icon-button';
    remove.type = 'button';
    remove.textContent = '×';
    remove.title = 'Tirar este aldeão da fila';
    remove.setAttribute('aria-label', 'Tirar este aldeão da fila');
    remove.addEventListener('click', () => {
      row.remove();
      refresh();
      taskFields().at(-1).focus();
    });
    row.append(field, remove);
    form.append(row);
    refresh();
    field.focus();
  }

  // A row per villager: its status in its activity color, then its task; clicking opens that task.
  function crewRow(row) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'crew-row';
    button.style.setProperty('--kind', row.color);
    const status = document.createElement('span');
    status.className = 'crew-status';
    status.textContent = row.status;
    const task = document.createElement('span');
    task.className = 'crew-task';
    task.textContent = row.task;
    button.title = row.task;
    button.append(status, task);
    button.addEventListener('click', () => {
      const box = button.getBoundingClientRect();
      close();
      pickAgent(row.id, { x: box.left, y: box.bottom });
    });
    return button;
  }

  function renderCrew(summary) {
    const sections = CREW_SECTIONS.filter(([key]) => summary[key]?.length > 0).map(([key, label]) => {
      const head = document.createElement('p');
      head.className = `crew-head crew-head-${key}`;
      head.textContent = `${label} (${summary[key].length})`;
      return [head, ...summary[key].map(crewRow)];
    });
    crewBox.replaceChildren(...sections.flat());
    crewBox.hidden = sections.length === 0;
  }

  function open(name, anchor, { mode = 'cursor' } = {}) {
    project = name;
    preferred = mode;
    for (const button of modes) button.classList.toggle('btn-primary', button.dataset.mode === mode);
    input.placeholder = `Tarefa do novo aldeão (Enter: ${ENTER_LABELS[mode]})`;
    const summary = describe(name);
    title.textContent = summary.title;
    meta.textContent = summary.meta;
    renderCrew(summary);
    input.value = '';
    for (const row of form.querySelectorAll('.base-card-row')) row.remove();
    refresh();
    card.hidden = false;
    const box = card.getBoundingClientRect();
    card.style.left = `${Math.min(Math.max(8, anchor.x - box.width / 2), window.innerWidth - box.width - 8)}px`;
    const below = anchor.y + 12;
    card.style.top = `${below + box.height > window.innerHeight - 8 ? Math.max(8, anchor.y - box.height - 12) : below}px`;
    input.focus();
  }

  function close() {
    card.hidden = true;
    project = null;
  }

  // One session per task, one after the other (Cursor focuses its window for each); with no task at
  // all, the terminal opens a bare claude. Stops once the folder is unknown (the full dialog took
  // over) or a deploy fails.
  async function train(mode) {
    const name = project;
    const queue = tasks();
    close();
    if (!name) return;
    for (const text of queue.length > 0 ? queue : ['']) {
      if ((await deployTo(name, text, mode)) !== true) return;
    }
  }

  for (const button of modes) button.addEventListener('click', () => train(button.dataset.mode));
  addButton.addEventListener('click', addTrainee);
  form.addEventListener('input', refresh);
  // Handled by hand: with two task boxes and no submit button, the browser no longer submits on Enter.
  form.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    if (event.shiftKey) {
      addTrainee();
      return;
    }
    const button = modes.find((b) => b.dataset.mode === preferred);
    if (!button?.disabled) train(preferred); // Enter: the chosen mode (Cursor, unless a token said otherwise)
  });
  document.getElementById('base-card-more').addEventListener('click', () => {
    const name = project;
    const text = input.value.trim();
    close();
    openFull(name, text);
  });
  document.getElementById('base-card-design').addEventListener('click', () => {
    const name = project;
    close();
    openDesign(name);
  });
  document.getElementById('base-card-options').addEventListener('click', (event) => {
    const name = project;
    const box = event.currentTarget.getBoundingClientRect();
    close();
    openOptions(name, { x: box.right, y: box.bottom });
  });
  card.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    close();
  });
  document.addEventListener('pointerdown', (event) => {
    if (!card.hidden && !card.contains(event.target)) close();
  });

  return { open, close, isOpen: () => !card.hidden };
}
