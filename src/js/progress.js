// The empire's progression and the app's own usage, kept on this machine (localStorage, no network):
// achievements unlocked by real work, the history of what happened (bases founded, eras reached,
// wonders raised) and the PRD's usage metrics.

const STORE_KEY = 'cpo.progress';
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const KEEP_MS = 60 * DAY_MS;
const EVENTS_MAX = 120;
// A session waiting on you this long without an answer counts as forgotten.
const FORGOTTEN_MS = 30 * 60 * 1000;
// The PRD's gate to the progression phase: the empire overview opened this often in a week.
export const GATE_OPENS_PER_WEEK = 3;

// state: { bases, maxEra, working, commitsWeek, hoursWeek, explored, personalized, wonders }
export const ACHIEVEMENTS = [
  { id: 'fundador', name: 'Fundador', hint: 'Ter a primeira base no mapa', isUnlocked: (s) => s.bases >= 1 },
  { id: 'cidade-estado', name: 'Cidade-estado', hint: '5 bases no império', isUnlocked: (s) => s.bases >= 5 },
  { id: 'imperio', name: 'Império', hint: '10 bases no império', isUnlocked: (s) => s.bases >= 10 },
  { id: 'era-imperial', name: 'Era Imperial', hint: 'Uma base chega à Era Imperial pelo trabalho', isUnlocked: (s) => s.maxEra >= 5 },
  { id: 'exercito', name: 'Exército', hint: '5 agentes trabalhando ao mesmo tempo', isUnlocked: (s) => s.working >= 5 },
  { id: 'mina-de-ouro', name: 'Mina de ouro', hint: '100 commits numa semana', isUnlocked: (s) => s.commitsWeek >= 100 },
  { id: 'celeiro-cheio', name: 'Celeiro cheio', hint: '50 horas de agente numa semana', isUnlocked: (s) => s.hoursWeek >= 50 },
  { id: 'explorador', name: 'Explorador', hint: '15 repositórios explorados', isUnlocked: (s) => s.explored >= 15 },
  { id: 'arquiteto', name: 'Arquiteto', hint: '5 bases personalizadas', isUnlocked: (s) => s.personalized >= 5 },
  { id: 'maravilha', name: 'Maravilha', hint: 'Erguer a primeira maravilha', isUnlocked: (s) => s.wonders >= 1 },
];

function emptyData() {
  return { achievements: {}, events: [], opens: [], waits: [], forgotten: {} };
}

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null');
    return data && typeof data === 'object' ? { ...emptyData(), ...data } : emptyData();
  } catch {
    return emptyData();
  }
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function createProgress() {
  const data = load();
  const approvalsSeen = new Map(); // approval id -> when it first showed up in the panel

  function save() {
    const cutoff = Date.now() - KEEP_MS;
    data.opens = data.opens.filter((at) => at >= cutoff);
    data.waits = data.waits.filter((wait) => wait.at >= cutoff);
    for (const [id, at] of Object.entries(data.forgotten)) if (at < cutoff) delete data.forgotten[id];
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
    } catch {
      // storage blocked: progression lasts until the app closes
    }
  }

  function addEvent(kind, text, project = null) {
    data.events.unshift({ at: Date.now(), kind, text, project });
    data.events = data.events.slice(0, EVENTS_MAX);
    save();
  }

  /** Unlocks what the state now earns; returns the new ones (each also becomes a history event). */
  function checkAchievements(state) {
    const fresh = ACHIEVEMENTS.filter((achievement) => !data.achievements[achievement.id] && achievement.isUnlocked(state));
    for (const achievement of fresh) {
      data.achievements[achievement.id] = Date.now();
      data.events.unshift({ at: Date.now(), kind: 'achievement', text: `Conquista: ${achievement.name}`, project: null });
    }
    if (fresh.length > 0) {
      data.events = data.events.slice(0, EVENTS_MAX);
      save();
    }
    return fresh;
  }

  // ---------- Usage metrics (the PRD's "Métricas de sucesso") ----------

  function overviewOpened() {
    data.opens.push(Date.now());
    save();
  }

  function approvalsShown(list) {
    for (const approval of list) if (!approvalsSeen.has(approval.id)) approvalsSeen.set(approval.id, Date.now());
  }

  /** Answered from the panel: how long it waited on you. */
  function approvalAnswered(id) {
    const since = approvalsSeen.get(id);
    if (since === undefined) return;
    data.waits.push({ at: Date.now(), ms: Date.now() - since });
    approvalsSeen.delete(id);
    save();
  }

  /** Sessions on your turn for more than 30 min count once as forgotten. */
  function trackWaiting(waiting) {
    let isChanged = false;
    for (const agent of waiting) {
      if (!Number.isFinite(agent.activity?.since) || Date.now() - agent.activity.since < FORGOTTEN_MS) continue;
      const key = `${agent.id}@${agent.activity.since}`;
      if (data.forgotten[key]) continue;
      data.forgotten[key] = Date.now();
      isChanged = true;
    }
    if (isChanged) save();
  }

  function usage() {
    const weekAgo = Date.now() - WEEK_MS;
    const opensWeek = data.opens.filter((at) => at >= weekAgo).length;
    const waitMs = median(data.waits.filter((wait) => wait.at >= weekAgo).map((wait) => wait.ms));
    return {
      opensWeek,
      medianWaitSeconds: waitMs === null ? null : Math.round(waitMs / 1000),
      forgottenWeek: Object.values(data.forgotten).filter((at) => at >= weekAgo).length,
      isGateOpen: opensWeek >= GATE_OPENS_PER_WEEK,
    };
  }

  return {
    addEvent,
    checkAchievements,
    achievements: () => ACHIEVEMENTS.map((achievement) => ({ ...achievement, at: data.achievements[achievement.id] ?? null })),
    events: () => data.events,
    overviewOpened,
    approvalsShown,
    approvalAnswered,
    trackWaiting,
    usage,
  };
}
