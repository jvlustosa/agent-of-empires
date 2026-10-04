// "Visão do império": every repository of ~/Code as the empire sees it. The explored ones are bases
// with their resources from the last 7 days (all real data: git and agent hours); the others wait
// under the fog of war until an agent explores them.
import { ERAS, TOWN_STYLES, drawGrass, drawTownCenter } from './sprites.js';

const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat('pt-BR');
const monthYear = new Intl.DateTimeFormat('pt-BR', { month: 'short', year: 'numeric' });

// What each AoE resource counts in the empire.
export const RESOURCES = [
  { id: 'gold', name: 'Ouro', hint: 'commits nos últimos 7 dias' },
  { id: 'wood', name: 'Madeira', hint: 'linhas adicionadas nos últimos 7 dias' },
  { id: 'food', name: 'Comida', hint: 'horas de agente nos últimos 7 dias' },
  { id: 'stone', name: 'Pedra', hint: 'arquivos rastreados pelo git' },
  { id: 'tokens', name: 'Tokens', hint: 'tokens de agente nos últimos 7 dias (entrada, saída e escrita de cache; leitura de cache fica de fora)' },
];

// 9 x 9 pixel icons, drawn like the rest of the map.
const ICONS = {
  gold: '<rect x="1" y="5" width="7" height="3" fill="#c99a2e"/><rect x="2" y="3" width="5" height="2" fill="#f2c84b"/><rect x="3" y="1" width="3" height="2" fill="#fff3b0"/><rect x="0" y="8" width="9" height="1" fill="#8a6a1e"/>',
  wood: '<rect x="0" y="1" width="9" height="3" fill="#8a5a32"/><rect x="0" y="5" width="9" height="3" fill="#5e3c20"/><rect x="7" y="1" width="2" height="3" fill="#d6a76b"/><rect x="7" y="5" width="2" height="3" fill="#a8773f"/>',
  food: '<rect x="1" y="3" width="3" height="3" fill="#dc2626"/><rect x="5" y="4" width="3" height="3" fill="#b91c1c"/><rect x="3" y="6" width="3" height="3" fill="#ef4444"/><rect x="4" y="0" width="1" height="3" fill="#3f8a40"/><rect x="5" y="1" width="2" height="1" fill="#3f8a40"/>',
  tokens: '<rect x="4" y="0" width="1" height="1" fill="#3b82f6"/><rect x="3" y="1" width="3" height="1" fill="#3b82f6"/><rect x="2" y="2" width="5" height="1" fill="#3b82f6"/><rect x="1" y="3" width="7" height="2" fill="#3b82f6"/><rect x="2" y="5" width="5" height="1" fill="#3b82f6"/><rect x="3" y="6" width="3" height="1" fill="#3b82f6"/><rect x="4" y="7" width="1" height="1" fill="#3b82f6"/><rect x="3" y="1" width="1" height="1" fill="#93c5fd"/><rect x="2" y="2" width="2" height="1" fill="#93c5fd"/><rect x="1" y="3" width="2" height="2" fill="#93c5fd"/><rect x="4" y="1" width="1" height="1" fill="#e0f2fe"/><rect x="5" y="5" width="2" height="1" fill="#1d4ed8"/><rect x="4" y="6" width="2" height="1" fill="#1d4ed8"/>',
  stone: '<rect x="1" y="3" width="7" height="5" fill="#8d8f96"/><rect x="2" y="2" width="4" height="1" fill="#b4b6bc"/><rect x="2" y="3" width="2" height="2" fill="#b4b6bc"/><rect x="6" y="5" width="2" height="3" fill="#65676e"/><rect x="0" y="8" width="9" height="1" fill="#4b4d53"/>',
  pop: '<rect x="2" y="0" width="5" height="1" fill="currentColor"/><rect x="1" y="1" width="7" height="1" fill="currentColor"/><rect x="3" y="2" width="3" height="2" fill="currentColor"/><rect x="2" y="4" width="5" height="3" fill="currentColor"/><rect x="2" y="7" width="2" height="2" fill="currentColor"/><rect x="5" y="7" width="2" height="2" fill="currentColor"/>',
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function resourceIcon(id) {
  const template = document.createElement('template');
  template.innerHTML = `<svg viewBox="0 0 9 9" width="14" height="14" aria-hidden="true" shape-rendering="crispEdges">${ICONS[id]}</svg>`;
  return template.content.firstElementChild;
}

export function resourcesOf(repo) {
  return { gold: repo.commitsWeek, wood: repo.linesAddedWeek, food: repo.agentMinutesWeek, stone: repo.trackedFiles ?? 0, tokens: repo.tokensWeek ?? 0 };
}

export function sumResources(repos) {
  const total = { gold: 0, wood: 0, food: 0, stone: 0, tokens: 0 };
  for (const repo of repos) for (const [id, value] of Object.entries(resourcesOf(repo))) total[id] += value;
  return total;
}

export function formatResource(id, value) {
  if (id === 'food') return value < 60 ? `${value} min` : `${whole.format(Math.round(value / 60))} h`;
  return value >= 10000 ? compact.format(value) : whole.format(value);
}

function eraName(id) {
  return ERAS.find((era) => era.id === id)?.name ?? '';
}

function styleName(id) {
  return TOWN_STYLES.find((style) => style.id === id)?.name ?? '';
}

/**
 * isInEmpire(name): explored, or standing on the map. hasBase(name): on the map right now.
 * onShowBase(name): close and light the base up; onPlaceBase(repo): put it on the map;
 * onExplore(name): send the first agent there.
 */
const dayMonth = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });
const dayTime = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

