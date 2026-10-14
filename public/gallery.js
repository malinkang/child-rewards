import { mountSharedNav } from './shared-nav.js';
import { escapeHtml } from './poetry-library.js';
import { artworkLabel, formatArtworkDate, mapArtworks, stepIndex } from './gallery-model.js';

let authorized = false;
let artworks = [];
let viewerIndex = -1;
let lastFocused = null;
let pinRequest = null;
let swipeStart = null;
let swipeConsumed = false;

function mountNav() {
  mountSharedNav({
    current: 'gallery',
    authorized,
    onAuthToggle: toggleAuthorization,
    onProtectedNavigate: ensureAuthorized,
  });
}

async function loadAuth() {
  try {
    const response = await fetch('/api/auth', { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    authorized = response.ok && data.authenticated === true;
  } catch { authorized = false; }
  mountNav();
  await loadArtworks();
}

async function loadArtworks(showSuccess = false) {
  const wall = document.getElementById('artworkWall');
  wall.innerHTML = '<div class="loading-card">正在把画挂上墙…</div>';
  document.getElementById('wallStats').textContent = '';
  document.getElementById('refreshButton').disabled = true;
  try {
    const response = await fetch('/api/artworks', { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw apiError(data, '作品墙读取失败');
    artworks = mapArtworks(data);
    if (viewerIndex >= artworks.length) viewerIndex = -1;
    renderWall();
    if (showSuccess) showToast('作品墙已刷新');
  } catch (error) {
    wall.innerHTML = `<div class="empty-card">${escapeHtml(error.message)}<br><button class="secondary-command" type="button" id="retryButton">重新读取</button></div>`;
    document.getElementById('retryButton').addEventListener('click', () => loadArtworks());
  } finally {
    document.getElementById('refreshButton').disabled = false;
  }
}

function renderWall() {
  const wall = document.getElementById('artworkWall');
  const stats = document.getElementById('wallStats');
  if (!artworks.length) {
    stats.textContent = '';
    wall.innerHTML = '<div class="empty-card">作品墙还空着，先在 Notion 里添加第一幅作品吧。</div>';
    return;
  }
  const described = artworks.filter((artwork) => artwork.description).length;
  stats.textContent = described
    ? `${artworks.length} 幅作品 · ${described} 幅有讲述`
    : `${artworks.length} 幅作品`;
  wall.innerHTML = artworks.map((artwork, index) => wallItem(artwork, index)).join('');
  wall.querySelectorAll('.wall-frame').forEach((button) => {
    button.addEventListener('click', () => openViewer(Number(button.dataset.index), button));
  });
}

function wallItem(artwork, index) {
  const label = artworkLabel(artwork);
  const date = formatArtworkDate(artwork.date);
  const metaParts = [];
  if (artwork.description && artwork.title) metaParts.push(artwork.title);
  if (date) metaParts.push(date);
  return `<figure class="wall-item" style="--i:${index}">
      <button class="wall-frame" type="button" data-index="${index}" aria-label="放大查看《${escapeHtml(label)}》">
        <img class="wall-image" src="${escapeHtml(artwork.image)}" alt="${escapeHtml(label)}" loading="lazy" decoding="async" />
      </button>
      <figcaption class="wall-label">
        <span class="wall-label-text">${escapeHtml(label)}</span>
        ${metaParts.length ? `<span class="wall-label-meta">${escapeHtml(metaParts.join(' · '))}</span>` : ''}
        ${artwork.audio ? '<span class="wall-label-audio" aria-hidden="true">🔊</span>' : ''}
      </figcaption>
    </figure>`;
}

function openViewer(index, opener) {
  if (!Number.isInteger(index) || index < 0 || index >= artworks.length) return;
  viewerIndex = index;
  // Safari/iOS does not focus a button on tap, so remember the frame itself.
  lastFocused = opener || document.activeElement;
  renderViewer();
  const dialog = document.getElementById('artworkViewer');
  if (!dialog.open) dialog.showModal();
  document.body.classList.add('viewer-open');
  setTimeout(() => document.getElementById('viewerClose').focus(), 30);
}

function closeViewer() {
  stopAudio();
  const dialog = document.getElementById('artworkViewer');
  if (dialog.open) dialog.close();
  document.body.classList.remove('viewer-open');
  if (lastFocused?.isConnected && typeof lastFocused.focus === 'function') lastFocused.focus();
  lastFocused = null;
}

function moveViewer(delta) {
  if (viewerIndex < 0 || !artworks.length) return;
  viewerIndex = stepIndex(viewerIndex, delta, artworks.length);
  renderViewer();
}

function renderViewer() {
  const artwork = artworks[viewerIndex];
  if (!artwork) return;
  const image = document.getElementById('viewerImage');
  image.src = artwork.image;
  image.alt = artworkLabel(artwork);
  document.getElementById('viewerMeta').textContent = `第 ${viewerIndex + 1} / ${artworks.length} 幅`;
  document.getElementById('viewerTitle').textContent = artworkLabel(artwork);
  const date = formatArtworkDate(artwork.date);
  const dateNode = document.getElementById('viewerDate');
  dateNode.textContent = date;
  dateNode.hidden = !date;
  resetAudioButton();
  const audio = document.getElementById('viewerAudioElement');
  const audioButton = document.getElementById('viewerAudio');
  if (artwork.audio) {
    audioButton.hidden = false;
    audio.src = artwork.audio;
  } else {
    audioButton.hidden = true;
    audio.removeAttribute('src');
    audio.load();
  }
}

function resetAudioButton() {
  stopAudio();
  const button = document.getElementById('viewerAudio');
  button.setAttribute('aria-pressed', 'false');
  button.textContent = '▶ 听多乐讲讲这幅画';
}

function stopAudio() {
  const audio = document.getElementById('viewerAudioElement');
  if (!audio.paused) audio.pause();
  if (audio.currentTime) audio.currentTime = 0;
}

function toggleAudio() {
  const audio = document.getElementById('viewerAudioElement');
  const button = document.getElementById('viewerAudio');
  if (audio.paused) {
    audio.play().then(() => {
      button.setAttribute('aria-pressed', 'true');
      button.textContent = '⏸ 暂停讲述';
    }).catch(() => showToast('音频暂时无法播放'));
  } else {
    audio.pause();
    button.setAttribute('aria-pressed', 'false');
    button.textContent = '▶ 听多乐讲讲这幅画';
  }
}

function setupEvents() {
  document.getElementById('refreshButton').addEventListener('click', () => loadArtworks(true));
  document.getElementById('pinForm').addEventListener('submit', submitPin);
  document.getElementById('cancelPinButton').addEventListener('click', () => finishPin(null));
  document.getElementById('pinDialog').addEventListener('cancel', (event) => { event.preventDefault(); finishPin(null); });

  const dialog = document.getElementById('artworkViewer');
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeViewer(); });
  // Capture phase: a swipe that ends on a different element still emits a click
  // on the nearest common ancestor, which must not close the viewer.
  dialog.addEventListener('click', (event) => {
    if (swipeConsumed) {
      swipeConsumed = false;
      event.stopPropagation();
      return;
    }
    const target = event.target;
    if (target === dialog || target.classList?.contains('viewer-shell') || target.classList?.contains('viewer-stage')) {
      closeViewer();
    }
  }, true);
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); moveViewer(-1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); moveViewer(1); }
  });
  document.getElementById('viewerPrev').addEventListener('click', () => moveViewer(-1));
  document.getElementById('viewerNext').addEventListener('click', () => moveViewer(1));
  document.getElementById('viewerClose').addEventListener('click', () => closeViewer());
  document.getElementById('viewerAudio').addEventListener('click', toggleAudio);
  document.getElementById('viewerAudioElement').addEventListener('ended', resetAudioButton);

  const stage = document.querySelector('.viewer-stage');
  stage.addEventListener('pointerdown', (event) => {
    // Never hijack the prev/next buttons: they must keep plain click behaviour.
    if (event.target.closest?.('button')) return;
    swipeStart = { x: event.clientX, y: event.clientY };
    swipeConsumed = false;
    // Capture the pointer so the gesture also completes over the shell or the
    // nav buttons instead of being dropped when it leaves the stage.
    try { stage.setPointerCapture(event.pointerId); } catch { /* not always supported */ }
  });
  stage.addEventListener('pointercancel', () => { swipeStart = null; });
  stage.addEventListener('pointerup', (event) => {
    if (!swipeStart) return;
    const dx = event.clientX - swipeStart.x;
    const dy = event.clientY - swipeStart.y;
    swipeStart = null;
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy)) return;
    swipeConsumed = true;
    // Touch gestures do not always produce a click; never swallow the next tap.
    setTimeout(() => { swipeConsumed = false; }, 400);
    moveViewer(dx < 0 ? 1 : -1);
  });
}

