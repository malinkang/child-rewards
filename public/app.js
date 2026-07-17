import { mountSharedNav } from './shared-nav.js';

let tasks = [];
let ledger = [];
let gifts = [];
let balance = 0;
let authorized = false;
let authLoaded = false;
let rewardsStatus = 'loading';
let giftsStatus = 'loading';
const AUDIO_ENABLED_KEY = 'childRewards.audio.enabled';
const WELCOME_PLAYED_KEY = 'childRewards.audio.welcomeDate';
const AUDIO_CLIPS = Object.freeze({
  welcomeStart: ['/audio/welcome-start-tasks.mp3', '/audio/welcome-new-day.mp3'],
  welcomeProgress: ['/audio/welcome-collect-stars.mp3'],
  allComplete: ['/audio/all-tasks-complete.mp3'],
  chineseComplete: ['/audio/task-chinese-complete-1.mp3', '/audio/task-chinese-complete-2.mp3'],
  readingComplete: ['/audio/task-reading-complete-1.mp3', '/audio/task-reading-complete-2.mp3'],
  notEnoughStars: ['/audio/not-enough-stars.mp3'],
  rewardRedeemed: ['/audio/reward-redeemed-1.mp3', '/audio/reward-redeemed-2.mp3'],
  encourage: ['/audio/encourage-try-again.mp3', '/audio/encourage-rest.mp3', '/audio/encourage-think-together.mp3'],
  goodbye: ['/audio/goodbye-tomorrow.mp3', '/audio/goodbye-playtime.mp3'],
});
let soundEnabled = localStorage.getItem(AUDIO_ENABLED_KEY) !== 'false';
let activeAudio = null;
let pendingWelcome = '';
let welcomeEvaluated = false;
let pinRequest = null;

function getBalance() {
  return balance;
}

function getTodayEarned() {
  const today = todayKey();
  return ledger
    .filter((entry) => todayKey(new Date(entry.date)) === today && entry.stars > 0)
    .reduce((sum, entry) => sum + entry.stars, 0);
}

function getWeekEarned() {
  const start = weekStart();
  return ledger
    .filter((entry) => new Date(entry.date) >= start && entry.stars > 0)
    .reduce((sum, entry) => sum + entry.stars, 0);
}

function getTaskCompletionsToday(taskId) {
  const today = todayKey();
  return ledger.filter((entry) =>
    entry.type === 'earn' && entry.taskId === taskId && todayKey(new Date(entry.date)) === today).length;
}

async function earnTask(taskId, sourceElement) {
  const task = tasks.find((candidate) => candidate.id === taskId);
  if (!task) return;
  if (!await ensureAuthorized()) return;
  const activeButton = document.querySelector(`[data-task-id="${CSS.escape(taskId)}"]`);
  const sourceRect = (activeButton || sourceElement).getBoundingClientRect();
  if (activeButton) activeButton.disabled = true;
  try {
    const data = await postJson('/api/earn', { taskId });
    ledger.unshift(data.entry);
    balance = Number(data.balance || 0);
    render();
    celebrateEarn(task.stars, sourceRect);
    showToast(`+${task.stars} 颗星，已存入星星罐`);
    playTaskCompletionAudio(task);
  } catch (error) {
    handleAuthError(error);
    showToast(error.message);
    await loadRewards();
  }
}

async function spend(item, stars, files = []) {
  if (!await ensureAuthorized()) return false;
  const pin = await requestPin('spend');
  if (!pin) return false;
  try {
    if (files.length) {
      const form = new FormData();
      form.append('item', item);
      form.append('stars', String(stars));
      form.append('pin', pin);
      files.forEach((file) => form.append('media', file));
      const response = await fetch('/api/spend', { method: 'POST', body: form });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(data.error || '兑换记录保存失败');
        error.code = data.code || '';
        throw error;
      }
    } else {
      await postJson('/api/spend', { item, stars, pin });
    }
    await loadRewards();
    showToast('兑换已记录到 Notion');
    playAudio(AUDIO_CLIPS.rewardRedeemed);
    return true;
  } catch (error) {
    handleAuthError(error);
    showToast(error.message);
    if (error.message.includes('还差')) playAudio(AUDIO_CLIPS.notEnoughStars);
    return false;
  }
}

