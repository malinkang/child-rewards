const STORAGE_KEY = 'childRewards.local.v1';

const TASKS = {
  chinese: { title: '学 1 个汉字', stars: 1, reason: '学 1 个汉字' },
  oxford: { title: '读 2 本牛津树', stars: 2, reason: '读 2 本牛津树' },
  tidy: { title: '收拾好玩具', stars: 1, reason: '主动收拾好玩具' },
  brush: { title: '自己刷牙', stars: 1, reason: '自己认真刷牙' },
  english: { title: '听英语儿歌', stars: 1, reason: '听英语儿歌' },
};

const state = loadState();
let gifts = [];
let giftsStatus = 'loading';

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return { ledger: [] };
  }
  try {
    const parsed = JSON.parse(raw);
    return {
      ledger: Array.isArray(parsed.ledger) ? parsed.ledger : [],
    };
  } catch {
    return { ledger: [] };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function weekStart(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getBalance() {
  return state.ledger.reduce((sum, entry) => sum + entry.stars, 0);
}

function getTodayEarned() {
  const today = todayKey();
  return state.ledger
    .filter((entry) => entry.date.startsWith(today) && entry.stars > 0)
    .reduce((sum, entry) => sum + entry.stars, 0);
}

function getWeekEarned() {
  const start = weekStart();
  return state.ledger
    .filter((entry) => new Date(entry.date) >= start && entry.stars > 0)
    .reduce((sum, entry) => sum + entry.stars, 0);
}

function hasTaskDoneToday(taskKey) {
  const today = todayKey();
  return state.ledger.some((entry) => entry.date.startsWith(today) && entry.taskKey === taskKey && entry.type === 'earn');
}

function addLedger({ type, title, reason, stars, taskKey = 'custom' }) {
  const balanceAfter = getBalance() + stars;
  state.ledger.unshift({
    id: crypto.randomUUID(),
    type,
    title,
    reason,
    stars,
    taskKey,
    balanceAfter,
    date: new Date().toISOString(),
  });
  saveState();
  render();
}

function earnTask(taskKey, sourceElement) {
  if (hasTaskDoneToday(taskKey)) {
    showToast('这个任务今天已经加过星啦');
    return;
  }
  const task = TASKS[taskKey];
  const sourceRect = sourceElement?.getBoundingClientRect();
  addLedger({ type: 'earn', title: task.title, reason: task.reason, stars: task.stars, taskKey });
  celebrateEarn(task.stars, sourceRect);
  showToast(`+${task.stars} 颗星，已存入星星罐`);
}

function celebrateEarn(stars, sourceRect) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const jarRect = document.querySelector('.star-jar').getBoundingClientRect();
  const startX = sourceRect ? sourceRect.left + sourceRect.width / 2 : window.innerWidth / 2;
  const startY = sourceRect ? sourceRect.top + sourceRect.height / 2 : window.innerHeight / 2;
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

  const jar = document.querySelector('.star-jar');
  const balance = document.querySelector('.balance-number');
  window.setTimeout(() => {
    jar.classList.remove('celebrate');
    balance.classList.remove('balance-pop');
    void jar.offsetWidth;
    jar.classList.add('celebrate');
    balance.classList.add('balance-pop');
  }, 650);
}

function spend(item, stars) {
  const balance = getBalance();
  if (stars > balance) {
    showToast(`星星还不够，还差 ${stars - balance} 颗`);
    return false;
  }
  addLedger({ type: 'spend', title: `兑换：${item}`, reason: item, stars: -stars, taskKey: 'shop' });
  showToast('兑换已记录');
  return true;
}

function resetToday() {
  const today = todayKey();
  const before = state.ledger.length;
  state.ledger = state.ledger.filter((entry) => !(entry.date.startsWith(today) && entry.type === 'earn'));
  if (state.ledger.length === before) {
    showToast('今天还没有可重置的加星记录');
  } else {
    saveState();
    render();
    showToast('今日加星已重置');
  }
}

function render() {
  const balance = getBalance();
  document.getElementById('balanceValue').textContent = balance;
  document.getElementById('todayValue').textContent = getTodayEarned();
  document.getElementById('weekValue').textContent = getWeekEarned();

  const goalProgress = Math.max(0, Math.min(10, balance));
  document.getElementById('toyProgressValue').textContent = `${goalProgress}/10`;
  document.getElementById('toyProgressBar').style.width = `${goalProgress * 10}%`;

  renderJar(balance);
  renderTasks();
  renderShop(balance);
  renderLedger();
}

function renderJar(balance) {
  const jar = document.getElementById('jarStars');
  const starCount = Math.min(100, Math.max(0, balance));
  const fillHeight = Math.min(86, 12 + starCount * 0.74);
  const stars = [];
  for (let i = 0; i < starCount; i += 1) {
    const left = 5 + pseudoRandom(i, 17) * 90;
    const bottom = 3 + pseudoRandom(i, 43) * fillHeight;
    const rotation = -18 + pseudoRandom(i, 71) * 36;
    const delay = pseudoRandom(i, 131) * -3.6;
    const duration = 2.4 + pseudoRandom(i, 163) * 2.6;
    stars.push(`<span class="jar-star" style="--x:${left}%;--y:${bottom}%;--r:${rotation}deg;--delay:${delay}s;--duration:${duration}s"></span>`);
  }
  jar.innerHTML = stars.join('');
}

function pseudoRandom(index, salt) {
  const value = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function renderTasks() {
  Object.keys(TASKS).forEach((taskKey) => {
    const done = hasTaskDoneToday(taskKey);
    const button = document.querySelector(`[data-task="${taskKey}"]`);
    const pill = document.getElementById(`${taskKey}Done`);
    button.disabled = done;
    button.classList.toggle('is-complete', done);
    button.setAttribute('aria-pressed', String(done));
    pill.classList.toggle('hidden', !done);
  });
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
    const hasMedia = item.media.length > 0;
    const cover = item.media[0];
    return `<div class="shop-item ${hasMedia ? 'has-media' : ''}" ${hasMedia ? `data-preview-id="${item.id}" tabindex="0" role="button" aria-label="查看 ${escapeHtml(item.name)}"` : ''}>
      <div class="shop-thumb">
        ${cover ? mediaThumbnail(cover) : `<span>${categoryIcon(item.category)}</span>`}
      </div>
      <div>
        <div class="shop-title">${escapeHtml(item.name)}</div>
        <div class="shop-meta">${categoryLabel(item.category)}${hasMedia ? ' · 点击预览' : ''} · ${ready ? '可以兑换' : `还差 ${item.cost - balance} 颗`}</div>
        ${item.description ? `<div class="shop-description">${escapeHtml(item.description)}</div>` : ''}
      </div>
      <button class="shop-cost ${ready ? 'ready' : 'locked'}" data-shop-id="${item.id}" type="button">${item.cost} 星</button>
    </div>`;
  }).join('');

  list.querySelectorAll('[data-preview-id]').forEach((element) => {
    const preview = () => {
      const item = gifts.find((candidate) => candidate.id === element.dataset.previewId);
      if (item) openMediaViewer(item);
    };
    element.addEventListener('click', preview);
    element.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        preview();
      }
    });
  });

  list.querySelectorAll('[data-shop-id]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const item = gifts.find((candidate) => candidate.id === button.dataset.shopId);
      if (!item) return;
      spend(item.name, item.cost);
    });
  });
}

