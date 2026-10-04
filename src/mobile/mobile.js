// The phone page of the "Celular" panel, served by the app itself (src-tauri/src/phone.rs): follows
// the agents on the computer, answers their prompts, replies to the ones the app hosts and starts
// new ones. Everything shown came from the agents, so it only ever goes in as text.
import { formatElapsed, kindInfo } from './kinds.js';

const TOKEN_KEY = 'aoe.phone.token';
const POLL_MS = 2000;
const TOAST_MS = 3500;
const PAGE_TITLE = 'Agent of Empires';

const liveEl = document.getElementById('live');
const pairEl = document.getElementById('pair');
const pairText = document.getElementById('pair-text');
const approvalsBlock = document.getElementById('approvals-block');
const approvalsEl = document.getElementById('approvals');
const agentsBlock = document.getElementById('agents-block');
const agentsEl = document.getElementById('agents');
const agentsEmpty = document.getElementById('agents-empty');
const newOpen = document.getElementById('new-open');
const newDialog = document.getElementById('new-agent');
const newProject = document.getElementById('new-project');
const newTask = document.getElementById('new-task');
const newSubmit = document.getElementById('new-submit');
const replyDialog = document.getElementById('reply');
const replyTitle = document.getElementById('reply-title');
const replyLast = document.getElementById('reply-last');
const replyText = document.getElementById('reply-text');
const replySubmit = document.getElementById('reply-submit');
const toastEl = document.getElementById('toast');

let token = takeTokenFromLink() ?? readToken();
let state = null;
let pollTimer = null;
let isPolling = false;
let approvalsKey = null;
let seenApprovals = null; // ids already shown, so only a new prompt buzzes
let projects = null;
let replyingTo = null;
let toastTimer = null;

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function readToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null; // private mode: the code lives only in this tab
  }
}

function saveToken(value) {
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // private mode: kept in memory only
  }
}

/** The QR link brings the code in the #fragment: kept, then wiped from the address bar. */
function takeTokenFromLink() {
  const fromLink = new URLSearchParams(location.hash.slice(1)).get('t');
  if (!fromLink) return null;
  saveToken(fromLink);
  history.replaceState(null, '', location.pathname);
  return fromLink;
}

async function api(path, body) {
  const isPost = body !== undefined;
  const response = await fetch(`api/${path}`, {
    method: isPost ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(isPost ? { 'Content-Type': 'application/json' } : {}) },
    body: isPost ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(data.error ?? `Erro ${response.status}`, response.status);
  return data;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function button(className, text, onClick) {
  const node = el('button', className, text);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

function showToast(message, isError = false) {
  toastEl.textContent = message;
  toastEl.classList.toggle('is-error', isError);
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), TOAST_MS);
}

function setLive(isLive) {
  liveEl.textContent = isLive ? 'ao vivo' : 'sem conexão';
  liveEl.classList.toggle('is-live', isLive);
  liveEl.classList.toggle('is-down', !isLive);
}

function showPairing(message) {
  state = null;
  approvalsKey = null;
  pairEl.hidden = false;
  if (message) pairText.textContent = message;
  approvalsBlock.hidden = true;
  agentsBlock.hidden = true;
  newOpen.hidden = true;
  liveEl.textContent = 'sem código';
  liveEl.classList.remove('is-live', 'is-down');
  document.title = PAGE_TITLE;
}

async function poll() {
  if (isPolling) return;
  clearTimeout(pollTimer);
  if (!token) {
    showPairing();
    return;
  }
  isPolling = true;
  try {
    state = await api('state');
    setLive(true);
    render();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      token = null;
      saveToken(null);
      showPairing('O código deste celular foi trocado ou o acesso foi desligado no computador. Escaneie o QR code de novo no painel Celular.');
      return;
    }
    setLive(false);
  } finally {
    isPolling = false;
  }
  if (token && !document.hidden) pollTimer = setTimeout(poll, POLL_MS);
}

function agentName(agent) {
  return agent?.project ?? 'Sessão do Claude';
}

function hostLabel(agent) {
  return agent.isHosted ? 'no app' : (agent.host ?? 'terminal');
}

function isYourTurn(agent) {
  return agent.status !== 'busy';
}