function render() {
  const balance = getBalance();
  document.getElementById('balanceValue').textContent = balance;
  document.getElementById('todayValue').textContent = getTodayEarned();
  document.getElementById('weekValue').textContent = getWeekEarned();

  renderJar(balance);
  renderTasks();
  renderShop(balance);
  renderLedger();
}

function renderTasks() {
  const grid = document.getElementById('taskGrid');
  if (rewardsStatus === 'loading') {
    grid.innerHTML = '<div class="empty task-loading">正在从 Notion 取回任务...</div>';
    return;
  }
  if (rewardsStatus === 'error') {
    grid.innerHTML = '<div class="empty">任务暂时没有取回来，请稍后点击“刷新”。</div>';
    return;
  }
  if (!tasks.length) {
    grid.innerHTML = '<div class="empty">还没有任务。在 Notion 的任务表中添加任务后点击刷新。</div>';
    return;
  }

  grid.innerHTML = tasks.map((task) => {
    const completions = getTaskCompletionsToday(task.id);
    return `<article class="task-card">
      <span class="task-count">今日 ${completions} 次</span>
      <span class="task-icon">${renderTaskIcon(task.icon)}</span>
      <strong>${escapeHtml(task.name)}</strong>
      <small>每次 +${task.stars} 星</small>
      <button class="task-complete-button" type="button" data-task-id="${task.id}">${authorized ? '完成一次' : '🔒 完成一次'}</button>
    </article>`;
  }).join('');

  grid.querySelectorAll('[data-task-id]').forEach((button) => {
    button.addEventListener('click', () => earnTask(button.dataset.taskId, button));
  });
}

function renderTaskIcon(icon) {
  if (!icon) return '⭐';
  if (icon.type === 'image') return `<img src="${escapeHtml(icon.value)}" alt="" />`;
  return escapeHtml(icon.value);
}

