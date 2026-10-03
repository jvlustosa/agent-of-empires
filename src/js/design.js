// "Personalizar base": the era a repository's town center stands in (how robust it looks, at
// first suggested by the repository's size), its size and turn in the 3D view (at first from the
// repository's size and age) and its style, one of the cities of Ragnarok Online.
import { DEFAULT_TOWN, ERAS, SIZES, TEAM_COLORS, TOWN_STYLES, drawGrass, drawTownCenter, teamColor, teamShade } from './sprites.js';

const PREVIEW_FPS = 10;
const AUTO_ERA = 'auto';
const AUTO_SIZE = 'auto';
const ROTATIONS = [0, 1, 2, 3]; // quarter turns

function formatAge(days) {
  if (days < 30) return `${days} ${days === 1 ? 'dia' : 'dias'}`;
  const months = Math.floor(days / 30.4);
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const yearText = years ? `${years} ${years === 1 ? 'ano' : 'anos'}` : '';
  const monthText = rest ? `${rest} ${rest === 1 ? 'mês' : 'meses'}` : '';
  return [yearText, monthText].filter(Boolean).join(' e ');
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function radio(name, value, isChecked) {
  const input = el('input', 'sr-only');
  input.type = 'radio';
  input.name = name;
  input.value = value;
  input.checked = isChecked;
  return input;
}

function eraName(id) {
  return ERAS.find((era) => era.id === id)?.name ?? '';
}

function sizeName(id) {
  return SIZES.find((size) => size.id === id)?.name ?? '';
}

// getPreview3d: the 3D map when it is on screen (it draws the castle as the map will), else null.
export function createDesignDialog({ getDesign, onSave, getPreview3d = () => null }) {
  const dialog = document.getElementById('design');
  const backdrop = document.getElementById('design-backdrop');
  const title = document.getElementById('design-title');
  const preview = document.getElementById('design-preview');
  const preview3d = document.getElementById('design-preview-3d');
  const sizeList = document.getElementById('design-sizes');
  const sizeNote = document.getElementById('design-size-note');
  const rotationList = document.getElementById('design-rotations');
  const caption = document.getElementById('design-caption');
  const eraList = document.getElementById('design-eras');
  const eraNote = document.getElementById('design-era-note');
  const styleList = document.getElementById('design-styles');
  const styleNote = document.getElementById('design-style-note');
  const colorList = document.getElementById('design-colors');
  const nicknameInput = document.getElementById('design-nickname');

  let project = null;
  let team = null; // [color, shade] of the repository being customized
  let autoTeam = null; // the color its name hashes to
  let suggestedEra = DEFAULT_TOWN.era;
  let suggestedSize = DEFAULT_TOWN.size;
  let returnFocus = null;
  let timer = null;

  function chosenEra() {
    const value = dialog.querySelector('input[name="design-era"]:checked')?.value;
    return value && value !== AUTO_ERA ? Number(value) : null;
  }

  function chosenSize() {
    const value = dialog.querySelector('input[name="design-size"]:checked')?.value;
    return value && value !== AUTO_SIZE ? Number(value) : null;
  }

  function chosenRotation() {
    return Number(dialog.querySelector('input[name="design-rotation"]:checked')?.value ?? 0);
  }

  function chosenColor() {
    const value = dialog.querySelector('input[name="design-color"]:checked')?.value;
    return value && value !== 'auto' ? Number(value) : null;
  }

  function chosenStyle() {
    return dialog.querySelector('input[name="design-style"]:checked')?.value ?? DEFAULT_TOWN.style;
  }

  function chosenDesign() {
    return { era: chosenEra() ?? suggestedEra, size: chosenSize() ?? suggestedSize, rotation: chosenRotation(), style: chosenStyle() };
  }

  // The 40 x 36 town center box sits centered at the bottom, with room above for spires.
  function drawTown(canvas, design, t) {
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    drawGrass(ctx, 0, 0, canvas.width, canvas.height, 7);
    drawTownCenter(ctx, Math.round((canvas.width - 40) / 2), canvas.height - 40, team, false, 1, design, t);
  }

  // In 3D the preview is the castle itself (size and turn show); elsewhere, the pixel-art town center.
  function renderPreview() {
    const world3d = getPreview3d();
    preview.hidden = Boolean(world3d);
    preview3d.hidden = !world3d;
    if (world3d) world3d.renderPreview(preview3d, chosenDesign(), team, performance.now() / 1000);
    else drawTown(preview, chosenDesign(), performance.now() / 1000);
  }

  function renderNotes() {
    const color = chosenColor();
    team = color === null ? autoTeam : TEAM_COLORS[color];
    const design = chosenDesign();
    const style = TOWN_STYLES.find((s) => s.id === design.style);
    caption.textContent = `${eraName(design.era)} · ${sizeName(design.size)} · ${style.name}`;
    styleNote.textContent = style.hint;
    for (const canvas of styleList.querySelectorAll('canvas')) drawTown(canvas, { era: design.era, style: canvas.dataset.style }, 0);
  }

  function renderEras(design) {
    const sizeText = Number.isFinite(design.files) ? `${design.files.toLocaleString('pt-BR')} arquivos no git` : 'tamanho desconhecido';
    const source = design.xp === null ? 'Pelo tamanho' : 'Pelo trabalho';
    const options = [{ value: AUTO_ERA, label: `${source} (${eraName(design.suggestedEra)})` }, ...ERAS.map((era) => ({ value: String(era.id), label: era.name, hint: era.hint }))];
    const chosen = design.isEraAuto ? AUTO_ERA : String(design.era);
    eraList.replaceChildren(
      el('legend', 'field-label', 'Porte'),
      ...options.map((option) => {
        const pill = el('label', 'design-pill');
        if (option.hint) pill.title = option.hint;
        pill.append(radio('design-era', option.value, option.value === chosen), el('span', null, option.label));
        return pill;
      }),
    );
    if (design.xp === null) {
      eraNote.textContent = `Até contar o trabalho, o porte vem do tamanho (${sizeText}): ${eraName(design.suggestedEra)}.`;
      return;
    }
    const next = design.nextXp ? ` Próxima era com ${design.nextXp.toLocaleString('pt-BR')} XP.` : ' Era máxima.';
    eraNote.textContent = `Ganha pelo trabalho: ${design.commits.toLocaleString('pt-BR')} commits + ${design.hours} h de agente × 5 = ${design.xp.toLocaleString('pt-BR')} XP.${next} A era ganha nunca volta.`;
  }

  function pills(list, legend, name, options, chosen) {
    list.replaceChildren(
      el('legend', 'field-label', legend),
      ...options.map((option) => {
        const pill = el('label', 'design-pill');
        if (option.hint) pill.title = option.hint;
        pill.append(radio(name, option.value, option.value === chosen), el('span', null, option.label));
        return pill;
      }),
    );
  }

  function renderSizes(design) {
    const options = [{ value: AUTO_SIZE, label: `Pelo repositório (${sizeName(design.suggestedSize)})` }, ...SIZES.map((size) => ({ value: String(size.id), label: size.name, hint: size.hint }))];
    pills(sizeList, 'Tamanho do castelo', 'design-size', options, design.isSizeAuto ? AUTO_SIZE : String(design.size));
    const facts = [
      Number.isFinite(design.files) ? `${design.files.toLocaleString('pt-BR')} arquivos no git` : null,
      Number.isFinite(design.ageDays) ? `${formatAge(design.ageDays)} desde o primeiro commit` : null,
    ].filter(Boolean);
    const basis = facts.length > 0 ? `Pelo tamanho e pela idade (${facts.join(', ')}): ${sizeName(design.suggestedSize)}.` : `Sem contagem do repositório ainda: ${sizeName(design.suggestedSize)}.`;
    sizeNote.textContent = `${basis} Tamanho e giro aparecem na vista 3D.`;
    const turns = ROTATIONS.map((turn) => ({ value: String(turn), label: `${turn * 90}°`, hint: turn === 0 ? 'Porta de frente para o pátio' : `Um giro de ${turn * 90}°` }));
    pills(rotationList, 'Giro (3D)', 'design-rotation', turns, String(design.rotation ?? 0));
  }

  function renderColors(design) {
    const swatch = (value, color, label) => {
      const item = el('label', `design-swatch${value === 'auto' ? ' is-auto' : ''}`);
      item.title = value === 'auto' ? 'A cor que o nome do repositório sorteia' : 'Cor do time';
      if (color) item.style.setProperty('--swatch', color);
      item.append(radio('design-color', value, (design.color === null ? 'auto' : String(design.color)) === value), el('span', null, label));
      return item;
    };
    colorList.replaceChildren(
      el('legend', 'field-label', 'Cor do time'),
      swatch('auto', null, 'Automática'),
      ...TEAM_COLORS.map(([color], index) => swatch(String(index), color, '')),
    );
  }

  function renderStyles(design) {
    styleList.replaceChildren(
      el('legend', 'field-label', 'Estilo · cidades de Ragnarok'),
      ...TOWN_STYLES.map((style) => {
        const card = el('label', 'design-style');
        card.title = style.hint;
        const canvas = el('canvas');
        canvas.width = 50;
        canvas.height = 56;
        canvas.dataset.style = style.id;
        canvas.setAttribute('aria-hidden', 'true');
        card.append(radio('design-style', style.id, style.id === design.style), canvas, el('span', null, style.name));
        return card;
      }),
    );
  }

  function open(name, design) {
    project = name;
    autoTeam = [teamColor(name), teamShade(name)];
    team = design.color === null ? autoTeam : TEAM_COLORS[design.color];
    suggestedEra = design.suggestedEra;
    suggestedSize = design.suggestedSize;
    title.textContent = `Personalizar ${name}`;
    nicknameInput.value = design.nickname;
    renderEras(design);
    renderSizes(design);
    renderColors(design);
    renderStyles(design);
    renderNotes();
    renderPreview();
    returnFocus = document.activeElement;
    dialog.hidden = false;
    backdrop.hidden = false;
    clearInterval(timer);
    timer = setInterval(renderPreview, 1000 / PREVIEW_FPS); // flags flap, Geffen's crystal glows
    dialog.querySelector('input[name="design-era"]:checked')?.focus();
  }

  function close() {
    clearInterval(timer);
    timer = null;
    dialog.hidden = true;
    backdrop.hidden = true;
    returnFocus?.focus?.();
  }

  function save() {
    onSave(project, { era: chosenEra(), size: chosenSize(), rotation: chosenRotation(), style: chosenStyle(), color: chosenColor(), nickname: nicknameInput.value });
    close();
  }

  dialog.addEventListener('change', () => {
    renderNotes();
    renderPreview();
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    } else if (event.key === 'Enter' && event.target.matches('input[type="radio"], #design-nickname')) {
      event.preventDefault();
      save();
    }
  });
  document.getElementById('design-save').addEventListener('click', save);
  document.getElementById('design-cancel').addEventListener('click', close);
  document.getElementById('design-close').addEventListener('click', close);
  backdrop.addEventListener('click', close);

  return { open: (name) => open(name, getDesign(name)), isOpen: () => !dialog.hidden };
}