function mediaThumbnail(media) {
  if (media.type === 'video') {
    return `<video src="${escapeHtml(media.url)}" muted preload="metadata" playsinline></video><span class="play-badge">▶</span>`;
  }
  return `<img src="${escapeHtml(media.url)}" alt="" loading="lazy" />`;
}

function openMediaViewer(item) {
  closeMediaViewer();
  const dialog = document.getElementById('mediaDialog');
  const viewer = document.getElementById('mediaViewer');
  document.getElementById('mediaViewerTitle').textContent = item.name;

  item.media.forEach((media, index) => {
    if (media.type === 'video') {
      const video = document.createElement('video');
      video.src = media.url;
      video.controls = true;
      video.autoplay = index === 0;
      video.playsInline = true;
      viewer.appendChild(video);
    } else {
      const image = document.createElement('img');
      image.src = media.url;
      image.alt = item.name;
      viewer.appendChild(image);
    }
  });

  dialog.showModal();
  viewer.querySelector('video[autoplay]')?.play().catch(() => {});
}

function closeMediaViewer() {
  const dialog = document.getElementById('mediaDialog');
  const video = dialog.querySelector('video');
  video?.pause();
  document.getElementById('mediaViewer').replaceChildren();
  if (dialog.open) dialog.close();
}

async function loadGifts(forceRefresh = false) {
  giftsStatus = 'loading';
  renderShop(getBalance());
  const button = document.getElementById('refreshGiftsButton');
  button.disabled = true;
  try {
    const query = forceRefresh ? `?refresh=${Date.now()}` : '';
    const response = await fetch(`/api/gifts${query}`);
    if (!response.ok) throw new Error('Gift request failed');
    const data = await response.json();
    gifts = Array.isArray(data.gifts) ? data.gifts : [];
    giftsStatus = 'ready';
    if (forceRefresh) showToast('礼品屋已刷新');
  } catch {
    giftsStatus = 'error';
    if (forceRefresh) showToast('刷新失败，请稍后再试');
  } finally {
    button.disabled = false;
    renderShop(getBalance());
  }
}

