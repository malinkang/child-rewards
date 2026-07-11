let tasks = [];
let ledger = [];
let gifts = [];
let rewardsStatus = 'loading';
let giftsStatus = 'loading';

function getBalance() {
  return ledger.reduce((sum, entry) => sum + Number(entry.stars || 0), 0);
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

function hasTaskDoneToday(taskId) {
  return tasks.some((task) => task.id === taskId && task.done);
}

async function earnTask(taskId, sourceElement) {
  if (hasTaskDoneToday(taskId)) {
    showToast('这个任务今天已经完成啦');
    return;
  }
  const task = tasks.find((candidate) => candidate.id === taskId);
  if (!task) return;
  const sourceRect = sourceElement.getBoundingClientRect();
  sourceElement.disabled = true;
  try {
    const data = await postJson('/api/earn', { taskId });
    ledger.unshift(data.entry);
    task.done = true;
    render();
    celebrateEarn(task.stars, sourceRect);
    showToast(`+${task.stars} 颗星，已存入星星罐`);
  } catch (error) {
    showToast(error.message);
    await loadRewards();
  }
}

async function spend(item, stars) {
  try {
    const data = await postJson('/api/spend', { item, stars });
    ledger.unshift(data.entry);
    render();
    showToast('兑换已记录到 Notion');
    return true;
  } catch (error) {
    showToast(error.message);
    return false;
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
    grid.innerHTML = '<div class="empty">今天还没有任务。在 Notion 中添加任务并把“日期”设为今天，然后点击刷新。</div>';
    return;
  }

  grid.innerHTML = tasks.map((task) => {
    const done = hasTaskDoneToday(task.id);
    return `<button class="task-card ${done ? 'is-complete' : ''}" type="button" data-task-id="${task.id}" aria-pressed="${done}" ${done ? 'disabled' : ''}>
      <span class="task-check" aria-hidden="true"><span>✓</span></span>
      <span class="task-icon">${renderTaskIcon(task.icon)}</span>
      <strong>${escapeHtml(task.name)}</strong>
      <small>+${task.stars} 星</small>
      ${done ? '<em class="done-label">已完成</em>' : ''}
    </button>`;
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
    const hasMedia = item.media.length > 0;
    const cover = item.media[0];
    return `<div class="shop-item ${hasMedia ? 'has-media' : ''}" ${hasMedia ? `data-preview-id="${item.id}" tabindex="0" role="button" aria-label="查看 ${escapeHtml(item.name)}"` : ''}>
      <div class="shop-thumb">${cover ? mediaThumbnail(cover) : `<span>${categoryIcon(item.category)}</span>`}</div>
      <div>
        <div class="shop-title">${escapeHtml(item.name)}</div>
        <div class="shop-meta">${escapeHtml(item.category || '奖励')}${hasMedia ? ' · 点击预览' : ''} · ${ready ? '可以兑换' : `还差 ${item.cost - balance} 颗`}</div>
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
    return `<div class="ledger-item">
      <div>
        <div class="ledger-title">${escapeHtml(entry.title)}</div>
        <div class="ledger-meta">${formatDate(entry.date)}${entry.reason ? ` · ${escapeHtml(entry.reason)}` : ''}</div>
      </div>
      <div class="ledger-stars ${starClass}">${sign}${entry.stars}</div>
    </div>`;
  }).join('');
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
    rewardsStatus = 'ready';
    if (showSuccess) showToast('任务和星星记录已刷新');
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
  if (!response.ok) throw new Error(data.error || '操作失败，请稍后再试');
  return data;
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

function exportData() {
  const blob = new Blob([JSON.stringify({ tasks, ledger, gifts }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `child-rewards-${todayKey()}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function setupEvents() {
  document.getElementById('refreshRewardsButton').addEventListener('click', () => loadRewards(true));
  document.getElementById('refreshGiftsButton').addEventListener('click', () => loadGifts(true));
  document.getElementById('exportButton').addEventListener('click', exportData);

  document.getElementById('spendForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const item = String(form.get('item') || '').trim();
    const stars = Number(form.get('stars'));
    if (!item || !Number.isInteger(stars) || stars < 1) return;
    if (await spend(item, stars)) {
      event.currentTarget.reset();
      event.currentTarget.elements.stars.value = 10;
    }
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
}

setupEvents();
render();
Promise.all([loadRewards(), loadGifts()]);
