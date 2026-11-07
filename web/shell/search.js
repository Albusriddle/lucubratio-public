/* ============================================================
   Lucubratio · 全文搜索
   索引：构建期生成的 /search.json（346 节 / ~740KB）
   匹配：空格切词 → 全部命中（AND）→ 标题权重更高
   为什么不用 Pagefind：正文只有 400KB，引 wasm 不值当，也避开 wasm MIME 的坑
   ============================================================ */
import { initTheme } from './theme.js';

(function () {
  'use strict';

  initTheme();

  var $ = function (id) { return document.getElementById(id); };

  var index = null;
  var loading = null;
  var timer = null;

  function loadIndex() {
    if (index) return Promise.resolve(index);
    if (loading) return loading;
    loading = fetch('/search.json')
      .then(function (r) { return r.json(); })
      .then(function (j) {
        index = j;
        return j;
      })
      .catch(function (e) {
        loading = null;
        throw e;
      });
    return loading;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function escapeReg(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /** 按词命中数打分；任一关键词未命中则淘汰 */
  function scoreSection(sec, tokens, pageTitle) {
    var hay = (sec.h + ' ' + sec.x).toLowerCase();
    var score = 0;
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (hay.indexOf(t) < 0) return -1;
      if (sec.h && sec.h.toLowerCase().indexOf(t) >= 0) score += 12;
      if (pageTitle && pageTitle.toLowerCase().indexOf(t) >= 0) score += 6;
      var from = 0, hits = 0;
      while (hits < 20) {
        var at = hay.indexOf(t, from);
        if (at < 0) break;
        hits++;
        from = at + t.length;
      }
      score += hits;
    }
    return score;
  }

  function snippet(text, tokens) {
    var lower = text.toLowerCase();
    var at = -1;
    for (var i = 0; i < tokens.length; i++) {
      var p = lower.indexOf(tokens[i]);
      if (p >= 0 && (at < 0 || p < at)) at = p;
    }
    if (at < 0) at = 0;
    var start = Math.max(0, at - 36);
    var end = Math.min(text.length, start + 150);
    var raw = (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
    var safe = escapeHtml(raw);
    for (var j = 0; j < tokens.length; j++) {
      safe = safe.replace(new RegExp(escapeReg(escapeHtml(tokens[j])), 'gi'), function (m) {
        return '<mark>' + m + '</mark>';
      });
    }
    return safe;
  }

  function render(list, tokens) {
    var box = $('results');
    var tips = $('tips');

    if (!tokens.length) {
      box.innerHTML = '';
      $('hint').textContent = '';
      tips.hidden = false;
      return;
    }
    tips.hidden = true;

    if (!list.length) {
      box.innerHTML = '';
      $('hint').textContent = '没有找到「' + tokens.join(' ') + '」';
      return;
    }

    $('hint').textContent = '找到 ' + list.length + ' 处';

    var html = '';
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      var page = (index.pages && index.pages[it.p]) || {};
      var url = encodeURI(page.f || '/') + (it.a ? '#' + encodeURI(it.a) : '');
      var head = it.h || (page.t || '');
      html += '<a class="r" href="' + url + '">' +
                '<div class="rh">' + escapeHtml(head) + '</div>' +
                '<div class="rp">' + escapeHtml(page.t || it.p) +
                  '<span class="tag">' + Math.round(it.score) + ' 分</span></div>' +
                '<div class="rx">' + snippet(it.x, tokens) + '</div>' +
              '</a>';
    }
    box.innerHTML = html;
  }

  function search(raw) {
    var q = String(raw || '').trim();
    var box = $('box');
    if (q) box.classList.add('has-value'); else box.classList.remove('has-value');

    if (!q) {
      render([], []);
      return;
    }
    var tokens = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);

    loadIndex().then(function (idx) {
      var out = [];
      for (var i = 0; i < idx.sections.length; i++) {
        var sec = idx.sections[i];
        var page = (idx.pages && idx.pages[sec.p]) || {};
        var s = scoreSection(sec, tokens, page.t);
        if (s > 0) out.push({ p: sec.p, a: sec.a, h: sec.h, x: sec.x, score: s });
      }
      out.sort(function (a, b) { return b.score - a.score; });
      render(out.slice(0, 30), tokens);
    }).catch(function (e) {
      $('hint').textContent = '索引加载失败：' + (e && e.message);
    });
  }

  function debounce(val) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () { search(val); }, 160);
  }

  var input = $('q');
  input.addEventListener('input', function () { debounce(input.value); });
  input.addEventListener('search', function () { search(input.value); });
  $('clear').addEventListener('click', function () {
    input.value = '';
    input.focus();
    search('');
  });

  // 支持 ?q=xxx 直达
  var m = location.search.match(/[?&]q=([^&]*)/);
  if (m) {
    input.value = decodeURIComponent(m[1].replace(/\+/g, ' '));
  }
  search(input.value);
  if (!input.value) setTimeout(function () { input.focus(); }, 120);
})();
