import { mountSharedNav } from './shared-nav.js';

const VALID_STATUSES = ['全部', '已完成', '计划中', '试听', '请假', '取消'];
const COLOR_MAP = { '粉色': '#f58fb1', '蓝色': '#69bdda', '黄色': '#f2be39', '薄荷绿': '#70c9b0', '紫色': '#a98ad4' };
let authorized = false;
let courses = [];
let records = [];
let profile = { name: '多乐', avatarUrl: '' };
let summary = {};
let selectedYear = beijingNow().getFullYear();
let selectedMonth = beijingNow().getMonth();
let selectedDate = '';
let courseFilter = '全部';
let monthFilter = '全部';
let statusFilter = '全部';
let selectedFiles = [];
let uploadStates = [];
let uploadInProgress = false;
let pendingRecordId = '';
let pinRequest = null;
let recordDraftInitialized = false;

function beijingNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
}

function dateKey(value) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function mountNav() {
  mountSharedNav({
    current: 'classes',
    authorized,
    onAuthToggle: toggleAuthorization,
    onProtectedNavigate: ensureAuthorized,
  });
}

async function loadAuth() {
  try {
    const response = await fetch('/api/auth', { cache: 'no-store' });
    const data = await response.json();
    authorized = response.ok && data.authenticated === true;
  } catch { authorized = false; }
  mountNav();
  if (!authorized) {
    const unlocked = await requestPin('unlock');
    if (!unlocked) {
      document.getElementById('privateContent').innerHTML = '<div class="empty-card">上课记录已经锁好啦。点击顶部小锁重新解锁。</div>';
      return;
    }
  }
  await loadClasses();
}

