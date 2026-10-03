// First run, "Fundar o império": checks what this machine has, asks where the repositories live,
// founds the first bases and lets each integration be turned on knowing what it touches.

const STEPS = ['Reconhecimento', 'Repositórios', 'Primeiras bases', 'Integrações'];
const BASE_CHOICES = 12;
const PRESELECTED_BASES = 6;
const DAY_MS = 24 * 60 * 60 * 1000;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function ago(at, now = Date.now()) {
  const minutes = Math.max(1, Math.round((now - at) / 60000));
  if (minutes < 60) return `há ${minutes} min`;
  if (minutes < 24 * 60) return `há ${Math.round(minutes / 60)} h`;
  return `há ${Math.round((now - at) / DAY_MS)} d`;
}

function hasWebGl() {
  try {
    return Boolean(document.createElement('canvas').getContext('webgl2'));
  } catch {
    return false;
  }
}

// One line per check: ok, warn (works with less) or missing (the app needs it).
function checksFor(setup) {
  const checks = [];
  const claude = setup.claude;
  checks.push(claude
    ? { status: 'ok', text: `Claude Code ${claude.version ?? ''}`.trim() }
    : { status: 'missing', text: 'Claude Code não encontrado', fix: 'Instale o Claude Code (o comando claude) e abra o app de novo: cada sessão dele é um aldeão.' });
  checks.push(setup.transcriptFolders > 0
    ? { status: 'ok', text: `Histórico do Claude Code em ${setup.transcriptFolders} pastas` }
    : { status: 'warn', text: 'Nenhuma sessão do Claude Code ainda', fix: 'O mapa enche quando você usar o Claude Code; dá para começar daqui, treinando um aldeão.' });
  checks.push(setup.hasGit
    ? { status: 'ok', text: 'git' }
    : { status: 'warn', text: 'git não encontrado', fix: 'Sem git não há ouro, madeira nem eras: as bases ficam na primeira era.' });
  const editors = setup.editors ?? [];
  if (editors.includes('Cursor')) checks.push({ status: 'ok', text: `Editor: ${editors.join(', ')}` });
  else if (editors.length) checks.push({ status: 'warn', text: `Editor: ${editors.join(', ')}`, fix: 'Agentes "No Cursor" precisam do Cursor; o resto funciona.' });
  else checks.push({ status: 'warn', text: 'Nem Cursor nem VS Code no PATH', fix: 'Clicar no aldeão não abre a aba dele; aqui no app e no terminal funcionam.' });
  checks.push(setup.terminal
    ? { status: 'ok', text: `Terminal: ${setup.terminal}` }
    : { status: 'warn', text: 'Nenhum terminal encontrado', fix: 'Defina a variável TERMINAL para abrir agentes num terminal.' });
  if (setup.hasFocusExtension === false) {
    checks.push({ status: 'warn', text: 'Foco de janela no GNOME', fix: 'Instale a extensão "Activate Window By Title" para o clique trazer a janela do editor para a frente.' });
  } else if (setup.hasFocusExtension) {
    checks.push({ status: 'ok', text: 'Foco de janela no GNOME' });
  }
  checks.push(setup.audioPlayer
    ? { status: 'ok', text: `Som: ${setup.audioPlayer}` }
    : { status: 'warn', text: 'Sem pw-play, paplay ou aplay', fix: 'O app fica mudo: sons e trilha tocam por um desses.' });
  if (!setup.hasCurl) checks.push({ status: 'warn', text: 'curl não encontrado', fix: 'Os limites do plano não aparecem.' });
  checks.push(hasWebGl()
    ? { status: 'ok', text: 'Vista 3D (WebGL)' }
    : { status: 'warn', text: 'Sem WebGL', fix: 'A vista 3D fica desligada; 2D e isométrica funcionam.' });
  return checks;
}

const STATUS_MARKS = { ok: '✓', warn: '!', missing: '✕' };

function renderChecks(setup) {
  const list = el('ul', 'onboarding-checks');
  for (const check of checksFor(setup)) {
    const item = el('li', `onboarding-check is-${check.status}`);
    item.append(el('span', 'onboarding-mark', STATUS_MARKS[check.status]));
    const text = el('span', 'toggle-text', check.text);
    if (check.fix) text.append(el('small', '', check.fix));
    item.append(text);
    list.append(item);
  }
  return list;
}

function toggleRow(id, title, hint, isChecked) {
  const label = el('label', 'toggle');
  const input = el('input');
  input.type = 'checkbox';
  input.id = id;
  input.setAttribute('role', 'switch');
  input.checked = isChecked;
  const text = el('span', 'toggle-text', title);
  text.append(el('small', '', hint));
  const track = el('span', 'toggle-track');
  track.setAttribute('aria-hidden', 'true');
  label.append(input, track, text);
  return label;
}

/**
 * invoke(command, args) talks to the backend; isPinned(name) says which repositories are already
 * on the map; onFinish({ bases, isLimitsOn, isSoundOn, isSkipped }) applies the choices to the map.
 */
