// Clicking a town center: a small card, like a building's command panel in AoE, to train a
// villager (deploy an agent) right in that repository: write the task, pick where it runs. It also
// lists who is in the building, the ones waiting for the user apart from the ones working.

const CREW_SECTIONS = [
  ['waiting', 'Aguardando você'],
  ['working', 'Trabalhando'],
];

// Where Enter trains the villager, said in the empty field, since a dropped token can change it.
const ENTER_LABELS = { office: 'aqui no app', cursor: 'no Cursor', terminal: 'no terminal' };

export function createBaseCard({ describe, deployTo, openFull, openDesign, openOptions, pickAgent }) {
  const card = document.getElementById('base-card');
  const title = document.getElementById('base-card-title');
  const meta = document.getElementById('base-card-meta');
  const crewBox = document.getElementById('base-card-crew');
  const input = document.getElementById('base-card-task');
  const modes = [...card.querySelectorAll('[data-mode]')];
  let project = null;
  let preferred = 'cursor'; // the mode Enter uses: the token dropped here, or Cursor

  // Here in the app and in Cursor the agent needs a task; the terminal can open a bare claude.
  function refresh() {
    for (const button of modes) button.disabled = button.dataset.needsTask === 'true' && input.value.trim() === '';
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

  function train(mode) {
    const name = project;
    const text = input.value.trim();
    close();
    if (name) deployTo(name, text, mode);
  }

  for (const button of modes) button.addEventListener('click', () => train(button.dataset.mode));
  input.addEventListener('input', refresh);
  document.getElementById('base-card-form').addEventListener('submit', (event) => {
    event.preventDefault();
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
