const NAV_ITEMS = [
  { id: 'home', label: '星星屋', icon: '⭐', href: '/' },
  { id: 'classes', label: '上课记录', icon: '📅', href: '/classes', protected: true },
];

export function mountSharedNav({ current, authorized, soundEnabled, onAuthToggle, onSoundToggle, onProtectedNavigate }) {
  const root = document.getElementById('siteNav');
  if (!root) return;
  root.innerHTML = `<div class="site-nav-inner">
    <a class="site-brand" href="/" aria-label="多乐成长空间首页"><span>🎀</span><strong>多乐成长空间</strong></a>
    <button class="nav-menu-button" type="button" aria-expanded="false" aria-controls="navMenu" aria-label="打开导航">☰</button>
    <div id="navMenu" class="nav-menu">
      <div class="nav-links">${NAV_ITEMS.map((item) => `<a class="nav-link ${item.id === current ? 'is-current' : ''}" href="${item.href}" data-nav-id="${item.id}" ${item.protected ? 'data-protected="true"' : ''} ${item.id === current ? 'aria-current="page"' : ''}><span aria-hidden="true">${item.icon}</span>${item.label}</a>`).join('')}</div>
      <div class="nav-actions">
        <button id="navAuthButton" class="nav-icon-button" type="button" aria-label="${authorized ? '锁定此设备' : '解锁此设备'}" title="${authorized ? '锁定此设备' : '解锁此设备'}">${authorized ? '🔓' : '🔒'}</button>
        ${typeof onSoundToggle === 'function' ? `<button id="soundToggle" class="nav-icon-button sound-toggle" type="button" aria-label="${soundEnabled ? '关闭声音' : '开启声音'}" title="${soundEnabled ? '关闭声音' : '开启声音'}"><span id="soundIcon" aria-hidden="true">${soundEnabled ? '🔊' : '🔇'}</span></button>` : ''}
      </div>
    </div>
  </div>`;

  const menuButton = root.querySelector('.nav-menu-button');
  const menu = root.querySelector('.nav-menu');
  const closeMenu = () => {
    menu.classList.remove('is-open');
    menuButton.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('nav-open');
  };
  menuButton.addEventListener('click', () => {
    const open = !menu.classList.contains('is-open');
    menu.classList.toggle('is-open', open);
    menuButton.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('nav-open', open);
  });
  root.querySelectorAll('[data-protected="true"]').forEach((link) => {
    link.addEventListener('click', async (event) => {
      if (authorized) return;
      event.preventDefault();
      closeMenu();
      if (await onProtectedNavigate?.()) window.location.href = link.href;
    });
  });
  root.querySelector('#navAuthButton').addEventListener('click', () => onAuthToggle?.());
  root.querySelector('#soundToggle')?.addEventListener('click', () => onSoundToggle?.());
  root.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMenu(); });
}
