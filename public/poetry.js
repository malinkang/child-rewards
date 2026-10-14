import { mountSharedNav } from './shared-nav.js';
import {
  UNKNOWN_LABEL,
  buildGradeOptions,
  buildStageOptions,
  buildStatusOptions,
  computeProgress,
  escapeHtml,
  filterPoems,
  labelOf,
  normalizeGradeSelection,
  renderPoemContentHtml,
  safeHttpUrl,
} from './poetry-library.js';

let authorized = false;
let poems = [];
let stats = { total: 0, mastered: 0, byStatus: [], byStage: [] };
let stageFilter = '';
let gradeFilter = '';
let statusFilter = '';
let query = '';
let pinRequest = null;
let searchDebounce = 0;
const poemContentFetches = new Map();

function mountNav() {
  mountSharedNav({
    current: 'poetry',
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
  await loadPoetry();
}

async function loadPoetry(showSuccess = false) {
  const results = document.getElementById('poetryResults');
  results.innerHTML = '<div class="loading-card">正在把诗文一本本摆上书架...</div>';
  const progressContainer = document.getElementById('poetryProgress');
  if (progressContainer) progressContainer.innerHTML = '';
  document.getElementById('refreshButton').disabled = true;
  try {
    const response = await fetch('/api/poetry', { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw apiError(data, '诗文馆读取失败');
    poems = Array.isArray(data.poems) ? data.poems : [];
    stats = data.stats || stats;
    render();
    if (showSuccess) showToast('诗文馆已刷新');
  } catch (error) {
    const progressContainer = document.getElementById('poetryProgress');
    if (progressContainer) progressContainer.innerHTML = '';
    results.innerHTML = `<div class="empty-card">${escapeHtml(error.message)}<br><button class="secondary-command" type="button" id="retryButton">重新读取</button></div>`;
    document.getElementById('retryButton')?.addEventListener('click', () => loadPoetry());
  } finally {
    document.getElementById('refreshButton').disabled = false;
  }
}

function render() {
  renderProgress();
  renderStats();
  renderFilters();
  renderResults();
}

function renderProgress() {
  const container = document.getElementById('poetryProgress');
  if (!container) return;
  if (!poems.length) {
    container.innerHTML = '';
    return;
  }

  const progress = computeProgress(poems, {
    stage: stageFilter,
    grade: gradeFilter,
    masteredStatuses: stats.masteredStatuses,
  });

  const formattedPercent = progress.percent.toFixed(progress.percent % 1 === 0 ? 0 : 1);
  const isComplete = progress.total > 0 && progress.mastered === progress.total;

  container.innerHTML = `
    <div class="progress-header">
      <div class="progress-title-wrap">
        <span class="progress-badge" aria-hidden="true">${isComplete ? '🎉' : '📖'}</span>
        <div>
          <p class="progress-eyebrow">Learning Progress</p>
          <h3 class="progress-title">${escapeHtml(progress.scopeLabel)} · 背诵进度</h3>
        </div>
      </div>
      <div class="progress-numbers">
        <span class="progress-count">已掌握 <strong>${progress.mastered}</strong> / ${progress.total}<small> 首</small></span>
        <span class="progress-percent ${isComplete ? 'is-complete' : ''}">${formattedPercent}%</span>
      </div>
    </div>
    <div class="progress-track" role="progressbar" aria-valuenow="${formattedPercent}" aria-valuemin="0" aria-valuemax="100" aria-label="${escapeHtml(progress.scopeLabel)}背诵进度 ${formattedPercent}%">
      <div class="progress-fill ${isComplete ? 'is-complete' : ''}" style="width: ${Math.min(100, Math.max(0, progress.percent))}%;"></div>
    </div>
    <div class="progress-stages">
      ${progress.stages.map((item) => `
        <button class="stage-pill ${item.active ? 'is-active' : ''}" type="button" data-stage-pill="${escapeHtml(item.stage)}" aria-label="切换到${escapeHtml(item.stage)}背诵进度">
          <span class="stage-pill-name">${escapeHtml(item.stage)}</span>
          <span class="stage-pill-count">${item.mastered}/${item.total}</span>
          <span class="stage-pill-percent">${item.percent.toFixed(item.percent % 1 === 0 ? 0 : 1)}%</span>
        </button>
      `).join('')}
    </div>
  `;

  container.querySelectorAll('[data-stage-pill]').forEach((button) => {
    button.addEventListener('click', () => {
      const selected = button.getAttribute('data-stage-pill') || '';
      stageFilter = stageFilter === selected ? '' : selected;
      gradeFilter = normalizeGradeSelection(poems, stageFilter, gradeFilter);
      render();
    });
  });
}

function renderStats() {
  const stageCounts = new Map((stats.byStage || []).map((entry) => [labelOf(entry.name), entry.count]));
  const stages = buildStageOptions(poems).filter((label) => label !== UNKNOWN_LABEL);
  const masteredNames = (stats.masteredStatuses || []).filter(Boolean);
  const masteredLabel = masteredNames.length === 1 ? masteredNames[0] : '已掌握';
  document.getElementById('poetryStats').innerHTML = `
    <article class="stat-card is-total"><span class="stat-label">收录诗文</span><strong>${Number(stats.total) || poems.length}<small> 首</small></strong></article>
    <article class="stat-card is-mastered"><span class="stat-label">${escapeHtml(masteredLabel)}</span><strong>${Number(stats.mastered) || 0}<small> 首</small></strong></article>
    ${stages.map((label) => `<article class="stat-card"><span class="stat-label">${escapeHtml(label)}</span><strong>${stageCounts.get(label) || 0}<small> 首</small></strong></article>`).join('')}`;
}

function chip(label, active, attribute, value) {
  return `<button class="filter-chip ${active ? 'is-active' : ''}" type="button" ${attribute}="${escapeHtml(value)}" aria-pressed="${active ? 'true' : 'false'}">${escapeHtml(label)}</button>`;
}

function renderFilters() {
  const stageChips = [chip('全部学段', stageFilter === '', 'data-stage', '')]
    .concat(buildStageOptions(poems).map((label) => chip(label, stageFilter === label, 'data-stage', label)));
  const gradeChips = [chip('全部年级', gradeFilter === '', 'data-grade', '')]
    .concat(buildGradeOptions(poems, stageFilter).map((label) => chip(label, gradeFilter === label, 'data-grade', label)));
  const statusChips = [chip('全部状态', statusFilter === '', 'data-status', '')]
    .concat(buildStatusOptions(poems).map((label) => chip(label, statusFilter === label, 'data-status', label)));
  document.getElementById('stageFilters').innerHTML = stageChips.join('');
  document.getElementById('gradeFilters').innerHTML = gradeChips.join('');
  document.getElementById('statusFilters').innerHTML = statusChips.join('');
  document.querySelectorAll('#stageFilters [data-stage]').forEach((button) => button.addEventListener('click', () => {
    stageFilter = button.dataset.stage;
    gradeFilter = normalizeGradeSelection(poems, stageFilter, gradeFilter);
    render();
  }));
  document.querySelectorAll('#gradeFilters [data-grade]').forEach((button) => button.addEventListener('click', () => {
    gradeFilter = button.dataset.grade;
    render();
  }));
  document.querySelectorAll('#statusFilters [data-status]').forEach((button) => button.addEventListener('click', () => {
    statusFilter = button.dataset.status;
    render();
  }));
}

function renderResults() {
  const visible = filterPoems(poems, { stage: stageFilter, grade: gradeFilter, status: statusFilter, query });
  document.getElementById('resultCount').textContent = visible.length ? `共 ${visible.length} 首` : '';
  const results = document.getElementById('poetryResults');
  if (!poems.length) {
    results.innerHTML = '<div class="empty-card">书架还空着，稍后再来看看吧。</div>';
    return;
  }
  results.innerHTML = visible.length
    ? `<ul class="poem-list">${visible.map(renderPoem).join('')}</ul>`
    : '<div class="empty-card">没有找到符合条件的诗文，试试调整筛选或搜索词。</div>';

  attachCardListeners();
}

function renderPoem(poem) {
  const authors = (poem.authors || []).map((name) => escapeHtml(name)).join('、') || '作者未标注';
  const stage = escapeHtml(labelOf(poem.stage));
  const grade = escapeHtml(labelOf(poem.grade));
  const status = escapeHtml(labelOf(poem.status));
  const types = (Array.isArray(poem.type) ? poem.type : [poem.type]).filter(Boolean);
  const meta = [poem.dynasty, poem.section, ...types].filter((value) => value).map((value) => `<span class="poem-tag">${escapeHtml(value)}</span>`).join('');
  const week = typeof poem.week === 'string' ? poem.week.trim() : poem.week == null ? '' : String(poem.week);
  const link = safeHttpUrl(poem.link);
  const audio = (poem.audio || []).map((clip) => safeHttpUrl(clip?.url)).filter(Boolean);
  const hasContent = Boolean(poem.body);
  return `<li class="poem-item">
    <details class="poem-card" data-poem-id="${escapeHtml(poem.id)}">
      <summary>
        <span class="poem-summary-main"><span class="poem-title">${escapeHtml(poem.title || '未命名诗文')}</span><span class="poem-subtitle">${authors}${poem.dynasty ? ` · ${escapeHtml(poem.dynasty)}` : ''}</span></span>
        <span class="poem-chips"><span class="poem-chip is-stage">${stage}</span><span class="poem-chip">${grade}</span><span class="poem-chip is-status">${status}</span></span>
        <span class="poem-toggle" aria-hidden="true">▾</span>
      </summary>
      <div class="poem-detail">
        ${meta ? `<div class="poem-tags">${meta}</div>` : ''}
        <div class="poem-body-container" data-content-id="${escapeHtml(poem.id)}">
          ${hasContent ? renderPoemContentHtml(poem) : '<p class="poem-body poem-body-loading"><span class="poem-loading-sparkle" aria-hidden="true">🌸</span> 点击展开查看原文与译文…</p>'}
        </div>
        <dl class="poem-meta">
          <div><dt>作者</dt><dd>${authors}</dd></div>
          <div><dt>朝代</dt><dd>${escapeHtml(poem.dynasty || '—')}</dd></div>
          <div><dt>板块</dt><dd>${escapeHtml(poem.section || '—')}</dd></div>
          ${types.length ? `<div><dt>类型</dt><dd>${escapeHtml(types.join('、'))}</dd></div>` : ''}
          ${week ? `<div><dt>计划周次</dt><dd>${escapeHtml(week)}</dd></div>` : ''}
        </dl>
        ${link ? `<a class="poem-link" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">查看原文出处 ↗</a>` : '<p class="poem-link-note">暂无来源链接</p>'}
        ${audio.length ? audio.map((src, index) => `<audio class="poem-audio" controls preload="none" src="${escapeHtml(src)}" aria-label="${escapeHtml(poem.title || '诗文')} 朗读音频 ${audio.length > 1 ? index + 1 : ''}"></audio>`).join('') : '<p class="poem-link-note">暂无朗读音频</p>'}
      </div>
    </details>
  </li>`;
}

function attachCardListeners() {
  document.querySelectorAll('.poem-card').forEach((card) => {
    card.addEventListener('toggle', () => {
      if (card.open) {
        const poemId = card.getAttribute('data-poem-id');
        ensurePoemContent(poemId, card);
      }
    });
  });
}

async function ensurePoemContent(poemId, card) {
  if (!poemId) return;
  const poem = poems.find((p) => p.id === poemId);
  if (!poem) return;
  if (poem.body) return;

  const container = card ? card.querySelector('.poem-body-container') : document.querySelector(`.poem-body-container[data-content-id="${CSS.escape(poemId)}"]`);
  if (container) {
    container.innerHTML = '<div class="poem-body-loading"><span class="poem-loading-sparkle" aria-hidden="true">🌸</span> 正在载入诗文与译文…</div>';
  }

  try {
    let promise = poemContentFetches.get(poemId);
    if (!promise) {
      promise = fetch(`/api/poetry/${encodeURIComponent(poemId)}/content`).then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      }).finally(() => {
        poemContentFetches.delete(poemId);
      });
      poemContentFetches.set(poemId, promise);
    }
    const data = await promise;
    poem.body = data.text || '';
    poem.translation = data.translation || '';
    poem.appreciation = data.appreciation || '';

    const activeContainer = card ? card.querySelector('.poem-body-container') : document.querySelector(`.poem-body-container[data-content-id="${CSS.escape(poemId)}"]`);
    if (activeContainer) {
      activeContainer.innerHTML = renderPoemContentHtml(poem);
    }
  } catch {
    const errorContainer = card ? card.querySelector('.poem-body-container') : document.querySelector(`.poem-body-container[data-content-id="${CSS.escape(poemId)}"]`);
    if (errorContainer) {
      errorContainer.innerHTML = `
        <div class="poem-body-error">
          <span>诗文载入失败，请稍后重试</span>
          <button type="button" class="poem-retry-btn" data-retry-id="${escapeHtml(poemId)}">重试</button>
        </div>`;
      const retryBtn = errorContainer.querySelector('.poem-retry-btn');
      if (retryBtn) {
        retryBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          ensurePoemContent(poemId, card);
        });
      }
    }
  }
}

function resetFilters() {
  stageFilter = '';
  gradeFilter = '';
  statusFilter = '';
  query = '';
  document.getElementById('searchInput').value = '';
  render();
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

function setupEvents() {
  document.getElementById('refreshButton').addEventListener('click', () => loadPoetry(true));
  document.getElementById('resetButton').addEventListener('click', resetFilters);
  document.getElementById('searchInput').addEventListener('input', (event) => {
    query = event.target.value;
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(renderResults, 150);
  });
  document.getElementById('pinForm').addEventListener('submit', submitPin);
  document.getElementById('cancelPinButton').addEventListener('click', () => finishPin(null));
  document.getElementById('pinDialog').addEventListener('cancel', (event) => { event.preventDefault(); finishPin(null); });
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