function renderShop(balance) {
  const list = document.getElementById('shopList');
  if (giftsStatus === 'loading') {
    list.innerHTML = '<div class="empty shop-loading">正在从 Notion 取回礼品...</div>';
    return;
  }
  if (giftsStatus === 'error') {
    list.innerHTML = '<div class="empty">礼品暂时没有取回来，请稍后点击“刷新”。</div>';
    return;
  }
  if (!gifts.length) {
    list.innerHTML = '<div class="empty">礼品屋还是空的。在 Notion 中添加礼品并勾选“启用”，然后点击刷新。</div>';
    return;
  }

  list.innerHTML = gifts.map((item) => {
    const ready = balance >= item.cost;
    const progress = item.cost > 0 ? Math.min(100, Math.round((balance / item.cost) * 100)) : 100;
    const hasMedia = item.media.length > 0;
    const cover = item.media[0];
    return `<div class="shop-item ${hasMedia ? 'has-media' : ''}" ${hasMedia ? `data-preview-id="${item.id}" tabindex="0" role="button" aria-label="查看 ${escapeHtml(item.name)}"` : ''}>
      <div class="shop-thumb">${cover ? mediaThumbnail(cover) : `<span>${categoryIcon(item.category)}</span>`}</div>
      <div class="shop-content">
        <div class="shop-title">${escapeHtml(item.name)}</div>
        <div class="shop-progress">
          <div class="shop-progress-label">
            <span>${ready ? '可兑换' : `${balance} / ${item.cost} ⭐`}</span>
            <span>${progress}%</span>
          </div>
          <div class="shop-progress-track" role="progressbar" aria-label="${escapeHtml(item.name)}兑换进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}">
            <span class="shop-progress-bar ${ready ? 'is-ready' : ''}" style="width: ${progress}%"></span>
          </div>
        </div>
        ${item.description ? `<div class="shop-description">${escapeHtml(item.description)}</div>` : ''}
      </div>
      <div class="shop-actions">
        <div class="shop-price">${item.cost} ⭐</div>
        <button class="redeem-button" data-shop-id="${item.id}" type="button" ${ready ? '' : 'disabled'}>${authorized ? '兑换' : '🔒 兑换'}</button>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('[data-preview-id]').forEach((element) => {
    const preview = () => {
      const item = gifts.find((candidate) => candidate.id === element.dataset.previewId);
      if (item) openMediaViewer(item);
    };
    element.addEventListener('click', preview);
    element.addEventListener('keydown', (event) => {
      if (event.target !== element) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        preview();
      }
    });
  });

  list.querySelectorAll('[data-shop-id]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      const item = gifts.find((candidate) => candidate.id === button.dataset.shopId);
      if (item) await spend(item.name, item.cost);
    });
  });
}

function renderLedger() {
  const list = document.getElementById('ledgerList');
  if (rewardsStatus === 'loading') {
    list.innerHTML = '<div class="empty">正在读取星星记录...</div>';
    return;
  }
  if (!ledger.length) {
    list.innerHTML = '<div class="empty">还没有记录。完成一个任务后，星星脚印会出现在这里。</div>';
    return;
  }
  list.innerHTML = ledger.slice(0, 30).map((entry) => {
    const sign = entry.stars > 0 ? '+' : '';
    const starClass = entry.stars >= 0 ? 'positive' : 'negative';
    const hasMedia = entry.media?.length > 0;
    const cover = hasMedia ? entry.media[0] : null;
    return `<div class="ledger-item ${hasMedia ? 'has-media' : ''}" ${hasMedia ? `data-history-id="${entry.id}" tabindex="0" role="button" aria-label="查看 ${escapeHtml(entry.title)} 的照片或视频"` : ''}>
      ${cover ? `<div class="ledger-thumb">${mediaThumbnail(cover)}</div>` : ''}
      <div>
        <div class="ledger-title">${escapeHtml(entry.title)}</div>
        <div class="ledger-meta">${formatDate(entry.date)}${entry.reason ? ` · ${escapeHtml(entry.reason)}` : ''}</div>
      </div>
      <div class="ledger-stars ${starClass}">${sign}${entry.stars}</div>
    </div>`;
  }).join('');

  list.querySelectorAll('[data-history-id]').forEach((element) => {
    const preview = () => {
      const entry = ledger.find((candidate) => candidate.id === element.dataset.historyId);
      if (entry) openMediaViewer({ name: entry.title, media: entry.media });
    };
    element.addEventListener('click', preview);
    element.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        preview();
      }
    });
  });
}

async function loadRewards(showSuccess = false) {
  if (!tasks.length) rewardsStatus = 'loading';
  render();
  const button = document.getElementById('refreshRewardsButton');
  button.disabled = true;
  try {
    const response = await fetch(`/api/rewards?refresh=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('任务和星星记录读取失败');
    const data = await response.json();
    tasks = Array.isArray(data.tasks) ? data.tasks : [];
    ledger = Array.isArray(data.ledger) ? data.ledger : [];
    balance = Number(data.balance || 0);
    rewardsStatus = 'ready';
    if (showSuccess) showToast('任务和星星记录已刷新');
    if (!showSuccess) maybePlayWelcome();
  } catch (error) {
    rewardsStatus = 'error';
    showToast(error.message);
  } finally {
    button.disabled = false;
    render();
  }
}

async function loadGifts(showSuccess = false) {
  if (!gifts.length) giftsStatus = 'loading';
  renderShop(getBalance());
  const button = document.getElementById('refreshGiftsButton');
  button.disabled = true;
  try {
    const response = await fetch(`/api/gifts?refresh=${Date.now()}`);
    if (!response.ok) throw new Error('礼品读取失败');
    const data = await response.json();
    gifts = Array.isArray(data.gifts) ? data.gifts : [];
    giftsStatus = 'ready';
    if (showSuccess) showToast('礼品屋已刷新');
  } catch (error) {
    giftsStatus = 'error';
    showToast(error.message);
  } finally {
    button.disabled = false;
    renderShop(getBalance());
  }
}

async function postJson(path, payload) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || '操作失败，请稍后再试');
    error.code = data.code || '';
    throw error;
  }
  return data;
}