// Blocked on you first, then your turn, then the ones working.
function attentionRank(agent) {
  if (agent.activity.kind === 'asking') return 0;
  return isYourTurn(agent) ? 1 : 2;
}

function render() {
  pairEl.hidden = true;
  newOpen.hidden = false;
  renderApprovals();
  renderAgents();
  const waiting = state.approvals.length;
  document.title = waiting ? `(${waiting}) ${PAGE_TITLE}` : PAGE_TITLE;
}

// Rebuilt only when the prompts change, so a half-filled answer survives the polls.
function renderApprovals() {
  const key = state.approvals.map((a) => a.id).join(',');
  if (key !== approvalsKey) {
    approvalsKey = key;
    approvalsEl.replaceChildren(...state.approvals.map(renderApproval));
    const ids = new Set(state.approvals.map((a) => a.id));
    if (seenApprovals && [...ids].some((id) => !seenApprovals.has(id))) navigator.vibrate?.([120, 60, 120]);
    seenApprovals = ids;
  }
  approvalsBlock.hidden = state.approvals.length === 0;
  document.getElementById('approvals-count').textContent = `(${state.approvals.length})`;
  for (const timer of approvalsEl.querySelectorAll('[data-expires]')) timer.textContent = approvalTimer(Number(timer.dataset.expires));
}

function approvalTimer(expiresAt) {
  if (!Number.isFinite(expiresAt)) return 'esperando você';
  // The computer's clock, not the phone's: they can disagree by seconds.
  const seconds = Math.max(0, Math.ceil((expiresAt - state.now) / 1000));
  return `o editor assume em ${seconds}s`;
}

function renderApproval(approval) {
  const agent = state.agents.find((a) => a.id === approval.sessionId);
  const item = el('li', 'card is-approval');
  const head = el('div', 'card-head');
  const timer = el('span', 'card-meta', approvalTimer(approval.expiresAt));
  if (Number.isFinite(approval.expiresAt)) timer.dataset.expires = String(approval.expiresAt);
  head.append(el('strong', null, agentName(agent)), timer);
  item.append(head);
  if (agent?.title) item.append(el('p', 'card-title', agent.title));
  item.append(el('p', 'activity', approval.label));
  if (approval.kind === 'question') {
    renderQuestions(approval, item);
    return item;
  }
  if (approval.detail) item.append(el('pre', 'detail', approval.detail));
  const actions = el('div', 'actions');
  const allow = button('btn btn-allow', 'Aprovar', () => answer(approval, 'allow', [allow, deny]));
  const deny = button('btn btn-deny', 'Negar', () => answer(approval, 'deny', [allow, deny]));
  actions.append(allow, deny);
  item.append(actions);
  return item;
}

function renderQuestions(approval, item) {
  const questions = approval.questions ?? [];
  const chosen = new Map();
  const typed = new Map();
  const submit = button('btn btn-allow', 'Responder', () => {
    const answers = {};
    for (const q of questions) answers[q.question] = typed.get(q.question).value.trim() || [...chosen.get(q.question)].join(', ');
    answer(approval, 'allow', [submit, deny], answers);
  });
  const deny = button('btn btn-deny', 'Não responder', () => answer(approval, 'deny', [submit, deny]));
  const isAnswered = (q) => chosen.get(q.question).size > 0 || typed.get(q.question).value.trim() !== '';
  const refresh = () => (submit.disabled = !questions.every(isAnswered));
  for (const q of questions) {
    item.append(el('p', 'question-text', q.header ? `${q.header} · ${q.question}` : q.question));
    const options = el('div', 'options');
    const picked = new Set();
    chosen.set(q.question, picked);
    for (const option of q.options ?? []) {
      const choice = button('option', null, () => {
        const isOn = picked.has(option.label);
        if (!q.multiSelect) {
          picked.clear();
          for (const other of options.querySelectorAll('.option')) other.setAttribute('aria-pressed', 'false');
        }
        if (isOn) picked.delete(option.label);
        else picked.add(option.label);
        choice.setAttribute('aria-pressed', String(!isOn));
        refresh();
      });
      choice.setAttribute('aria-pressed', 'false');
      choice.append(el('strong', null, option.label));
      if (option.description) choice.append(el('small', null, option.description));
      options.append(choice);
    }
    const other = el('input', 'field');
    other.placeholder = 'Outra resposta…';
    other.setAttribute('aria-label', `Outra resposta: ${q.question}`);
    other.addEventListener('input', refresh);
    typed.set(q.question, other);
    item.append(options, other);
  }
  const actions = el('div', 'actions');
  actions.append(submit, deny);
  item.append(actions);
  refresh();
}