export function createOnboarding({ invoke, isPinned, isSoundOn, showToast, onFinish }) {
  const backdrop = el('div', 'settings-backdrop');
  const dialog = el('section', 'modal onboarding');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'onboarding-title');
  backdrop.hidden = true;
  dialog.hidden = true;

  const head = el('header', 'settings-head');
  const title = el('h2', '', 'Fundar o império');
  title.id = 'onboarding-title';
  const stepLabel = el('span', 'onboarding-step');
  head.append(title, stepLabel);
  const body = el('div', 'modal-body');
  const footer = el('footer', 'modal-actions');
  const skipButton = el('button', 'btn btn-ghost', 'Pular introdução');
  const backButton = el('button', 'btn', 'Voltar');
  const nextButton = el('button', 'btn btn-primary', 'Continuar');
  for (const button of [skipButton, backButton, nextButton]) button.type = 'button';
  footer.append(skipButton, backButton, nextButton);
  dialog.append(head, body, footer);
  document.body.append(backdrop, dialog);

  let step = 0;
  let setup = null;
  let projects = [];
  let chosenBases = new Set();
  let rootPath = '';
  let rootInput = null;
  let rootMessage = null;
  let isFirstRun = true; // first run suggests the integrations on; a later visit shows what is on
  let isEmptyRootAccepted = false;
  let isBusy = false;

  function close() {
    dialog.hidden = true;
    backdrop.hidden = true;
  }

  function setBusy(busy) {
    isBusy = busy;
    for (const button of [skipButton, backButton, nextButton]) button.disabled = busy;
  }

  function renderWelcome() {
    body.append(el('p', 'onboarding-lead', 'Cada sessão do Claude Code nesta máquina vira um aldeão, e cada repositório, uma base no mapa. Antes de fundar o império, um reconhecimento do terreno:'));
    body.append(setup ? renderChecks(setup) : el('p', 'modal-note', 'Conferindo o que esta máquina tem…'));
    body.append(el('p', 'modal-note', 'Tudo é lido localmente, dos arquivos do Claude Code e do git. Nada sai daqui sem você ligar no último passo.'));
  }

  function renderRoot() {
    body.append(el('p', 'onboarding-lead', 'Onde ficam seus repositórios? O app procura repositórios git nesta pasta e um nível abaixo dela, para pastas que agrupam vários. Dela saem as bases, a busca do "+ Agente" e a névoa de guerra.'));
    const label = el('label', 'field-label', 'Pasta dos repositórios');
    label.htmlFor = 'onboarding-root';
    rootInput = el('input', 'field');
    rootInput.id = 'onboarding-root';
    rootInput.type = 'text';
    rootInput.spellcheck = false;
    rootInput.value = rootPath || setup?.suggestedRoot || setup?.projectsRoot || '~/Code';
    rootInput.addEventListener('input', () => {
      rootPath = rootInput.value;
      isEmptyRootAccepted = false;
      rootMessage.textContent = '';
    });
    rootInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') next();
    });
    body.append(label, rootInput);
    if (setup?.suggestedRoot && setup.suggestedRoot !== setup.projectsRoot) {
      body.append(el('p', 'modal-note', 'Sugestão tirada de onde suas sessões do Claude Code rodaram.'));
    }
    rootMessage = el('p', 'modal-note onboarding-message');
    rootMessage.setAttribute('aria-live', 'polite');
    body.append(rootMessage);
    rootInput.focus();
  }

  function projectHint(project, now) {
    if (isPinned(project.name)) return 'já está no mapa';
    if (project.lastClaudeAt) return `Claude ${ago(project.lastClaudeAt, now)}`;
    if (project.lastGitAt) return `git ${ago(project.lastGitAt, now)}`;
    return 'sem atividade recente';
  }

  function renderBases() {
    body.append(el('p', 'onboarding-lead', 'Funde suas primeiras bases. Base fixa fica no mapa mesmo sem agentes; marcamos os repositórios em que o Claude trabalhou por último. Depois, Construir (tecla B) funda outras.'));
    if (!projects.length) {
      body.append(el('p', 'modal-note', 'Nenhum repositório nessa pasta. Volte e escolha outra, ou siga: as bases aparecem quando um agente trabalhar num repositório.'));
      return;
    }
    const list = el('ul', 'onboarding-bases');
    const now = Date.now();
    for (const project of projects.slice(0, BASE_CHOICES)) {
      const item = el('li');
      const label = el('label', 'onboarding-base');
      const input = el('input');
      input.type = 'checkbox';
      input.checked = chosenBases.has(project.path) || isPinned(project.name);
      input.disabled = isPinned(project.name);
      input.addEventListener('change', () => {
        if (input.checked) chosenBases.add(project.path);
        else chosenBases.delete(project.path);
      });
      const text = el('span', 'toggle-text', project.name);
      text.append(el('small', '', `${project.parent} · ${projectHint(project, now)}`));
      label.append(input, text);
      item.append(label);
      list.append(item);
    }
    body.append(list);
  }

  function renderIntegrations() {
    body.append(el('p', 'onboarding-lead', 'Integrações opcionais. Cada uma diz o que mexe nesta máquina; todas mudam depois nas Configurações ou na bandeja.'));
    const settingsPath = setup?.settingsPath ?? '~/.claude/settings.json';
    const hook = toggleRow('onboarding-hook', 'Aprovar pelo painel', `Pedidos de permissão do Claude Code aparecem aqui, com Aprovar e Negar. Instala um hook PermissionRequest em ${settingsPath} (o arquivo anterior fica salvo ao lado, com final .agent-of-empires.bak). Sem resposta em 60 s, ou com o app fechado, aparece o diálogo normal. Vale para as sessões abertas depois.`, isFirstRun || Boolean(setup?.isHookInstalled));
    const preview = el('details', 'onboarding-preview');
    preview.append(el('summary', '', 'Ver o que entra no settings.json'), el('pre', '', setup?.hookPreview ?? ''));
    const limits = toggleRow('onboarding-limits', 'Limites do plano', 'Uso da sessão (5 h) e da semana. Lê o token do Claude Code, sem alterar, e consulta api.anthropic.com a cada 1 min, como o /usage faz. Avisa quando passar de 90%. É a única chamada de rede do app.', isFirstRun || Boolean(setup?.isUsageOn));
    const autostart = toggleRow('onboarding-autostart', 'Abrir ao iniciar a sessão', 'O app abre sozinho ao ligar o computador. Fechar a janela só esconde na bandeja.', Boolean(setup?.isAutostartOn));
    const sound = toggleRow('onboarding-sound', 'Som quando um Claude para', 'Fanfarra curta no fim do turno, bipe duplo quando precisa de você.', isSoundOn());
    body.append(hook, preview, limits, autostart, sound);
  }

  function render() {
    body.replaceChildren();
    stepLabel.textContent = `${step + 1} de ${STEPS.length} · ${STEPS[step]}`;
    [renderWelcome, renderRoot, renderBases, renderIntegrations][step]();
    backButton.hidden = step === 0;
    nextButton.textContent = step === STEPS.length - 1 ? 'Fundar o império' : 'Continuar';
    nextButton.disabled = isBusy || (step === 0 && !setup);
  }

  async function saveRoot() {
    const path = rootInput.value.trim();
    setBusy(true);
    try {
      const count = await invoke('set_projects_root', { path });
      if (count === 0 && !isEmptyRootAccepted) {
        isEmptyRootAccepted = true;
        rootMessage.textContent = 'Nenhum repositório git nessa pasta. Corrija o caminho ou clique de novo para seguir assim.';
        return false;
      }
      projects = await invoke('list_projects');
      const recent = projects.filter((project) => project.lastClaudeAt && !isPinned(project.name));
      chosenBases = new Set(recent.slice(0, PRESELECTED_BASES).map((project) => project.path));
      return true;
    } catch (err) {
      rootMessage.textContent = String(err);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function finish(isSkipped) {
    const isChecked = (id) => Boolean(document.getElementById(id)?.checked);
    const choices = isSkipped
      ? { isHookOn: setup?.isHookInstalled ?? false, isUsageOn: setup?.isUsageOn ?? false, isAutostartOn: setup?.isAutostartOn ?? false }
      : { isHookOn: isChecked('onboarding-hook'), isUsageOn: isChecked('onboarding-limits'), isAutostartOn: isChecked('onboarding-autostart') };
    setBusy(true);
    try {
      await invoke('finish_setup', { choices });
    } catch (err) {
      showToast(String(err), true);
    } finally {
      setBusy(false);
    }
    const bases = isSkipped ? [] : projects.filter((project) => chosenBases.has(project.path));
    close();
    onFinish({ bases, isSkipped, isLimitsOn: choices.isUsageOn, isSoundOn: isSkipped ? isSoundOn() : isChecked('onboarding-sound') });
  }

  async function next() {
    if (isBusy) return;
    if (step === 1 && !(await saveRoot())) return;
    if (step === STEPS.length - 1) {
      finish(false);
      return;
    }
    step += 1;
    render();
  }

  nextButton.addEventListener('click', next);
  backButton.addEventListener('click', () => {
    step = Math.max(0, step - 1);
    render();
  });
  skipButton.addEventListener('click', () => finish(true));
  backdrop.addEventListener('click', close);
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    close(); // not finished: it comes back on the next start
  });

  return {
    /** isFirst: the automatic opening on a machine that never finished it. */
    async open({ isFirst = false } = {}) {
      step = 0;
      setup = null;
      isFirstRun = isFirst;
      rootPath = '';
      isEmptyRootAccepted = false;
      render();
      dialog.hidden = false;
      backdrop.hidden = false;
      nextButton.focus();
      try {
        setup = await invoke('get_setup');
      } catch (err) {
        showToast(String(err), true);
        setup = {};
      }
      if (step === 0 && !dialog.hidden) render();
      nextButton.focus();
    },
  };
}