async function loadClasses(showSuccess = false) {
  const content = document.getElementById('privateContent');
  content.innerHTML = '<div class="loading-card">正在翻开多乐的课程手账...</div>';
  document.getElementById('refreshButton').disabled = true;
  try {
    const response = await fetch(`/api/classes?year=${selectedYear}`, { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw apiError(data, '上课记录读取失败');
    courses = Array.isArray(data.courses) ? data.courses : [];
    records = Array.isArray(data.records) ? data.records : [];
    profile = data.profile || profile;
    summary = data.summary || {};
    populateCourseInput();
    render();
    if (showSuccess) showToast('上课记录已刷新');
  } catch (error) {
    if (error.code === 'AUTH_REQUIRED') {
      authorized = false;
      mountNav();
    }
    content.innerHTML = `<div class="empty-card">${escapeHtml(error.message)}<br><button class="secondary-command" type="button" id="retryButton">重新读取</button></div>`;
    document.getElementById('retryButton')?.addEventListener('click', () => loadClasses());
  } finally { document.getElementById('refreshButton').disabled = false; }
}

function render() {
  document.getElementById('privateContent').innerHTML = `<section class="overview-grid">
    <article class="profile-board">${renderProfile()}</article>
    <article class="calendar-board">${renderCalendar()}</article>
  </section>
  <section class="heatmap-board">${renderHeatmap()}</section>
  <section id="recordsBoard" class="records-board">${renderRecords()}</section>`;
  bindDynamicEvents();
}

function renderProfile() {
  const favorite = courses.find((course) => course.id === summary.favoriteCourseId);
  return `<div class="avatar-wrap">${profile.avatarUrl ? `<img src="${profile.avatarUrl}" alt="${escapeHtml(profile.name)}的头像" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span class="avatar-placeholder" hidden>🎀</span>` : '<span class="avatar-placeholder">🎀</span>'}</div>
    <h2 class="profile-name">${escapeHtml(profile.name)}的课程手账</h2>
    <div class="profile-stats">
      <div class="profile-stat"><strong>${summary.completedCount || 0}</strong><span>完成课程</span></div>
      <div class="profile-stat"><strong>${summary.activeDays || 0}</strong><span>上课天数</span></div>
      <div class="profile-stat"><strong>${favorite ? `${courseIcon(favorite)} ${escapeHtml(favorite.name)}` : '待解锁'}</strong><span>最常参加</span></div>
      <div class="profile-stat"><strong>${summary.currentWeekStreak || 0}</strong><span>连续上课周</span></div>
    </div>`;
}

function renderCalendar() {
  const first = new Date(selectedYear, selectedMonth, 1);
  const days = new Date(selectedYear, selectedMonth + 1, 0).getDate();
  const leading = (first.getDay() + 6) % 7;
  const today = dateKey(new Date());
  const cells = Array.from({ length: leading }, () => '<button class="calendar-day is-empty" type="button" disabled></button>');
  for (let day = 1; day <= days; day += 1) {
    const key = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayRecords = records.filter((record) => dateKey(record.start) === key);
    const dots = dayRecords.slice(0, 4).map((record) => `<span class="day-dot ${statusDotClass(record.status)}" style="--course-color:${courseColor(record.course)}"></span>`).join('');
    cells.push(`<button class="calendar-day ${key === today ? 'is-today' : ''} ${key === selectedDate ? 'is-selected' : ''}" type="button" data-date="${key}" title="${dayRecords.length ? `${dayRecords.length} 节课` : key}"><span>${day}</span><span class="day-dots">${dots}</span></button>`);
  }
  return `<div class="calendar-header"><div><p class="eyebrow">Monthly Calendar</p><h2>本月课程</h2></div><div class="calendar-nav"><button type="button" data-month-step="-1" aria-label="上个月">‹</button><strong>${selectedYear} 年 ${selectedMonth + 1} 月</strong><button type="button" data-month-step="1" aria-label="下个月">›</button></div></div>
    <div class="weekdays">${['一','二','三','四','五','六','日'].map((day) => `<span>${day}</span>`).join('')}</div><div class="month-grid">${cells.join('')}</div>
    <div class="course-legend">${courses.map((course) => `<span class="legend-item"><i class="legend-dot" style="--course-color:${courseColor(course)}"></i>${courseIcon(course)} ${escapeHtml(course.name)}</span>`).join('')}</div>`;
}

function renderHeatmap() {
  const valid = records.filter(isCountedRecord);
  const counts = new Map();
  valid.forEach((record) => counts.set(dateKey(record.start), (counts.get(dateKey(record.start)) || 0) + 1));
  const first = new Date(selectedYear, 0, 1);
  const offset = (first.getDay() + 6) % 7;
  const daysInYear = new Date(selectedYear, 1, 29).getMonth() === 1 ? 366 : 365;
  const cells = [];
  for (let index = 0; index < daysInYear; index += 1) {
    const date = new Date(selectedYear, 0, index + 1);
    const key = `${selectedYear}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const position = offset + index;
    const count = counts.get(key) || 0;
    const courseNames = [...new Set(valid.filter((record) => dateKey(record.start) === key).map((record) => record.course?.name).filter(Boolean))];
    cells.push(`<button class="heat-cell ${key === selectedDate ? 'is-selected' : ''}" style="grid-column:${Math.floor(position / 7) + 2};grid-row:${position % 7 + 2}" type="button" data-date="${key}" data-level="${Math.min(count, 3)}" title="${key} · ${count} 节课${courseNames.length ? ` · ${courseNames.join('、')}` : ''}"></button>`);
  }
  const monthLabels = Array.from({ length: 12 }, (_, month) => {
    const date = new Date(selectedYear, month, 1);
    const index = Math.round((date - first) / 86400000) + offset;
    return `<span class="heat-label" style="grid-column:${Math.floor(index / 7) + 2};grid-row:1">${month + 1}月</span>`;
  }).join('');
  const weekdayLabels = ['一','二','三','四','五','六','日'].map((day, index) => `<span class="heat-label heat-weekday" style="grid-column:1;grid-row:${index + 2}">${day}</span>`).join('');
  return `<div class="section-heading"><div><p class="eyebrow">Year In Color</p><h2>${selectedYear} 年课程热力图</h2></div><div class="heatmap-summary">${summary.completedCount || 0} 节课 · ${summary.activeDays || 0} 天 · 最忙 ${summary.busiestMonth ? `${summary.busiestMonth} 月` : '待解锁'}</div></div><div class="heatmap-scroll"><div class="heatmap">${monthLabels}${weekdayLabels}${cells.join('')}</div></div>`;
}

function renderRecords() {
  const filtered = records.filter((record) => {
    if (selectedDate && dateKey(record.start) !== selectedDate) return false;
    if (courseFilter !== '全部' && record.courseId !== courseFilter) return false;
    if (monthFilter !== '全部' && dateKey(record.start).slice(5, 7) !== monthFilter) return false;
    if (statusFilter !== '全部' && record.status !== statusFilter) return false;
    return true;
  });
  const courseFilters = `<button class="filter-chip ${courseFilter === '全部' ? 'is-active' : ''}" data-course-filter="全部" type="button">全部课程</button>${courses.map((course) => `<button class="filter-chip ${courseFilter === course.id ? 'is-active' : ''}" data-course-filter="${course.id}" type="button">${courseIcon(course)} ${escapeHtml(course.name)}</button>`).join('')}`;
  const availableMonths = [...new Set(records.map((record) => dateKey(record.start).slice(5, 7)))].sort();
  const monthFilters = `<button class="filter-chip ${monthFilter === '全部' ? 'is-active' : ''}" data-month-filter="全部" type="button">全部月份</button>${availableMonths.map((month) => `<button class="filter-chip ${monthFilter === month ? 'is-active' : ''}" data-month-filter="${month}" type="button">${Number(month)} 月</button>`).join('')}`;
  const statusFilters = VALID_STATUSES.map((status) => `<button class="filter-chip ${statusFilter === status ? 'is-active' : ''}" data-status-filter="${status}" type="button">${status}</button>`).join('');
  return `<div class="records-heading"><div><p class="eyebrow">Class Memories</p><h2>${selectedDate ? `${selectedDate} 的记录` : '闪闪上课记'}</h2></div>${selectedDate ? '<button id="clearDateButton" class="secondary-command" type="button">清除日期</button>' : ''}</div>
    <div class="filter-row">${courseFilters}</div><div class="filter-row">${monthFilters}</div><div class="filter-row">${statusFilters}</div>
    <div class="record-list">${filtered.length ? filtered.map(renderRecord).join('') : '<div class="empty-card">这个筛选下还没有记录。</div>'}</div>`;
}

function renderRecord(record) {
  const course = record.course || courses.find((item) => item.id === record.courseId);
  const media = (record.media || []).slice(0, 3).map((item, index) => `<button class="record-thumb" type="button" data-media-record="${record.id}" data-media-index="${index}" aria-label="查看 ${escapeHtml(item.name)}">${item.type === 'video' ? `<video src="${item.url}#t=0.1" muted preload="metadata"></video>` : `<img src="${item.url}" alt="" loading="lazy">`}</button>`).join('');
  return `<article class="class-record"><div class="record-icon" style="--course-soft:${courseSoft(course)}">${courseIcon(course)}</div><div><div class="record-title">${escapeHtml(course?.name || '课程')}<span class="status-pill">${escapeHtml(record.status)}</span></div><div class="record-meta">${formatDateTime(record.start)}${record.duration ? ` · ${record.duration} 分钟` : ''}${record.location ? ` · ${escapeHtml(record.location)}` : ''}</div>${record.content ? `<div class="record-copy">${escapeHtml(record.content)}</div>` : ''}${record.comment ? `<div class="record-copy">💬 ${escapeHtml(record.comment)}</div>` : ''}${media ? `<div class="record-media">${media}${record.media.length > 3 ? `<span class="status-pill">+${record.media.length - 3}</span>` : ''}</div>` : ''}</div><time class="record-date">${dateKey(record.start).slice(5).replace('-', ' / ')}</time></article>`;
}

function bindDynamicEvents() {
  document.querySelectorAll('[data-month-step]').forEach((button) => button.addEventListener('click', () => changeMonth(Number(button.dataset.monthStep))));
  document.querySelectorAll('[data-date]').forEach((button) => button.addEventListener('click', () => selectDate(button.dataset.date)));
  document.querySelectorAll('[data-course-filter]').forEach((button) => button.addEventListener('click', () => { courseFilter = button.dataset.courseFilter; render(); }));
  document.querySelectorAll('[data-month-filter]').forEach((button) => button.addEventListener('click', () => { monthFilter = button.dataset.monthFilter; render(); }));
  document.querySelectorAll('[data-status-filter]').forEach((button) => button.addEventListener('click', () => { statusFilter = button.dataset.statusFilter; render(); }));
  document.getElementById('clearDateButton')?.addEventListener('click', () => { selectedDate = ''; render(); });
  document.querySelectorAll('[data-media-record]').forEach((button) => button.addEventListener('click', () => openMedia(button.dataset.mediaRecord, Number(button.dataset.mediaIndex))));
}

function changeMonth(step) {
  const next = new Date(selectedYear, selectedMonth + step, 1);
  if (next.getFullYear() !== selectedYear) {
    selectedYear = next.getFullYear(); selectedMonth = next.getMonth(); selectedDate = '';
    document.getElementById('yearSelect').value = String(selectedYear); loadClasses();
  } else { selectedMonth = next.getMonth(); selectedDate = ''; render(); }
}

function selectDate(value) {
  selectedDate = selectedDate === value ? '' : value;
  if (selectedDate) selectedMonth = Number(selectedDate.slice(5, 7)) - 1;
  render();
  document.getElementById('recordsBoard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function openRecordForm() {
  if (!authorized) return ensureAuthorized().then((ok) => { if (ok) openRecordForm(); });
  const form = document.getElementById('recordForm');
  if (!recordDraftInitialized) {
    form.reset(); selectedFiles = []; renderSelectedFiles();
    form.elements.start.value = toLocalInputValue(beijingNow());
    form.elements.status.value = '已完成';
    applyCourseDefaults();
    recordDraftInitialized = true;
  }
  document.getElementById('recordError').textContent = '';
  document.getElementById('recordDialog').showModal();
}

async function submitRecord(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const pin = await requestPin('save');
  if (!pin) return;
  const payload = Object.fromEntries(new FormData(form));
  payload.start = localInputToIso(form.elements.start.value);
  payload.end = form.elements.end.value ? localInputToIso(form.elements.end.value) : '';
  payload.duration = Number(payload.duration || 0);
  payload.pin = pin;
  const button = document.getElementById('saveRecordButton');
  uploadInProgress = true; setRecordFormLocked(true); button.textContent = '保存记录中...';
  try {
    if (!pendingRecordId) {
      const response = await fetch('/api/classes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw apiError(data, '记录保存失败');
      pendingRecordId = data.record.id;
    }
    if (selectedFiles.length) {
      button.textContent = '上传媒体中...';
      await uploadClassMedia(pendingRecordId);
    }
    document.getElementById('recordDialog').close(); selectedFiles = []; uploadStates = []; pendingRecordId = ''; form.reset(); recordDraftInitialized = false;
    await loadClasses();
    showToast('上课记录已保存');
  } catch (error) {
    const errorElement = document.getElementById('recordError');
    errorElement.textContent = error.message;
    errorElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    showToast(error.message);
  }
  finally { uploadInProgress = false; setRecordFormLocked(false); button.textContent = '保存记录'; }
}

const UPLOAD_CHUNK_SIZE = 10 * 1024 * 1024;

async function uploadClassMedia(recordId) {
  if (!uploadStates.length) uploadStates = selectedFiles.map((file) => ({ file, loaded: 0, status: '等待上传', nextPart: 0, session: null }));
  renderSelectedFiles();
  for (let index = 0; index < uploadStates.length; index += 1) {
    const state = uploadStates[index];
    if (state.status === '上传完成') continue;
    const numberOfParts = Math.ceil(state.file.size / UPLOAD_CHUNK_SIZE);
    if (!state.session) {
      state.status = '准备上传'; renderSelectedFiles();
      state.session = await postJson('/api/class-uploads/start', {
        recordId, filename: state.file.name, contentType: state.file.type, size: state.file.size, numberOfParts,
      });
    }
    for (let part = state.nextPart; part < numberOfParts; part += 1) {
      const start = part * UPLOAD_CHUNK_SIZE;
      const chunk = state.file.slice(start, Math.min(start + UPLOAD_CHUNK_SIZE, state.file.size));
      state.status = `上传第 ${part + 1}/${numberOfParts} 片`; renderSelectedFiles();
      await uploadChunkWithRetry(state.session, part + 1, chunk, (loaded) => {
        state.loaded = start + loaded; renderUploadProgress();
      });
      state.nextPart = part + 1; state.loaded = start + chunk.size; renderUploadProgress();
    }
    state.status = '正在保存'; renderSelectedFiles();
    await postJson(`/api/class-uploads/${state.session.uploadId}/complete`, { token: state.session.token });
    state.loaded = state.file.size; state.status = '上传完成'; renderSelectedFiles();
  }
}

async function uploadChunkWithRetry(session, partNumber, chunk, onProgress) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await uploadChunk(session, partNumber, chunk, onProgress); }
    catch (error) { lastError = error; if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1))); }
  }
  throw lastError;
}

function uploadChunk(session, partNumber, chunk, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/class-uploads/${session.uploadId}/parts/${partNumber}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-Upload-Token', session.token);
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(event.loaded); };
    xhr.onload = () => {
      let data = {}; try { data = JSON.parse(xhr.responseText || '{}'); } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data); else reject(apiError(data, '文件分片上传失败'));
    };
    xhr.onerror = () => reject(new Error('网络中断，文件上传失败'));
    xhr.send(chunk);
  });
}

function setRecordFormLocked(locked) {
  document.querySelectorAll('#recordForm input, #recordForm select, #recordForm textarea, #recordForm button').forEach((element) => { element.disabled = locked; });
}

function addFiles(fileList) {
  for (const file of fileList) {
    if (selectedFiles.length >= 5) break;
    if (!selectedFiles.some((item) => item.name === file.name && item.size === file.size)) selectedFiles.push(file);
  }
  renderSelectedFiles();
}

function renderSelectedFiles() {
  document.getElementById('selectedMedia').innerHTML = selectedFiles.map((file, index) => {
    const state = uploadStates[index]; const percent = state ? Math.round(state.loaded / file.size * 100) : 0;
    return `<div class="selected-file"><div class="selected-file-heading"><span>${escapeHtml(file.name)}</span><small>${formatFileSize(file.size)}</small>${uploadInProgress || pendingRecordId ? '' : `<button type="button" data-remove-file="${index}" aria-label="移除">×</button>`}</div>${state ? `<div class="file-progress"><progress value="${percent}" max="100"></progress><span>${percent}% · ${escapeHtml(state.status)}</span></div>` : ''}</div>`;
  }).join('');
  document.querySelectorAll('[data-remove-file]').forEach((button) => button.addEventListener('click', () => { selectedFiles.splice(Number(button.dataset.removeFile), 1); renderSelectedFiles(); }));
  renderUploadProgress();
}

function renderUploadProgress() {
  const container = document.getElementById('overallUpload');
  if (!uploadStates.length) { container.hidden = true; return; }
  const total = uploadStates.reduce((sum, state) => sum + state.file.size, 0);
  const loaded = uploadStates.reduce((sum, state) => sum + state.loaded, 0);
  const percent = total ? Math.round(loaded / total * 100) : 0;
  container.hidden = false; container.querySelector('progress').value = percent; container.querySelector('strong').textContent = `${percent}%`;
  uploadStates.forEach((state, index) => {
    const row = document.querySelectorAll('.selected-file')[index]; if (!row) return;
    const value = state.file.size ? Math.round(state.loaded / state.file.size * 100) : 0;
    row.querySelector('progress').value = value; row.querySelector('.file-progress span').textContent = `${value}% · ${state.status}`;
  });
}

function formatFileSize(bytes) { const units = ['B', 'KB', 'MB', 'GB']; let value = bytes; let unit = 0; while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; } return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`; }

function populateCourseInput() {
  const input = document.getElementById('courseInput');
  input.innerHTML = courses.map((course) => `<option value="${course.id}">${courseIconText(course)} ${escapeHtml(course.name)}</option>`).join('');
}

function applyCourseDefaults() {
  const form = document.getElementById('recordForm');
  const course = courses.find((item) => item.id === form.elements.courseId.value) || courses[0];
  if (!course) return;
  if (!form.elements.duration.value) form.elements.duration.value = course.defaultDuration || '';
  if (!form.elements.location.value) form.elements.location.value = course.location || '';
}

function openMedia(recordId, index) {
  const record = records.find((item) => item.id === recordId); const media = record?.media?.[index]; if (!media) return;
  document.getElementById('mediaTitle').textContent = media.name || '课堂回忆';
  document.getElementById('mediaViewer').innerHTML = media.type === 'video' ? `<video src="${media.url}" controls autoplay playsinline></video>` : `<img src="${media.url}" alt="${escapeHtml(media.name)}">`;
  document.getElementById('mediaDialog').showModal();
}

function closeMedia() { document.getElementById('mediaViewer').innerHTML = ''; document.getElementById('mediaDialog').close(); }

function requestPin(mode) {
  if (pinRequest) return Promise.resolve(null);
  document.getElementById('pinTitle').textContent = mode === 'unlock' ? '家长解锁' : '确认保存';
  document.getElementById('pinHint').textContent = mode === 'unlock' ? '输入家长 PIN 后查看上课记录。' : '新增上课记录需要家长再次确认。';
  document.getElementById('pinError').textContent = ''; document.getElementById('pinForm').reset(); document.getElementById('pinDialog').showModal();
  setTimeout(() => document.getElementById('pinInput').focus(), 30);
  return new Promise((resolve) => { pinRequest = { mode, resolve }; });
}

function finishPin(value) { if (!pinRequest) return; const resolve = pinRequest.resolve; pinRequest = null; document.getElementById('pinDialog').close(); resolve(value); }

async function submitPin(event) {
  event.preventDefault(); const pin = document.getElementById('pinInput').value.trim();
  if (pinRequest?.mode === 'save') return finishPin(pin);
  try { await postJson('/api/auth/login', { pin }); authorized = true; mountNav(); finishPin(true); showToast('这台设备已解锁'); }
  catch (error) { document.getElementById('pinError').textContent = error.message; }
}

async function ensureAuthorized() { if (authorized) return true; return Boolean(await requestPin('unlock')); }

async function toggleAuthorization() {
  if (!authorized) { if (await ensureAuthorized()) await loadClasses(); return; }
  try { await postJson('/api/auth/logout', {}); authorized = false; courses = []; records = []; selectedFiles = []; uploadStates = []; pendingRecordId = ''; recordDraftInitialized = false; document.getElementById('recordForm').reset(); mountNav(); document.getElementById('privateContent').innerHTML = '<div class="empty-card">这台设备已经锁定。</div>'; showToast('这台设备已锁定'); }
  catch (error) { showToast(error.message); }
}

async function postJson(path, payload) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await response.json().catch(() => ({})); if (!response.ok) throw apiError(data, '操作失败'); return data;
}

function setupEvents() {
  document.getElementById('refreshButton').addEventListener('click', () => loadClasses(true));
  document.getElementById('addRecordButton').addEventListener('click', openRecordForm); document.getElementById('mobileAddButton').addEventListener('click', openRecordForm);
  document.getElementById('yearSelect').addEventListener('change', (event) => { selectedYear = Number(event.target.value); selectedMonth = selectedYear === beijingNow().getFullYear() ? beijingNow().getMonth() : 0; selectedDate = ''; loadClasses(); });
  document.getElementById('recordForm').addEventListener('submit', submitRecord); document.getElementById('courseInput').addEventListener('change', applyCourseDefaults);
  document.getElementById('closeRecordButton').addEventListener('click', () => { if (!uploadInProgress) document.getElementById('recordDialog').close(); }); document.getElementById('cancelRecordButton').addEventListener('click', () => { if (!uploadInProgress) document.getElementById('recordDialog').close(); });
  document.getElementById('cameraInput').addEventListener('change', (event) => addFiles(event.target.files)); document.getElementById('galleryInput').addEventListener('change', (event) => addFiles(event.target.files));
  document.getElementById('pinForm').addEventListener('submit', submitPin); document.getElementById('cancelPinButton').addEventListener('click', () => finishPin(null));
  document.getElementById('pinDialog').addEventListener('cancel', (event) => { event.preventDefault(); finishPin(null); });
  document.getElementById('closeMediaButton').addEventListener('click', closeMedia); document.getElementById('mediaDialog').addEventListener('cancel', (event) => { event.preventDefault(); closeMedia(); });
}

function initializeYears() { const current = beijingNow().getFullYear(); document.getElementById('yearSelect').innerHTML = Array.from({ length: current - 2021 }, (_, index) => current - index).map((year) => `<option value="${year}">${year}</option>`).join(''); }
function isCountedRecord(record) { return record.status === '已完成' || record.status === '试听'; }
function courseIcon(course) { if (!course?.icon) return '⭐'; return course.icon.type === 'emoji' ? escapeHtml(course.icon.value) : `<img class="course-inline-icon" src="${escapeHtml(course.icon.value)}" alt="">`; }
function courseIconText(course) { return course?.icon?.type === 'emoji' ? course.icon.value : '⭐'; }
function courseColor(course) { return COLOR_MAP[course?.color] || COLOR_MAP['粉色']; }
function courseSoft(course) { return `${courseColor(course)}33`; }
function statusDotClass(status) { if (status === '计划中') return 'is-planned'; if (status === '请假' || status === '取消') return 'is-muted'; return ''; }
function formatDateTime(value) { return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }
function toLocalInputValue(date) { const pad = (value) => String(value).padStart(2, '0'); return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`; }
function localInputToIso(value) { return new Date(`${value}:00+08:00`).toISOString(); }
function apiError(data, fallback) { const error = new Error(data.error || fallback); error.code = data.code || ''; return error; }
function escapeHtml(value) { return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;'); }
function showToast(message) { const toast = document.getElementById('toast'); toast.textContent = message; toast.classList.add('show'); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove('show'), 2400); }

initializeYears(); mountNav(); setupEvents(); loadAuth();
