// "Celular": turns on the page the phone opens to follow and command the agents (served by
// src-tauri/src/phone.rs) and pairs it with a QR code. The link carries the pairing code, so it is
// shown only here, in the app's own window.
import { drawQr } from './qr.js';
import { formatElapsed } from './kinds.js';

const REFRESH_MS = 3000;
// A phone page polls every 2 s while open: seen this recently means it is on screen now.
const CONNECTED_MS = 10_000;
const QR_SCALE = 5;
// "Invalidar código" asks for a second click within this window, as the menu's confirmations do.
const CONFIRM_WINDOW_MS = 4000;
const RESET_LABEL = 'Invalidar código';

export function createPhonePanel({ invoke, showToast }) {
  const dialog = document.getElementById('phone');
  const backdrop = document.getElementById('phone-backdrop');
  const openButton = document.getElementById('phone-open');
  const toggle = document.getElementById('phone-toggle');
  const errorEl = document.getElementById('phone-error');
  const pairing = document.getElementById('phone-pairing');
  const qr = document.getElementById('phone-qr');
  const networks = document.getElementById('phone-networks');
  const seenEl = document.getElementById('phone-seen');
  const portNote = document.getElementById('phone-port-note');
  const stepNetwork = document.getElementById('phone-step-network');
  const publicUrlInput = document.getElementById('phone-public-url');
  const lifetimeSelect = document.getElementById('phone-lifetime');
  const expiryEl = document.getElementById('phone-expiry');
  const resetButton = document.getElementById('phone-reset');
  let status = null;
  let chosenAddress = null; // with Wi-Fi and Tailscale both up, the one the QR shows
  let drawnUrl = null;
  let refreshTimer = null;
  let returnFocus = null;
  let resetConfirmTimer = null;

  function currentLink() {
    const links = status?.links ?? [];
    return links.find((link) => link.address === chosenAddress) ?? links[0] ?? null;
  }

  function renderNetworks(links) {
    networks.hidden = links.length < 2;
    networks.querySelectorAll('label').forEach((label) => label.remove());
    if (links.length < 2) return;
    for (const link of links) {
      const label = document.createElement('label');
      label.className = 'phone-network';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'phone-network';
      radio.value = link.address;
      radio.checked = link === currentLink();
      radio.addEventListener('change', () => {
        chosenAddress = link.address;
        render();
      });
      const text = document.createElement('span');
      text.textContent = `${link.network} · ${link.address}`;
      label.append(radio, text);
      networks.append(label);
    }
  }

  function seenText(lastSeenAt) {
    if (!lastSeenAt) return 'Nenhum celular conectou ainda.';
    if (Date.now() - lastSeenAt < CONNECTED_MS) return 'Celular conectado agora.';
    return `Celular visto há ${formatElapsed(lastSeenAt)}.`;
  }

  function render() {
    const isOn = Boolean(status?.isOn);
    openButton.classList.toggle('is-on', isOn);
    openButton.title = isOn
      ? 'Celular ligado: o celular pareado vê os agentes e dá comandos'
      : 'Celular: veja os agentes, aprove pedidos e dê comandos pelo celular';
    toggle.checked = isOn;
    const links = status?.links ?? [];
    const link = currentLink();
    const error = status?.error ?? (isOn && !link ? 'Não achei rede local neste computador: conecte-o ao Wi-Fi, ao cabo ou ao Tailscale.' : null);
    errorEl.hidden = !error;
    errorEl.textContent = error ?? '';
    pairing.hidden = !isOn || !link;
    if (document.activeElement !== publicUrlInput) publicUrlInput.value = status?.publicUrl ?? '';
    const isInternet = link?.network === 'Internet';
    portNote.hidden = !isOn || !status?.port || isInternet;
    portNote.textContent = status?.port ? `Não abriu no celular? Confira se o firewall deste computador libera a porta ${status.port}/TCP.` : '';
    if (pairing.hidden) return;
    stepNetwork.textContent = isInternet
      ? 'Celular com internet, em qualquer rede: o endereço passa pelo seu túnel.'
      : 'Celular na mesma rede Wi-Fi deste computador, ou no Tailscale.';
    renderNetworks(links);
    if (link.url !== drawnUrl) {
      drawnUrl = link.url;
      drawQr(qr, link.url, QR_SCALE);
    }
    seenEl.textContent = seenText(status.lastSeenAt);
    lifetimeSelect.value = String(status.tokenLifetimeDays ?? 0);
    expiryEl.textContent = status.tokenExpiresAt ? `até ${formatExpiry(status.tokenExpiresAt)}` : '';
  }

  function formatExpiry(at) {
    return new Date(at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  async function load() {
    try {
      status = await invoke('get_phone');
      render();
    } catch (err) {
      showToast(`Celular: ${err}`, true);
    }
  }

  toggle.addEventListener('change', async () => {
    const isOn = toggle.checked;
    toggle.disabled = true;
    try {
      status = await invoke('set_phone', { isOn });
      render();
      if (!isOn) showToast('Celular desligado: a página do celular parou de responder');
      else if (!status.error) showToast('Celular ligado: escaneie o QR code com a câmera');
    } catch (err) {
      toggle.checked = !isOn;
      showToast(String(err), true);
    } finally {
      toggle.disabled = false;
    }
  });

  async function savePublicUrl() {
    const url = publicUrlInput.value.trim();
    if (url === (status?.publicUrl ?? '')) return;
    try {
      status = await invoke('set_phone_public_url', { url });
      chosenAddress = null; // the QR moves to the new address, or back home without one
      render();
      showToast(status.publicUrl ? `O QR agora usa ${status.publicUrl}` : 'Endereço na internet removido: o QR volta para a rede local');
    } catch (err) {
      showToast(String(err), true);
    }
  }

  publicUrlInput.addEventListener('change', savePublicUrl);
  publicUrlInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') publicUrlInput.blur(); // blur fires change
  });

  document.getElementById('phone-copy').addEventListener('click', async () => {
    const link = currentLink();
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      showToast('Link copiado. Ele leva o código: abra só no seu celular');
    } catch (err) {
      showToast(`Não consegui copiar: ${err}`, true);
    }
  });

  lifetimeSelect.addEventListener('change', async () => {
    const days = Number(lifetimeSelect.value);
    try {
      status = await invoke('set_phone_token_lifetime', { days });
      render();
      showToast(days ? `O código vale ${days === 1 ? '1 dia' : `${days} dias`} a partir de agora; depois, o celular escaneia o QR novo` : 'O código vale até você invalidar');
    } catch (err) {
      render(); // back to the saved choice
      showToast(String(err), true);
    }
  });

  function disarmReset() {
    clearTimeout(resetConfirmTimer);
    resetButton.classList.remove('is-confirming');
    resetButton.textContent = RESET_LABEL;
  }

  resetButton.addEventListener('click', async () => {
    if (!resetButton.classList.contains('is-confirming')) {
      resetButton.classList.add('is-confirming');
      resetButton.textContent = 'Clique de novo para invalidar';
      resetConfirmTimer = setTimeout(disarmReset, CONFIRM_WINDOW_MS);
      return;
    }
    disarmReset();
    try {
      status = await invoke('reset_phone_token');
      render();
      showToast('Código invalidado: todo celular pareado perdeu o acesso e precisa escanear o QR novo');
    } catch (err) {
      showToast(String(err), true);
    }
  });

  function open() {
    returnFocus = document.activeElement;
    dialog.hidden = false;
    backdrop.hidden = false;
    load();
    refreshTimer = setInterval(load, REFRESH_MS); // "conectado agora" follows the phone
    document.getElementById('phone-close').focus();
  }

  function close() {
    clearInterval(refreshTimer);
    disarmReset();
    dialog.hidden = true;
    backdrop.hidden = true;
    returnFocus?.focus?.();
  }

  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    close();
  });
  openButton.addEventListener('click', () => (dialog.hidden ? open() : close()));
  document.getElementById('phone-close').addEventListener('click', close);
  backdrop.addEventListener('click', close);
  load(); // the button shows whether it is on from the start

  return { open, close, isOpen: () => !dialog.hidden };
}
