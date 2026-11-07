/* ============================================================
   Lucubratio · 今日复习
   队列：cards 表中 due <= now 的卡片，按到期时间升序
   打分：assess() → FSRS 推进 → 下一张
   ============================================================ */
import { init, dueCards, assess } from './store.js';
import { preview } from './fsrs.js';
import { fmtDueShort } from './time.js';
import { initTheme } from './theme.js';

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var queue = [];
  var idx = 0;
  var total = 0;
  var rated = 0;
  var titles = {};

  function renderProgress() {
    var pct = total ? Math.round((rated / total) * 100) : 0;
    $('prog').style.width = pct + '%';
  }

  function show(el) {
    ['card', 'empty', 'done'].forEach(function (id) {
      $(id).hidden = (id !== el);
    });
  }

  function renderCard() {
    if (idx >= queue.length) {
      $('doneText').textContent = '本次共复习 ' + rated + ' 张，明天见。';
      show('done');
      renderProgress();
      return;
    }

    var card = queue[idx];
    $('meta').innerHTML = '第 <b>' + (idx + 1) + '</b> / ' + queue.length + ' 张 · ' +
      (titles[card.cid] || card.cid) + ' · 已练 ' + (card.reps || 1) + ' 次';
    $('qtext').textContent = card.text || '(无题面)';

    var src = $('src');
    src.href = encodeURI(card.file || '/') + (card.anchor ? '#' + card.anchor : '');

    // 按钮上显示该评分对应的下次间隔
    try {
      var p = preview(card, new Date());
      [1, 2, 3, 4].forEach(function (r) {
        var el = $('d' + r);
        if (!el) return;
        el.textContent = p[r] ? fmtDueShort(p[r].due) : '';
      });
    } catch (e) {
      [1, 2, 3, 4].forEach(function (r) { if ($('d' + r)) $('d' + r).textContent = ''; });
    }

    $('state').textContent = '';
    setBusy(false);
    show('card');
    renderProgress();
  }

  function setBusy(busy) {
    var btns = $('rates').querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) btns[i].disabled = !!busy;
  }

  async function rate(r) {
    var card = queue[idx];
    if (!card) return;
    setBusy(true);
    try {
      await assess({
        qid: card.qid,
        cid: card.cid,
        file: card.file,
        anchor: card.anchor,
        text: card.text,
        rating: r,
        source: 'review',
      });
      rated++;
      idx++;
      renderCard();
    } catch (e) {
      $('state').textContent = '记录失败：' + (e && e.message);
      setBusy(false);
    }
  }

  async function boot() {
    initTheme();
    await init({});

    try {
      var m = await (await fetch('/manifest.json')).json();
      m.groups.forEach(function (g) {
        g.items.forEach(function (i) { titles[i.id] = i.title; });
      });
    } catch (e) { /* 没有标题也能复习 */ }

    queue = await dueCards();
    total = queue.length;

    if (!total) {
      show('empty');
      renderProgress();
      return;
    }
    renderCard();
  }

  $('rates').addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('button[data-r]') : null;
    if (!btn || btn.disabled) return;
    rate(Number(btn.getAttribute('data-r')));
  });

  boot().catch(function (e) {
    $('qtext').textContent = '加载失败：' + (e && e.message);
    $('meta').textContent = '';
    show('card');
  });
})();
