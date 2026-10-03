// Floating action menu shared by the panel cards, the desk labels and right-click on the map.
// Items: { label, icon?, hint?, onSelect, disabled?, isDanger?, confirmLabel? }; { section } heads a
// group, { divider: true } is a plain rule; { label, icon?, hint?, submenu: { title, items } } opens
// another list in place (‹ Voltar or ← returns); submenu can also be an async () => { title, items },
// read when opened ("Lendo…" meanwhile); { label, swatch?, hint? } with a color draws a team square;
// { field: { label, value, placeholder, maxLength, hint, submitLabel?, onSubmit } } is a text box.
// An action (an item with an icon) keeps its label short: its hint shows in the footer for the item
// under the pointer or focus. A list entry (no icon: an agent, a base) keeps its hint under the name,
// as the status of what it names.
const CONFIRM_WINDOW_MS = 4000;

// Line icons (24 x 24, stroke currentColor), drawn after the Lucide set.
const ICONS = {
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  play: '<path d="m6 3 14 9-14 9V3z"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  megaphone: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/>',
  'user-plus': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6"/><path d="M22 11h-6"/>',
  'user-x': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m17 8 5 5"/><path d="m22 8-5 5"/>',
  'map-pin': '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  brush: '<path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/>',
  rotate: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  move: '<path d="m5 9-3 3 3 3"/><path d="m9 5 3-3 3 3"/><path d="m15 19-3 3-3-3"/><path d="m19 9 3 3-3 3"/><path d="M2 12h20"/><path d="M12 2v20"/>',
  'square-plus': '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M8 12h8"/><path d="M12 8v8"/>',
  pin: '<path d="M12 17v5"/><path d="M5 17h14v-1.8a2 2 0 0 0-1.1-1.8l-1.8-.9A2 2 0 0 1 15 10.8V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2Z"/>',
  'pin-off': '<path d="M12 17v5"/><path d="M15 9.3V6h1a2 2 0 0 0 0-4H7.9"/><path d="m2 2 20 20"/><path d="M9 9v1.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2V17h12"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  'eye-off': '<path d="M9.9 9.9a3 3 0 1 0 4.2 4.2"/><path d="M10.7 5.1A10.4 10.4 0 0 1 12 5c7 0 10 7 10 7a13.2 13.2 0 0 1-1.7 2.7"/><path d="M6.6 6.6A13.5 13.5 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="m2 2 20 20"/>',
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  terminal: '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function icon(name, className = 'menu-icon') {
  const node = el('span', className);
  node.setAttribute('aria-hidden', 'true');
  // Fixed markup from ICONS only, never text from the page.
  node.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] ?? ''}</svg>`;
  return node;
}

function isUsable(node) {
  return node.getAttribute('aria-disabled') !== 'true';
}

export function createActionMenu() {
  const menu = document.getElementById('action-menu');
  const footer = el('p', 'menu-hint');
  footer.setAttribute('aria-live', 'polite');
  let trigger = null;
  let confirmTimer = null;
  let anchorAt = null;
  let levels = []; // [{ title, items }]: the root list, then each submenu opened from it

  function close({ restoreFocus = true } = {}) {
    if (menu.hidden) return;
    menu.hidden = true;
    clearTimeout(confirmTimer);
    levels = [];
    trigger?.setAttribute?.('aria-expanded', 'false');
    if (restoreFocus) trigger?.focus?.();
    trigger = null;
  }

  function showHint(text) {
    footer.textContent = text ?? '';
  }

  // An action's hint goes to the footer on hover and focus; a list entry's stays under its name.
  function button(className, item) {
    const node = el('button', className);
    node.type = 'button';
    node.setAttribute('role', 'menuitem');
    if (item.icon) node.append(icon(item.icon));
    else if (item.swatch) {
      const swatch = el('span', 'menu-swatch');
      swatch.style.setProperty('--swatch', item.swatch);
      swatch.setAttribute('aria-hidden', 'true');
      node.append(swatch);
    }
    const text = el('span', 'menu-text');
    const title = el('strong', null, item.label);
    text.append(title);
    if (item.hint && !item.icon) text.append(el('small', null, item.hint));
    node.append(text);
    if (item.icon) {
      for (const type of ['pointerenter', 'focus']) node.addEventListener(type, () => showHint(item.hint));
    }
    return { node, title };
  }

  // Destructive items ask twice: the first click only arms them, for a few seconds. A disabled item
  // stays hoverable (aria-disabled), so its hint can say why.
  function renderItem(item) {
    if (item.section) return el('p', 'menu-section', item.section);
    if (item.divider) return el('hr', 'menu-divider');
    if (item.field) return renderField(item.field);
    const { node, title } = button(`menu-item${item.isDanger ? ' is-danger' : ''}${item.submenu ? ' has-submenu' : ''}`, item);
    if (item.disabled) node.setAttribute('aria-disabled', 'true');
    if (item.submenu) {
      node.setAttribute('aria-haspopup', 'menu');
      node.append(icon('chevron', 'menu-chevron'));
    }
    node.addEventListener('click', () => {
      if (item.disabled) return;
      if (item.submenu) {
        if (typeof item.submenu === 'function') pushLoaded(item.label, item.submenu);
        else push(item.submenu);
        return;
      }
      if (item.confirmLabel && !node.classList.contains('is-confirming')) {
        node.classList.add('is-confirming');
        title.textContent = item.confirmLabel;
        clearTimeout(confirmTimer);
        confirmTimer = setTimeout(() => {
          node.classList.remove('is-confirming');
          title.textContent = item.label;
        }, CONFIRM_WINDOW_MS);
        return;
      }
      close();
      item.onSelect();
    });
    return node;
  }

  function renderField({ label, value = '', placeholder = '', maxLength, hint, submitLabel = 'Salvar', onSubmit }) {
    const form = el('form', 'menu-field');
    form.autocomplete = 'off';
    const input = el('input', 'field');
    input.type = 'text';
    input.value = value;
    input.placeholder = placeholder;
    input.spellcheck = false;
    input.setAttribute('aria-label', label);
    if (maxLength) input.maxLength = maxLength;
    const save = el('button', 'btn btn-primary', submitLabel);
    save.type = 'submit';
    const row = el('div', 'menu-field-row');
    row.append(input, save);
    form.append(row);
    if (hint) form.append(el('small', null, hint));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      close();
      onSubmit(input.value);
    });
    return form;
  }

  function render() {
    const { title, items } = levels.at(-1);
    const nodes = [el('p', 'menu-title', title)];
    if (levels.length > 1) {
      const { node } = button('menu-item menu-back', { label: 'Voltar', icon: 'back' });
      node.addEventListener('click', pop);
      nodes.push(node);
    }
    nodes.push(...items.map(renderItem));
    showHint('');
    // the footer only where some action has a hint to show, so plain lists stay as they were
    if (items.some((item) => item.icon && item.hint)) nodes.push(footer);
    menu.replaceChildren(...nodes);
    menu.scrollTop = 0;
    position(anchorAt);
    const field = menu.querySelector('.menu-field input');
    if (field) {
      field.focus();
      field.select();
    } else {
      [...menu.querySelectorAll('.menu-item:not(.menu-back)')].find(isUsable)?.focus();
    }
  }

  function push(level) {
    levels.push(level);
    render();
  }

  // The list replaces "Lendo…" only if the user is still there (not gone back or closed).
  async function pushLoaded(title, load) {
    const pending = { title, items: [{ label: 'Lendo…', disabled: true }] };
    push(pending);
    const level = await load();
    const at = levels.indexOf(pending);
    if (at === -1) return;
    levels[at] = level;
    if (at === levels.length - 1) render();
  }

  function pop() {
    if (levels.length < 2) return;
    levels.pop();
    render();
  }

  function position(anchor) {
    const rect = anchor instanceof Element ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
    const box = menu.getBoundingClientRect();
    const left = Math.min(Math.max(8, rect.right - box.width), window.innerWidth - box.width - 8);
    const below = rect.bottom + 4;
    const top = below + box.height > window.innerHeight - 8 ? Math.max(8, rect.top - box.height - 4) : below;
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  function open(anchor, title, items, opener = null) {
    close({ restoreFocus: false });
    trigger = opener;
    trigger?.setAttribute?.('aria-expanded', 'true');
    anchorAt = anchor;
    levels = [{ title, items }];
    menu.hidden = false;
    render();
  }

  menu.addEventListener('keydown', (event) => {
    const isTyping = event.target.tagName === 'INPUT';
    const items = [...menu.querySelectorAll('.menu-item')].filter(isUsable);
    const index = items.indexOf(document.activeElement);
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (levels.length > 1) pop();
      else close();
    } else if (isTyping) {
      return; // arrows move the caret in the rename box
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
    } else if (event.key === 'ArrowRight' && document.activeElement?.classList.contains('has-submenu')) {
      event.preventDefault();
      document.activeElement.click();
    } else if (event.key === 'ArrowLeft' && levels.length > 1) {
      event.preventDefault();
      pop();
    } else if (event.key === 'Tab') {
      close({ restoreFocus: false });
    }
  });
  menu.addEventListener('pointerleave', () => showHint(document.activeElement?.closest?.('.menu-item') ? footer.textContent : ''));
  document.addEventListener('pointerdown', (event) => {
    if (!menu.hidden && !menu.contains(event.target) && event.target !== trigger) close({ restoreFocus: false });
  });
  window.addEventListener('blur', () => close({ restoreFocus: false }));

  return { open, close };
}
