/* ============================================================
   Lucubratio · 开屏页
   - 首页加载期间盖住白屏：logo + 每日一句 + 细进度条
   - 节奏：MIN=500ms（至少停这么久）/ MAX=1000ms（超过就不等了）
       · 就绪早于 500ms  → 等到 500ms 再退
       · 500–1000ms 就绪 → 就绪即退
       · 超过 1000ms      → 强制退场 + 报错（toast + 顶部告警条）
   - 报错内容带上最近 3 条 JS 错误，方便排查
   ============================================================ */
(function () {
  'use strict';

  var MIN = 500;
  var MAX = 1000;

  var now = (window.performance && performance.now)
    ? function () { return performance.now(); }
    : function () { return Date.now(); };

  var t0 = now();
  var appReady = false;    // home.js 是否已经把首屏准备好了
  var splashHidden = false; // 开屏层是否已经消失（跳过也算）
  var skipped = false;      // 用户是否点了"跳过"
  var errors = [];

  var QUOTES = [
    '今天的半小时，抵得上考前的一整夜。',
    '不是记住了才做题，是做题了才记住。',
    '慢一点没关系，别停。',
    '把不会的题抄下来，它就不再是你的敌人。',
    '真正的复习，是把「我懂了」改成「我能写出来」。',
    '一遍记不住就三遍，三遍不行就画成图。',
    '考试考的是熟练度，不是阅读量。',
    '错题本越厚，考场上越稳。',
    '别追求一次看懂，追求第二次不陌生。',
    '所有的临时抱佛脚，都不如每天十分钟。'
  ];

  var els = {};

  function cache() {
    els.splash = document.getElementById('sa-splash');
    els.quote = document.getElementById('sa-splash-quote');
    els.bar = document.getElementById('sa-splash-bar');
    els.warn = document.getElementById('sa-boot-warn');
    els.warnText = document.getElementById('sa-boot-warn-text');
  }

  function push(msg) {
    if (errors.length >= 3) return;
    errors.push(String(msg).replace(/\s+/g, ' ').slice(0, 140));
  }

  window.addEventListener('error', function (e) {
    push('JS 错误: ' + (e && (e.message || e.type)));
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    push('Promise 拒绝: ' + (r && (r.message || r)));
  });

  function quoteOfToday() {
    var d = new Date();
    var key = d.getFullYear() * 372 + d.getMonth() * 31 + d.getDate();
    return QUOTES[key % QUOTES.length];
  }

  function hideSplash() {
    if (splashHidden || !els.splash) return;
    splashHidden = true;
    els.splash.className += ' sa-splash-out';
    setTimeout(function () {
      if (els.splash && els.splash.parentNode) els.splash.parentNode.removeChild(els.splash);
    }, 300);
  }

  function report(msg) {
    try {
      if (window.AndroidSA && window.AndroidSA.toast) window.AndroidSA.toast('启动超过 1 秒，已先进入');
    } catch (e) { /* 非 App 环境忽略 */ }
    if (els.warn && els.warnText) {
      els.warnText.textContent = msg;
      els.warn.hidden = false;
    }
    try { console.error('[splash] ' + msg); } catch (e) {}
  }

  /** home.js 就绪后调用；失败时把错误传进来 */
  window.__saSplashDone = function (err) {
    if (appReady) return;
    var elapsed = now() - t0;
    if (err) push('启动失败: ' + ((err && err.message) || err));
    appReady = true;
    var wait = Math.max(0, MIN - elapsed);
    setTimeout(hideSplash, wait);
  };

  function boot() {
    cache();
    if (!els.splash) return;               // 只在首页有开屏层

    if (els.quote) els.quote.textContent = quoteOfToday();

    var skip = document.getElementById('sa-splash-skip');
    if (skip) {
      skip.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        skipped = true;
        hideSplash();   // 只收起开屏；若后台仍没加载好，1s 后照样会提示
      });
    }
    if (els.bar) {
      els.bar.style.transition = 'width ' + MIN + 'ms linear';
      requestAnimationFrame(function () { els.bar.style.width = '86%'; });
    }

    setTimeout(function () {
      if (appReady) return;
      var msg = '启动超过 ' + MAX + 'ms 仍未就绪（实际 ' + Math.round(now() - t0) + 'ms）';
      if (errors.length) msg += '｜' + errors.join('；');
      report(msg);        // 即使点了跳过也提示：说明后台确实慢/出错
      hideSplash();
    }, MAX);
  }

  var warnClose = document.getElementById('sa-boot-warn-close');
  if (warnClose) {
    warnClose.addEventListener('click', function () {
      var w = document.getElementById('sa-boot-warn');
      if (w) w.hidden = true;
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
