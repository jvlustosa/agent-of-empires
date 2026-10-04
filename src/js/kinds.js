// Activity kinds come from the server (lib/transcript.mjs TOOL_KINDS + derived states).
export const KINDS = {
  terminal: { label: 'Terminal', color: '#4ade80' },
  // A git or gh command in the shell: still the forge, with git's orange.
  git: { label: 'No git', color: '#f05033' },
  coding: { label: 'Editando', color: '#60a5fa' },
  reading: { label: 'Lendo', color: '#f472b6' },
  web: { label: 'Na web', color: '#22d3ee' },
  thinking: { label: 'Pensando', color: '#f0a383' },
  writing: { label: 'Respondendo', color: '#f5d0a9' },
  delegating: { label: 'Delegando', color: '#c084fc' },
  planning: { label: 'Planejando', color: '#a3e635' },
  asking: { label: 'Precisa de você', color: '#f87171' },
  tool: { label: 'Ferramenta', color: '#94a3b8' },
  idle: { label: 'Aguardando você', color: '#64748b' },
  // Turn finished: the next move is the user's. Amber = your turn, red (asking) = blocked on you.
  yourturn: { label: 'Sua vez', color: '#fbbf24' },
  done: { label: 'Concluído', color: '#34d399' },
};

export const TYPING_KINDS = new Set(['coding', 'terminal', 'writing']);

// Where the task stands, read from the turn's tool mix (agents here keep no todo list):
// no edits yet = exploring; edits with mostly terminal lately = testing; text = answering.
export const PHASES = ['Explorando', 'Implementando', 'Testando', 'Respondendo'];
const PHASE_WINDOW = 8;

export function phaseOf(agent) {
  if (agent.status !== 'busy' || agent.activity.kind === 'writing') return 3;
  const steps = agent.steps ?? [];
  if (!steps.some((step) => step.kind === 'coding')) return 0;
  const recent = steps.slice(-PHASE_WINDOW);
  const count = (kind) => recent.filter((step) => step.kind === kind).length;
  return count('terminal') > count('coding') ? 2 : 1;
}

const TRUNK_BRANCHES = new Set(['main', 'master']);

// The branch the agent works on when it is not the trunk (nor a detached HEAD); null otherwise.
export function featureBranch(agent) {
  const { branch } = agent;
  return branch && !TRUNK_BRANCHES.has(branch) && branch !== 'HEAD' ? branch : null;
}

// claude-mem's observer sessions watch the other agents; they never take a desk or need the user.
export function isObserver(agent) {
  return agent.entrypoint.startsWith('sdk') && /observer/i.test(agent.project);
}

export function kindInfo(kind) {
  return KINDS[kind] || KINDS.tool;
}

export function formatElapsed(since, now = Date.now()) {
  if (!Number.isFinite(since)) return '';
  const seconds = Math.max(0, Math.round((now - since) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${String(minutes % 60).padStart(2, '0')}`;
}