async function answer(approval, decision, buttons, answers = null) {
  for (const b of buttons) b.disabled = true;
  try {
    await api(`approvals/${approval.id}`, { decision, answers });
    showToast(answers ? 'Resposta enviada' : decision === 'allow' ? 'Aprovado' : 'Negado');
    poll();
  } catch (err) {
    showToast(err.message, true);
    for (const b of buttons) b.disabled = false;
  }
}

function renderAgents() {
  const agents = [...state.agents].sort((a, b) => attentionRank(a) - attentionRank(b) || agentName(a).localeCompare(agentName(b)));
  agentsBlock.hidden = false;
  agentsEmpty.hidden = agents.length > 0;
  document.getElementById('agents-count').textContent = agents.length ? `(${agents.length})` : '';
  agentsEl.replaceChildren(...agents.map(renderAgent));
}

function renderAgent(agent) {
  const info = kindInfo(agent.activity.kind);
  const item = el('li', 'card');
  item.style.setProperty('--kind', info.color);
  const head = el('div', 'card-head');
  const elapsed = formatElapsed(agent.activity.since, state.now);
  head.append(el('strong', null, agentName(agent)), el('span', 'card-meta', [hostLabel(agent), elapsed].filter(Boolean).join(' · ')));
  item.append(head);
  const title = agent.title ?? agent.lastPrompt;
  if (title) item.append(el('p', 'card-title', title));
  item.append(el('p', 'activity', agent.activity.label || info.label));
  if (!isYourTurn(agent)) return item;
  if (agent.lastReply) item.append(el('p', 'excerpt', agent.lastReply));
  if (agent.isHosted) {
    const actions = el('div', 'actions');
    actions.append(button('btn btn-primary', 'Responder', () => openReply(agent)));
    item.append(actions);
  } else {
    item.append(el('p', 'note', `Para responder, use o ${agent.host ?? 'terminal'} no computador.`));
  }
  return item;
}

function openReply(agent) {
  replyingTo = agent.id;
  replyTitle.textContent = `Responder · ${agentName(agent)}`;
  replyLast.textContent = agent.lastReply ?? '';
  replyLast.hidden = !agent.lastReply;
  replyDialog.showModal();
  replyText.focus();
}

document.getElementById('reply-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = replyText.value.trim();
  if (!text) return;
  replySubmit.disabled = true;
  try {
    await api(`agents/${encodeURIComponent(replyingTo)}/reply`, { text });
    replyText.value = '';
    replyDialog.close();
    showToast('Mensagem enviada ao agente');
    poll();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    replySubmit.disabled = false;
  }
});

newOpen.addEventListener('click', async () => {
  newDialog.showModal();
  if (projects) return;
  newProject.replaceChildren(el('option', null, 'Carregando projetos…'));
  newProject.disabled = true;
  try {
    projects = await api('projects');
    newProject.replaceChildren(
      ...projects.map((project) => {
        const option = el('option', null, project.name);
        option.value = project.path;
        return option;
      }),
    );
  } catch (err) {
    newProject.replaceChildren(el('option', null, 'Não consegui listar os projetos'));
    showToast(err.message, true);
  } finally {
    newProject.disabled = !projects?.length;
  }
});

document.getElementById('new-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const task = newTask.value.trim();
  if (!task || !newProject.value) return;
  newSubmit.disabled = true;
  try {
    const result = await api('agents', { path: newProject.value, task });
    newTask.value = '';
    newDialog.close();
    showToast(result.message ?? 'Agente trabalhando');
    poll();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    newSubmit.disabled = false;
  }
});

for (const close of document.querySelectorAll('[data-close]')) {
  close.addEventListener('click', () => close.closest('dialog').close());
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearTimeout(pollTimer);
  else poll();
});

poll();