// The history's rows, each on its own scale over the same 30 days.
const HISTORY_ROWS = [
  { key: 'commits', resource: 'gold', label: 'Ouro · commits', color: '#f2c84b' },
  { key: 'tokens', resource: 'tokens', label: 'Tokens', color: '#3b82f6' },
];

function describeDays(when, { commits, tokens }) {
  return `${when}: ${whole.format(commits)} ${commits === 1 ? 'commit' : 'commits'} · ${formatResource('tokens', tokens)} tokens`;
}

// 30 days of the empire, one column per day: commits (gold) and tokens, each row with its peak on
// the right. Hovering a day reads its numbers under the chart; otherwise the line sums the 30 days.
function historyChart(days) {
  const width = 600;
  const labelH = 14;
  const barsH = 36;
  const rowH = labelH + barsH + 10;
  const step = width / Math.max(1, days.length);
  const height = rowH * HISTORY_ROWS.length + 6;
  const chart = svg('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'Commits e tokens por dia, últimos 30 dias' });
  const text = (x, y, anchor, content) => {
    const node = svg('text', { x, y, 'text-anchor': anchor });
    node.textContent = content;
    return node;
  };
  HISTORY_ROWS.forEach((row, r) => {
    const base = r * rowH + labelH + barsH;
    const peak = Math.max(1, ...days.map((day) => day[row.key]));
    chart.append(text(0, r * rowH + 10, 'start', row.label), text(width, r * rowH + 10, 'end', `pico ${formatResource(row.resource, peak)}/dia`));
    days.forEach((day, i) => {
      const barH = day[row.key] ? Math.max(1, Math.round((day[row.key] / peak) * barsH)) : 0;
      chart.append(svg('rect', { x: i * step, y: base - barH, width: step - 2, height: barH, fill: row.color, rx: 1 }));
    });
    chart.append(svg('line', { class: 'history-axis', x1: 0, x2: width, y1: base + 0.5, y2: base + 0.5 }));
  });
  if (days.length > 0) chart.append(text(0, height, 'start', dayMonth.format(days[0].dayStart)), text(width, height, 'end', 'hoje'));

  const readout = el('p', 'overview-history-readout');
  const sum = (key) => days.reduce((total, day) => total + day[key], 0);
  const showTotal = () => (readout.textContent = describeDays(`${days.length} dias`, { commits: sum('commits'), tokens: sum('tokens') }));
  days.forEach((day, i) => {
    const hit = svg('rect', { class: 'history-day', x: i * step - 1, y: 0, width: step, height: height - 12 });
    hit.addEventListener('pointerenter', () => (readout.textContent = describeDays(dayMonth.format(day.dayStart), day)));
    chart.append(hit);
  });
  chart.addEventListener('pointerleave', showTotal);
  showTotal();
  return [chart, readout];
}

/**
 * teamOf(name): [color, shade]; displayName(name): the nickname or the repo; wondersOf(name):
 * its wonder ids; getAchievements/getEvents/getUsage: the progression and the usage metrics.
 */
export function createOverview({ getStats, designOf, isInEmpire, hasBase, onShowBase, onPlaceBase, onExplore, teamOf, displayName, wondersOf, getAchievements, getEvents, getUsage, onOpen }) {
  const dialog = document.getElementById('overview');
  const backdrop = document.getElementById('overview-backdrop');
  const summary = document.getElementById('overview-summary');
  const totals = document.getElementById('overview-totals');
  const rows = document.getElementById('overview-bases');
  const fogNote = document.getElementById('overview-fog-note');
  const fogList = document.getElementById('overview-fog');
  const achievementsEl = document.getElementById('overview-achievements');
  const historyEl = document.getElementById('overview-history');
  const eventsEl = document.getElementById('overview-events');
  const usageEl = document.getElementById('overview-usage');
  let returnFocus = null;

  function emblem(repo) {
    const canvas = el('canvas', 'overview-emblem');
    canvas.width = 50;
    canvas.height = 56;
    canvas.setAttribute('aria-hidden', 'true');
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    drawGrass(ctx, 0, 0, 50, 56, 3);
    drawTownCenter(ctx, 5, 18, teamOf(repo.name), false, 1, designOf(repo.name), 0); // room above for the tallest forms
    return canvas;
  }

  function resourceCell(id, value) {
    const cell = el('td', 'overview-num');
    cell.append(resourceIcon(id), el('span', null, formatResource(id, value)));
    return cell;
  }

  function baseRow(repo) {
    const design = designOf(repo.name);
    const row = el('tr');
    const name = el('td', 'overview-base');
    const text = el('span', 'overview-base-text');
    const label = displayName(repo.name);
    const xp = design.xp === null ? '' : ` · ${design.xp.toLocaleString('pt-BR')} XP`;
    text.append(el('strong', null, label), el('small', null, `${label === repo.name ? '' : `${repo.name} · `}${eraName(design.era)} · ${styleName(design.style)}${xp}`));
    if (design.xp !== null) {
      // progress to the next era (full at the last one)
      const bar = el('span', 'overview-xp');
      const fill = el('span');
      const floor = [0, 25, 150, 600, 1500].at(design.suggestedEra - 1) ?? 0;
      fill.style.width = design.nextXp ? `${Math.min(100, ((design.xp - floor) / (design.nextXp - floor)) * 100)}%` : '100%';
      bar.title = design.nextXp ? `${design.xp} de ${design.nextXp} XP para a próxima era` : 'Era máxima';
      bar.append(fill);
      text.append(bar);
    }
    const wonders = wondersOf(repo.name);
    if (wonders.length > 0) text.append(el('small', 'overview-wonders', wonders.map((id) => (id === 'obelisk' ? 'Obelisco' : 'Farol')).join(' · ')));
    name.append(emblem(repo), text);
    row.append(name);
    for (const [id, value] of Object.entries(resourcesOf(repo))) row.append(resourceCell(id, value));
    row.append(el('td', 'overview-founded', repo.foundedAt ? monthYear.format(repo.foundedAt) : '·'));
    const action = el('button', 'link-button', hasBase(repo.name) ? 'Ver no mapa' : 'Pôr no mapa');
    action.type = 'button';
    action.addEventListener('click', () => {
      close();
      if (hasBase(repo.name)) onShowBase(repo.name);
      else onPlaceBase(repo);
    });
    const actionCell = el('td');
    actionCell.append(action);
    row.append(actionCell);
    return row;
  }

  function render() {
    const stats = getStats();
    if (!stats) {
      summary.textContent = 'Contando o império (git e horas de agente)…';
      totals.replaceChildren();
      rows.replaceChildren();
      fogList.replaceChildren();
      fogNote.textContent = '';
      return;
    }
    const empire = stats.repos.filter((repo) => isInEmpire(repo.name));
    const fog = stats.repos.filter((repo) => !isInEmpire(repo.name));
    empire.sort((a, b) => b.commitsWeek - a.commitsWeek || b.agentMinutesWeek - a.agentMinutesWeek || a.name.localeCompare(b.name));
    const eras = empire.map((repo) => designOf(repo.name).era);
    const topEra = eras.length ? Math.round(eras.reduce((sum, era) => sum + era, 0) / eras.length) : null;
    summary.textContent = [
      `${empire.length} ${empire.length === 1 ? 'base' : 'bases'} no império`,
      `${fog.length} ${fog.length === 1 ? 'terra' : 'terras'} sob a névoa`,
      topEra ? `era média: ${eraName(topEra)}` : null,
    ].filter(Boolean).join(' · ');
    const sum = sumResources(empire);
    totals.replaceChildren(
      ...RESOURCES.map((resource) => {
        const item = el('span', 'overview-total');
        item.title = `${resource.name}: ${resource.hint}`;
        item.append(resourceIcon(resource.id), el('strong', null, formatResource(resource.id, sum[resource.id])), el('small', null, resource.name));
        return item;
      }),
    );
    rows.replaceChildren(...empire.map(baseRow));
    renderProgress(stats);
    fogNote.textContent = fog.length
      ? 'Repositórios de ~/Code onde nenhum agente trabalhou ainda. Explorar coloca o primeiro agente lá, e a base sai da névoa.'
      : 'Nenhuma terra sob a névoa: todo repositório de ~/Code já foi explorado.';
    fogList.replaceChildren(
      ...fog.map((repo) => {
        const chip = el('button', 'overview-fog-chip');
        chip.type = 'button';
        chip.title = `Explorar ${repo.name}: escolher a tarefa do primeiro agente`;
        chip.append(el('strong', null, repo.name), el('small', null, `${formatResource('stone', repo.trackedFiles ?? 0)} arquivos`));
        chip.addEventListener('click', () => {
          close();
          onExplore(repo.name);
        });
        return chip;
      }),
    );
  }

  function renderProgress(stats) {
    const achievements = getAchievements();
    const unlocked = achievements.filter((a) => a.at);
    document.getElementById('overview-achievements-count').textContent = `${unlocked.length} de ${achievements.length}`;
    achievementsEl.replaceChildren(
      ...[...unlocked, ...achievements.filter((a) => !a.at)].map((achievement) => {
        const badge = el('div', `achievement${achievement.at ? ' is-unlocked' : ''}`);
        badge.append(el('strong', null, achievement.name), el('span', null, achievement.hint));
        if (achievement.at) badge.append(el('small', null, `desde ${dayMonth.format(achievement.at)}`));
        return badge;
      }),
    );
    historyEl.replaceChildren(...historyChart(stats.days ?? []));
    const events = getEvents().slice(0, 12);
    eventsEl.replaceChildren(
      ...(events.length
        ? events.map((event) => {
            const item = el('li');
            const time = el('time', null, dayTime.format(event.at));
            time.dateTime = new Date(event.at).toISOString();
            item.append(time, el('span', null, event.text));
            return item;
          })
        : [el('li', null, 'Nada ainda: bases fundadas, eras e maravilhas aparecem aqui.')]),
    );
    const usage = getUsage();
    const wait = usage.medianWaitSeconds === null ? 'nenhuma aprovação respondida pelo painel' : `aprovações respondidas em ${usage.medianWaitSeconds} s (mediana)`;
    usageEl.textContent = `Seu uso (7 dias): Visão do império aberta ${usage.opensWeek} ${usage.opensWeek === 1 ? 'vez' : 'vezes'} · ${wait} · ${usage.forgottenWeek} ${usage.forgottenWeek === 1 ? 'sessão esquecida' : 'sessões esquecidas'} (sua vez por mais de 30 min). Fica só nesta máquina.`;
  }

  function open({ section = null } = {}) {
    onOpen?.();
    returnFocus = document.activeElement;
    render();
    dialog.hidden = false;
    backdrop.hidden = false;
    document.getElementById('overview-close').focus();
    if (section === 'fog') document.getElementById('overview-fog-title').scrollIntoView({ block: 'start' });
  }

  function close() {
    dialog.hidden = true;
    backdrop.hidden = true;
    returnFocus?.focus?.();
  }

  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    close();
  });
  document.getElementById('overview-close').addEventListener('click', close);
  backdrop.addEventListener('click', close);

  return { open, close, render, isOpen: () => !dialog.hidden };
}