function renderLedger() {
  const list = document.getElementById('ledgerList');
  if (!state.ledger.length) {
    list.innerHTML = '<div class="empty">还没有记录。完成一次“学汉字”或“读牛津树”，星星就会出现。</div>';
    return;
  }

  list.innerHTML = state.ledger.slice(0, 30).map((entry) => {
    const sign = entry.stars > 0 ? '+' : '';
    const starClass = entry.stars >= 0 ? 'positive' : 'negative';
    return `<div class="ledger-item">
      <div>
        <div class="ledger-title">${escapeHtml(entry.title)}</div>
        <div class="ledger-meta">${formatDate(entry.date)} · 余额 ${entry.balanceAfter} 颗</div>
      </div>
      <div class="ledger-stars ${starClass}">${sign}${entry.stars}</div>
    </div>`;
  }).join('');
}

function categoryLabel(category) {
  return category || '奖励';
}

function categoryIcon(category) {
  return ({ 玩具: '🧸', 绘本: '📚', 亲子活动: '🎨', 选择权: '🎀' })[category] || '🎁';
}

function formatDate(value) {
  const date = new Date(value);
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
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

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `child-rewards-${todayKey()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function setupEvents() {
  document.querySelectorAll('[data-task]').forEach((button) => {
    button.addEventListener('click', () => earnTask(button.dataset.task, button));
  });

  document.getElementById('resetTodayButton').addEventListener('click', resetToday);
  document.getElementById('exportButton').addEventListener('click', exportData);

  document.getElementById('spendForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const item = String(form.get('item') || '').trim();
    const stars = Number(form.get('stars'));
    if (!item || !Number.isFinite(stars) || stars < 1) return;
    if (spend(item, stars)) {
      event.currentTarget.reset();
      event.currentTarget.elements.stars.value = 10;
    }
  });

  const mediaDialog = document.getElementById('mediaDialog');
  document.getElementById('refreshGiftsButton').addEventListener('click', () => loadGifts(true));
  document.getElementById('closeMediaButton').addEventListener('click', closeMediaViewer);
  mediaDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeMediaViewer();
  });
  mediaDialog.addEventListener('click', (event) => {
    if (event.target === mediaDialog) closeMediaViewer();
  });
  document.getElementById('clearButton').addEventListener('click', () => {
    if (!confirm('确定清空所有本地记录吗？这个操作不能恢复。')) return;
    state.ledger = [];
    saveState();
    render();
    showToast('已清空本地记录');
  });
}

setupEvents();
render();
loadGifts();