async function loadAuth() {
  try {
    const response = await fetch('/api/auth', { cache: 'no-store' });
    const data = await response.json();
    authorized = response.ok && data.authenticated === true;
  } catch {
    authorized = false;
  } finally {
    authLoaded = true;
    updateAuthButton();
    render();
  }
}

async function ensureAuthorized() {
  if (authorized) return true;
  return Boolean(await requestPin('unlock'));
}

function requestPin(mode) {
  if (pinRequest) return Promise.resolve(null);
  const dialog = document.getElementById('pinDialog');
  document.getElementById('pinDialogTitle').textContent = mode === 'unlock' ? '家长解锁' : '确认兑换';
  document.getElementById('pinDialogHint').textContent = mode === 'unlock'
    ? '输入家长 PIN，授权这台设备使用 30 天。'
    : '兑换礼物需要家长再次确认。';
  document.getElementById('pinError').textContent = '';
  document.getElementById('pinForm').reset();
  dialog.showModal();
  window.setTimeout(() => document.getElementById('pinInput').focus(), 50);
  return new Promise((resolve) => { pinRequest = { mode, resolve }; });
}

function finishPinRequest(result) {
  if (!pinRequest) return;
  const { resolve } = pinRequest;
  pinRequest = null;
  document.getElementById('pinDialog').close();
  resolve(result);
}

async function submitPin(event) {
  event.preventDefault();
  if (!pinRequest) return;
  const pin = document.getElementById('pinInput').value.trim();
  const button = document.getElementById('confirmPinButton');
  const errorElement = document.getElementById('pinError');
  if (pinRequest.mode === 'spend') {
    finishPinRequest(pin);
    return;
  }
  button.disabled = true;
  errorElement.textContent = '';
  try {
    await postJson('/api/auth/login', { pin });
    authorized = true;
    authLoaded = true;
    updateAuthButton();
    render();
    finishPinRequest(true);
    showToast('这台设备已解锁');
  } catch (error) {
    errorElement.textContent = error.message;
    document.getElementById('pinInput').select();
  } finally {
    button.disabled = false;
  }
}

async function toggleAuthorization() {
  if (!authorized) {
    await ensureAuthorized();
    return;
  }
  try {
    await postJson('/api/auth/logout', {});
    authorized = false;
    updateAuthButton();
    render();
    showToast('这台设备已锁定');
  } catch (error) {
    showToast(error.message);
  }
}

function updateAuthButton() {
  renderNavigation();
}

function renderNavigation() {
  mountSharedNav({
    current: 'home',
    authorized,
    soundEnabled,
    onAuthToggle: toggleAuthorization,
    onSoundToggle: toggleSound,
    onProtectedNavigate: ensureAuthorized,
  });
}

function handleAuthError(error) {
  if (error.code !== 'AUTH_REQUIRED') return;
  authorized = false;
  updateAuthButton();
  render();
}

function playTaskCompletionAudio(task) {
  if (/汉字|识字/.test(task.name)) {
    playAudio(AUDIO_CLIPS.chineseComplete);
  } else if (/英语|阅读|绘本|牛津/.test(task.name)) {
    playAudio(AUDIO_CLIPS.readingComplete);
  }
}