function requestPin(mode) {
  if (pinRequest) return Promise.resolve(null);
  document.getElementById('pinTitle').textContent = mode === 'unlock' ? '家长解锁' : '确认操作';
  document.getElementById('pinHint').textContent = '输入家长 PIN 后解锁这台设备。';
  document.getElementById('pinError').textContent = '';
  document.getElementById('pinForm').reset();
  document.getElementById('pinDialog').showModal();
  setTimeout(() => document.getElementById('pinInput').focus(), 30);
  return new Promise((resolve) => { pinRequest = { mode, resolve }; });
}

function finishPin(value) {
  if (!pinRequest) return;
  const resolve = pinRequest.resolve;
  pinRequest = null;
  document.getElementById('pinDialog').close();
  resolve(value);
}

async function submitPin(event) {
  event.preventDefault();
  const pin = document.getElementById('pinInput').value.trim();
  try {
    await postJson('/api/auth/login', { pin });
    authorized = true;
    mountNav();
    finishPin(true);
    showToast('这台设备已解锁');
  } catch (error) {
    document.getElementById('pinError').textContent = error.message;
  }
}

async function ensureAuthorized() {
  if (authorized) return true;
  const unlocked = await requestPin('unlock');
  if (unlocked) {
    authorized = true;
    mountNav();
  }
  return Boolean(unlocked);
}

async function toggleAuthorization() {
  if (!authorized) {
    if (await requestPin('unlock')) authorized = true;
    mountNav();
    return;
  }
  try {
    await postJson('/api/auth/logout', {});
    authorized = false;
    mountNav();
    showToast('这台设备已锁定');
  } catch (error) {
    showToast(error.message);
  }
}

async function postJson(path, payload) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw apiError(data, '操作失败');
  return data;
}

function apiError(data, fallback) {
  const error = new Error(data.error || fallback);
  error.code = data.code || '';
  return error;
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2400);
}

mountNav();
setupEvents();
loadAuth();
