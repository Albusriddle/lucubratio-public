/* ============================================================
   Lucubratio · 全文搜索
   索引：构建期生成的 /search.json（346 节 / ~740KB）
   匹配：空格切词 → 全部命中（AND）→ 标题权重更高
   为什么不用 Pagefind：正文只有 400KB，引 wasm 不值当，也避开 wasm MIME 的坑
   ============================================================ */
import { initTheme } from './theme.js';
import { loadSearchIndex } from './library.js';

(function () {
  'use strict';

  initTheme();

  var $ = function (id) { return document.getElementById(id); };

  var index = null;
  var loading = null;
  var timer = null;

  /* 示例词：从当前索引的小节标题里取「完整词段」按词频选 5 个
     为什么这么做：写死的示例只能服务一门课；而按 n-gram 滑窗又会切出「错点」「本仓库的」
     这类碎片（0.3.14 的教训）。这里的规则是：标题按标点切段 → 去编号 → 只收 2–4 字中文
     或 ≥2 字母英文 → 过滤结构词 → 需出现 ≥2 次；凑不满 3 个就整块隐藏，宁可不给也不给废话。 */
  var TIP_STOP = {};
  ('检测 易错点 选择题 填空题 计算题 简答题 满分 分钟 清单 约为 格式 关于 本仓库 自评单元 ' +
   '本章讲什么 正文展开 随堂检测 实验步骤清单 自测方式 怎么用这张卡 必背结论 小结 总结 本节 习题 练习')
    .split(' ').forEach(function (w) { TIP_STOP[w] = 1; });

  function buildTips(j) {
    var box = $('tips');
    if (!box) return;
    var freq = {}, order = [];
    (j && j.sections ? j.sections : []).forEach(function (sec) {
      var h = String((sec && sec.h) || '').replace(/^\s*[\d一二三四五六七八九十]+([.\-、]\d*)*\s*/, '');
      h.split(/[\s，,。.、；;：:（）()\[\]【】「」“”"'’/·\-—]+/).forEach(function (seg) {
        seg = seg.trim();
        if (!seg || TIP_STOP[seg]) return;
        if (seg.length < 2 || seg.length > 6) return;
        var isEn = /^[A-Za-z][A-Za-z0-9.\-]+$/.test(seg);
        var isZh = /^[\u4e00-\u9fa5]{2,4}$/.test(seg);
        if (!isEn && !isZh) return;
        var key = isEn ? seg.toLowerCase() : seg;   // 英文去重不区分大小写，显示保留首次形态
        if (!freq[key]) { freq[key] = { n: 0, s: seg }; order.push(key); }
        freq[key].n += 1;
      });
    });
    var words = order
      .filter(function (k) { return freq[k].n >= 2; })
      .sort(function (a, b) {
        return freq[b].n - freq[a].n || freq[a].s.length - freq[b].s.length;
      })
      .slice(0, 5)
      .map(function (k) { return freq[k].s; });
    if (words.length < 3) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = '<b>试试这些：</b><br>' + words.map(function (w) {
      var text = typeof escapeHtml === 'function' ? escapeHtml(w) : w;   // 标题来自内容包，一律按文本插入
      return '<a href="?q=' + encodeURIComponent(w) + '">' + text + '</a>';
    }).join(' · ');
  }

  function loadIndex() {
    if (index) return Promise.resolve(index);
    if (loading) return loading;
    // 内置 + 已导入课程合并（Step 9）
    loading = loadSearchIndex()
      .then(function (j) {
        index = j;
        buildTips(j);
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
      // 只有当示例块真的有内容时才显示（buildTips 可能因「没有合适词」把它清空并隐藏）
      tips.hidden = !tips.innerHTML.trim();
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