function maybePlayWelcome(force = false) {
  if ((!force && welcomeEvaluated) || !tasks.length) return;
  welcomeEvaluated = true;
  if (!soundEnabled || (!force && localStorage.getItem(WELCOME_PLAYED_KEY) === todayKey())) return;
  const clips = getTodayEarned() === 0 ? AUDIO_CLIPS.welcomeStart : AUDIO_CLIPS.welcomeProgress;
  playAudio(clips, { welcome: true });
}

async function playAudio(clips, { welcome = false } = {}) {
  if (!soundEnabled || !clips?.length) return false;
  const source = clips[Math.floor(Math.random() * clips.length)];
  activeAudio?.pause();
  const audio = new Audio(source);
  audio.volume = 0.55;
  activeAudio = audio;
  try {
    await audio.play();
    pendingWelcome = '';
    if (welcome) localStorage.setItem(WELCOME_PLAYED_KEY, todayKey());
    return true;
  } catch {
    if (welcome) pendingWelcome = source;
    return false;
  }
}

function playPendingWelcome() {
  if (!pendingWelcome || !soundEnabled) return;
  playAudio([pendingWelcome], { welcome: true });
}

function updateSoundButton() {
  const button = document.getElementById('soundToggle');
  const label = soundEnabled ? '关闭声音' : '开启声音';
  document.getElementById('soundIcon').textContent = soundEnabled ? '🔊' : '🔇';
  button.setAttribute('aria-label', label);
  button.title = label;
  button.setAttribute('aria-pressed', String(soundEnabled));
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  localStorage.setItem(AUDIO_ENABLED_KEY, String(soundEnabled));
  if (!soundEnabled) {
    activeAudio?.pause();
    pendingWelcome = '';
  } else {
    welcomeEvaluated = false;
    maybePlayWelcome(true);
  }
  updateSoundButton();
}

function celebrateEarn(stars, sourceRect) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const jarRect = document.querySelector('.star-jar').getBoundingClientRect();
  const startX = sourceRect.left + sourceRect.width / 2;
  const startY = sourceRect.top + sourceRect.height / 2;
  const endX = jarRect.left + jarRect.width / 2;
  const endY = jarRect.top + jarRect.height * 0.55;

  for (let index = 0; index < Math.min(stars + 3, 7); index += 1) {
    const sparkle = document.createElement('span');
    sparkle.className = 'flying-star';
    sparkle.textContent = index % 3 === 0 ? '♥' : '★';
    sparkle.style.left = `${startX}px`;
    sparkle.style.top = `${startY}px`;
    document.body.appendChild(sparkle);
    const scatterX = (index - 2) * 22 + (Math.random() - 0.5) * 28;
    const scatterY = -45 - Math.random() * 45;
    sparkle.animate([
      { transform: 'translate(-50%, -50%) scale(.2) rotate(-30deg)', opacity: 0 },
      { transform: `translate(calc(-50% + ${scatterX}px), calc(-50% + ${scatterY}px)) scale(1.2) rotate(20deg)`, opacity: 1, offset: 0.34 },
      { transform: `translate(calc(-50% + ${endX - startX}px), calc(-50% + ${endY - startY}px)) scale(.45) rotate(220deg)`, opacity: .85 }
    ], { duration: 780 + index * 55, delay: index * 45, easing: 'cubic-bezier(.2,.75,.25,1)', fill: 'forwards' })
      .finished.finally(() => sparkle.remove());
  }
  window.setTimeout(() => {
    const jar = document.querySelector('.star-jar');
    const balance = document.querySelector('.balance-number');
    jar.classList.remove('celebrate');
    balance.classList.remove('balance-pop');
    void jar.offsetWidth;
    jar.classList.add('celebrate');
    balance.classList.add('balance-pop');
  }, 650);
}

