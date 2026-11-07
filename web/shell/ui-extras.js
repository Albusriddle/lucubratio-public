/* ============================================================
   Lucubratio · 内容页小增强
   1) 自查清单的复选框：源文件是 <input type="checkbox" disabled>（253 个），
      浏览器按规范直接禁止交互。构建期替换成 .sa-check 按钮，这里负责
      恢复/保存勾选状态（localStorage，与 sa:theme / sa:fs 同一体系）。
   2) 横向滚动容器：加"右边还有内容"的渐变提示，滚到最右自动消失。
   ============================================================ */
(function () {
  'use strict';

  var KEY = 'sa:ck:';

  function readCk(id) {
    try { return localStorage.getItem(KEY + id) === '1'; } catch (e) { return false; }
  }

  function writeCk(id, on) {
    try { localStorage.setItem(KEY + id, on ? '1' : '0'); } catch (e) { /* 隐私模式忽略 */ }
  }

  function onCheckClick(e) {
    e.preventDefault();
    var el = e.currentTarget;
    var next = el.getAttribute('aria-checked') !== 'true';
    el.setAttribute('aria-checked', next ? 'true' : 'false');
    var id = el.getAttribute('data-ck');
    if (id) writeCk(id, next);
  }

  function setupChecks() {
    var boxes = document.querySelectorAll('.sa-check');
    for (var i = 0; i < boxes.length; i++) {
      var el = boxes[i];
      var id = el.getAttribute('data-ck');
      if (id) el.setAttribute('aria-checked', readCk(id) ? 'true' : 'false');
      el.addEventListener('click', onCheckClick);
    }
  }

  function updateHint(el) {
    var more = el.scrollWidth - el.clientWidth;
    if (more <= 2) { el.classList.remove('sa-scroll-hint'); return; }
    var atEnd = el.scrollLeft >= more - 2;
    if (atEnd) el.classList.remove('sa-scroll-hint');
    else el.classList.add('sa-scroll-hint');
  }

  function setupScrollHints() {
    var list = document.querySelectorAll('.table-wrap, .mermaid, .art-wrap');
    for (var i = 0; i < list.length; i++) {
      (function (el) {
        updateHint(el);
        el.addEventListener('scroll', function () { updateHint(el); }, { passive: true });
        if (window.ResizeObserver) {
          new ResizeObserver(function () { updateHint(el); }).observe(el);
        }
      })(list[i]);
    }
  }

  function boot() {
    setupChecks();
    setupScrollHints();
  }

  if (document.readyState === 'complete') setTimeout(boot, 0);
  else window.addEventListener('load', boot);
})();
