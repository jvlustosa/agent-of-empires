// The game bar at the bottom of the map: "Construir" (pick a repository, then click the map to
// found its base) and the summon button (a plain click puts a recruit in the square; dragged onto
// the ground it stands there, onto a base it opens that town center's card).

const DRAG_THRESHOLD_PX = 6;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Accent-insensitive, every word anywhere: "shop ui" finds my-shop-ui.
function matches(name, query) {
  const fold = (text) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return fold(query).split(/\s+/).filter(Boolean).every((word) => fold(name).includes(word));
}

// A search that starts like a path ("~/dotfiles", "/srv/app") names a repository outside ~/Code.
function isPath(query) {
  return /^(~|\/)/.test(query.trim());
}

/**
 * getRepos(): Promise<[{ name, path, detail, isOnMap }]>; addRepo(path): Promise<repo | null> adds one
 * from outside ~/Code; onBuild(repo): start placing its base.
 */
export function createBuildMenu({ getRepos, addRepo, onBuild }) {
  const menu = document.getElementById('build-menu');
  const opener = document.getElementById('build-open');
  const search = document.getElementById('build-search');
  const list = document.getElementById('build-list');
  let repos = [];
  let shown = [];
  let active = 0;

  function render() {
    const query = search.value.trim();
    shown = isPath(query)
      ? [{ name: `Adicionar ${query}`, path: query, detail: 'repositório fora de ~/Code', isNew: true }]
      : repos.filter((repo) => matches(repo.name, search.value)).slice(0, 60);
    active = Math.min(active, Math.max(0, shown.length - 1));
    list.replaceChildren(
      ...shown.map((repo, i) => {
        const item = el('li');
        const button = el('button', 'build-item');
        button.type = 'button';
        button.setAttribute('role', 'option');
        button.setAttribute('aria-selected', String(i === active));
        button.append(el('strong', null, repo.name), el('small', null, repo.isOnMap ? 'no mapa: mover' : repo.detail));
        button.addEventListener('click', () => pick(repo));
        item.append(button);
        return item;
      }),
    );
    if (shown.length === 0) list.append(el('li', 'build-empty', 'Nenhum repositório com esse nome em ~/Code. De fora? Escreva o caminho (~/pasta)'));
  }

  async function open() {
    menu.hidden = false;
    opener.setAttribute('aria-expanded', 'true');
    search.value = '';
    active = 0;
    search.focus();
    list.replaceChildren(el('li', 'build-empty', 'Lendo os repositórios…'));
    repos = await getRepos();
    render();
  }

  function close() {
    menu.hidden = true;
    opener.setAttribute('aria-expanded', 'false');
  }

  async function pick(repo) {
    const picked = repo.isNew ? await addRepo(repo.path) : repo;
    if (!picked) return; // addRepo said why
    close();
    onBuild(picked);
  }

  opener.addEventListener('click', () => (menu.hidden ? open() : close()));
  search.addEventListener('input', () => {
    active = 0;
    render();
  });
  search.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      active = (active + (event.key === 'ArrowDown' ? 1 : -1) + shown.length) % Math.max(1, shown.length);
      render();
    } else if (event.key === 'Enter' && shown[active]) {
      event.preventDefault();
      pick(shown[active]);
    }
  });
  menu.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    close();
    opener.focus();
  });
  document.addEventListener('pointerdown', (event) => {
    if (!menu.hidden && !menu.contains(event.target) && !opener.contains(event.target)) close();
  });

  return { open, close, isOpen: () => !menu.hidden };
}

/**
 * Summon tokens. preview(event) lights what is under the pointer; drop(event, mode) deploys there;
 * cancel() clears the preview; click(mode) is the keyboard and plain-click way.
 */
export function createSummon({ preview, drop, cancel, click }) {
  let drag = null; // { mode, token, pointerId, x, y, ghost, isDragging }

  function onMove(event) {
    if (!drag) return;
    if (!drag.isDragging && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < DRAG_THRESHOLD_PX) return;
    if (!drag.isDragging) {
      drag.isDragging = true;
      drag.ghost = drag.token.cloneNode(true);
      drag.ghost.className = 'summon-ghost';
      drag.ghost.querySelector('canvas')?.getContext('2d').drawImage(drag.token.querySelector('canvas'), 0, 0);
      document.body.append(drag.ghost);
    }
    drag.ghost.style.left = `${event.clientX}px`;
    drag.ghost.style.top = `${event.clientY}px`;
    preview(event);
  }

  // Every way a drag ends clears the dragged figure: a drop, a cancel (the webview starting a
  // drag of its own, a lost capture, the window losing focus). Only a drop deploys.
  function finish(event, isDrop) {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('blur', onCancel);
    const done = drag;
    drag = null;
    if (!done) return;
    done.ghost?.remove();
    if (done.token.hasPointerCapture?.(done.pointerId)) done.token.releasePointerCapture(done.pointerId);
    cancel();
    if (!isDrop) return;
    if (done.isDragging) drop(event, done.mode);
    else click(done.mode);
  }

  const onUp = (event) => finish(event, true);
  const onCancel = () => finish(null, false);

  for (const token of document.querySelectorAll('.summon-token')) {
    token.addEventListener('dragstart', (event) => event.preventDefault()); // never a native drag
    token.addEventListener('lostpointercapture', () => {
      if (drag?.token === token) onCancel();
    });
    token.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault(); // no text selection while dragging
      drag = { mode: token.dataset.mode, token, pointerId: event.pointerId, x: event.clientX, y: event.clientY, isDragging: false, ghost: null };
      token.setPointerCapture(event.pointerId); // the moves and the release come here, wherever the pointer goes
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      window.addEventListener('blur', onCancel);
    });
    token.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      click(token.dataset.mode);
    });
  }
}