function renderJar(balance) {
  const jar = document.getElementById('jarStars');
  const starCount = Math.min(100, Math.max(0, balance));
  const fillHeight = Math.min(86, 12 + starCount * 0.74);
  const stars = [];
  for (let index = 0; index < starCount; index += 1) {
    const left = 5 + pseudoRandom(index, 17) * 90;
    const bottom = 3 + pseudoRandom(index, 43) * fillHeight;
    const rotation = -18 + pseudoRandom(index, 71) * 36;
    const delay = pseudoRandom(index, 131) * -3.6;
    const duration = 2.4 + pseudoRandom(index, 163) * 2.6;
    stars.push(`<span class="jar-star" style="--x:${left}%;--y:${bottom}%;--r:${rotation}deg;--delay:${delay}s;--duration:${duration}s"></span>`);
  }
  jar.innerHTML = stars.join('');
}

function pseudoRandom(index, salt) {
  const value = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function mediaThumbnail(media) {
  if (media.type === 'video') return `<video src="${escapeHtml(media.url)}" muted preload="metadata" playsinline></video><span class="play-badge">▶</span>`;
  return `<img src="${escapeHtml(media.url)}" alt="" loading="lazy" />`;
}

function openMediaViewer(item) {
  closeMediaViewer();
  const dialog = document.getElementById('mediaDialog');
  const viewer = document.getElementById('mediaViewer');
  document.getElementById('mediaViewerTitle').textContent = item.name;
  item.media.forEach((media, index) => {
    const element = document.createElement(media.type === 'video' ? 'video' : 'img');
    element.src = media.url;
    if (media.type === 'video') {
      element.controls = true;
      element.autoplay = index === 0;
      element.playsInline = true;
    } else {
      element.alt = item.name;
    }
    viewer.appendChild(element);
  });
  dialog.showModal();
  viewer.querySelector('video[autoplay]')?.play().catch(() => {});
}

function closeMediaViewer() {
  const dialog = document.getElementById('mediaDialog');
  dialog.querySelectorAll('video').forEach((video) => video.pause());
  document.getElementById('mediaViewer').replaceChildren();
  if (dialog.open) dialog.close();
}

function categoryIcon(category) {
  return ({ 玩具: '🧸', 绘本: '📚', 亲子活动: '🎨', 选择权: '🎀' })[category] || '🎁';
}

function todayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function weekStart(date = new Date()) {
  const result = new Date(date);
  const day = result.getDay() || 7;
  result.setDate(result.getDate() - day + 1);
  result.setHours(0, 0, 0, 0);
  return result;
}

function formatDate(value) {
  return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 2300);
}

function setupEvents() {
  renderNavigation();
  updateSoundButton();
  document.addEventListener('pointerdown', (event) => {
    if (!event.target.closest('#soundToggle')) playPendingWelcome();
  }, { capture: true });
  document.getElementById('refreshRewardsButton').addEventListener('click', () => loadRewards(true));
  document.getElementById('refreshGiftsButton').addEventListener('click', () => loadGifts(true));
  document.getElementById('spendForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const item = String(form.get('item') || '').trim();
    const stars = Number(form.get('stars'));
    const files = [...event.currentTarget.elements.media.files];
    if (!item || !Number.isInteger(stars) || stars < 1) return;
    const submitButton = event.currentTarget.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = files.length ? '上传并保存中...' : '保存中...';
    if (await spend(item, stars, files)) {
      event.currentTarget.reset();
      event.currentTarget.elements.stars.value = 10;
    }
    submitButton.disabled = false;
    submitButton.textContent = '确认兑换';
  });

  const mediaDialog = document.getElementById('mediaDialog');
  document.getElementById('closeMediaButton').addEventListener('click', closeMediaViewer);
  mediaDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeMediaViewer();
  });
  mediaDialog.addEventListener('click', (event) => {
    if (event.target === mediaDialog) closeMediaViewer();
  });

  const pinDialog = document.getElementById('pinDialog');
  document.getElementById('pinForm').addEventListener('submit', submitPin);
  document.getElementById('cancelPinButton').addEventListener('click', () => finishPinRequest(null));
  pinDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    finishPinRequest(null);
  });
}

setupEvents();
render();
Promise.all([loadAuth(), loadRewards(), loadGifts()]);
