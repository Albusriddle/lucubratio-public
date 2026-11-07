/* ============================================================
   Lucubratio · 主题与字号
   - 偏好在 localStorage（设备级，需要同步读取，不能等 IndexedDB）
   - 深色通过 <html class="sa-dark"> + CSS 变量实现
   - 状态栏颜色通过原生桥 AndroidSA.setTheme 同步
   ============================================================ */

export const THEME_KEY = 'sa:theme';   // auto | light | dark
export const FONT_KEY = 'sa:fs';       // '15' | '16' | '17.5' | '19'
export const FONT_DEFAULT = '16';

export const FONT_LABEL = {
  '15': '小',
  '16': '标准',
  '17.5': '大',
  '19': '特大',
};

export const THEME_LABEL = {
  auto: '跟随系统',
  light: '浅色',
  dark: '深色',
};

function root() {
  return document.documentElement;
}

function prefersDark() {
  return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

export function getTheme() {
  try { return localStorage.getItem(THEME_KEY) || 'auto'; } catch (e) { return 'auto'; }
}

export function isDark(pref) {
  const p = pref || getTheme();
  return p === 'dark' || (p === 'auto' && prefersDark());
}

function notifyNative(dark) {
  if (window.AndroidSA && window.AndroidSA.setTheme) {
    try { window.AndroidSA.setTheme(dark ? 'dark' : 'light'); } catch (e) { /* ignore */ }
  }
}

/** 把主题落到 DOM（不做持久化） */
export function applyTheme(pref) {
  const dark = isDark(pref);
  const r = root();
  if (dark) r.classList.add('sa-dark');
  else r.classList.remove('sa-dark');
  r.setAttribute('data-theme', dark ? 'dark' : 'light');
  r.style.colorScheme = dark ? 'dark' : 'light';
  notifyNative(dark);
  return dark;
}

export function setTheme(pref) {
  try { localStorage.setItem(THEME_KEY, pref); } catch (e) { /* ignore */ }
  return applyTheme(pref);
}

export function getFont() {
  try { return localStorage.getItem(FONT_KEY) || FONT_DEFAULT; } catch (e) { return FONT_DEFAULT; }
}

export function applyFont(px) {
  const v = px || FONT_DEFAULT;
  root().style.setProperty('--sa-fs', v + 'px');
  return v;
}

export function setFont(px) {
  try { localStorage.setItem(FONT_KEY, px); } catch (e) { /* ignore */ }
  return applyFont(px);
}

/** 页面启动时调用：应用一次，并让"跟随系统"能实时响应系统切换 */
export function initTheme() {
  applyTheme(getTheme());
  applyFont(getFont());

  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = function () {
      if (getTheme() === 'auto') applyTheme('auto');
    };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  return { theme: getTheme(), dark: isDark(), font: getFont() };
}
