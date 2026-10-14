import { mountSharedNav } from './shared-nav.js';
import {
  UNKNOWN_LABEL,
  buildGradeOptions,
  buildStageOptions,
  buildStatusOptions,
  escapeHtml,
  filterPoems,
  labelOf,
  normalizeGradeSelection,
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
    results.innerHTML = `<div class="empty-card">${escapeHtml(error.message)}<br><button class="secondary-command" type="button" id="retryButton">重新读取</button></div>`;
    document.getElementById('retryButton')?.addEventListener('click', () => loadPoetry());
  } finally {
    document.getElementById('refreshButton').disabled = false;
  }
}

function render() {
  renderStats();
  renderFilters();
  renderResults();
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
  return `<li class="poem-item">
    <details class="poem-card">
      <summary>
        <span class="poem-summary-main"><span class="poem-title">${escapeHtml(poem.title || '未命名诗文')}</span><span class="poem-subtitle">${authors}${poem.dynasty ? ` · ${escapeHtml(poem.dynasty)}` : ''}</span></span>
        <span class="poem-chips"><span class="poem-chip is-stage">${stage}</span><span class="poem-chip">${grade}</span><span class="poem-chip is-status">${status}</span></span>
        <span class="poem-toggle" aria-hidden="true">▾</span>
      </summary>
      <div class="poem-detail">
        ${meta ? `<div class="poem-tags">${meta}</div>` : ''}
        <p class="poem-body">${escapeHtml(poem.body || '（暂无原文）')}</p>
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
