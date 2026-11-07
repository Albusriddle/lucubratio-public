/* ============================================================
   Lucubratio · 学习统计
   数据：reviews（复习日志）/ attempts（作答流水）/ cards / progress
   ============================================================ */
import { init, statsDetail } from './store.js';
import { initTheme } from './theme.js';

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function level(count) {
    if (count <= 0) return 0;
    if (count <= 2) return 1;
    if (count <= 5) return 2;
    if (count <= 9) return 3;
    return 4;
  }

  function renderHeatmap(days) {
    var map = {};
    for (var i = 0; i < days.length; i++) map[days[i].date] = days[i].count;

    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var dow = (today.getDay() + 6) % 7;           // 0 = 周一
    var gridStart = today.getTime() - (11 * 7 + dow) * 86400000;

    var html = '';
    for (var c = 0; c < 84; c++) {
      var ts = gridStart + c * 86400000;
      var d = new Date(ts);
      var key = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
      var count = map[key] || 0;
      var future = ts > today.getTime();
      html += '<i data-lv="' + level(count) + '"' + (future ? ' class="future"' : '') +
              ' title="' + key + '：' + (future ? '—' : count + ' 次') + '"></i>';
    }
    $('heat').innerHTML = html;

    var first = new Date(gridStart);
    $('heatFrom').textContent = (first.getMonth() + 1) + '月' + first.getDate() + '日';
  }

  function renderBars(cardStates) {
    var labels = ['新卡', '学习中', '复习中', '重学中'];
    var total = cardStates.reduce(function (a, b) { return a + b; }, 0);
    $('cardTotal').textContent = String(total);

    var max = Math.max.apply(null, cardStates.concat([1]));
    var html = '';
    for (var i = 0; i < 4; i++) {
      var pct = Math.round((cardStates[i] / max) * 100);
      html += '<div class="bar-row">' +
                '<span class="lab">' + labels[i] + '</span>' +
                '<span class="track"><i style="width:' + pct + '%"></i></span>' +
                '<span class="num">' + cardStates[i] + '</span>' +
              '</div>';
    }
    $('bars').innerHTML = html;
  }

  async function boot() {
    initTheme();
    await init({});
    var d = await statsDetail(84);

    $('streak').innerHTML = d.streak + '<span>天</span>';
    $('sub').textContent = d.streak > 0
      ? '保持住，累计 ' + d.reviewTotal + ' 次复习'
      : '今天还没复习，去做一张卡片';

    $('reviews').innerHTML = d.reviewTotal + '<small>次</small>';
    $('acc').innerHTML = d.accuracy === null
      ? '—'
      : Math.round(d.accuracy * 100) + '<small>%</small>';
    $('due').innerHTML = d.due + '<small>张</small>';
    $('read').innerHTML = d.readPages + '<small>篇</small>';

    renderHeatmap(d.days);
    renderBars(d.cardStates);
  }

  boot().catch(function (e) {
    $('sub').textContent = '加载失败：' + (e && e.message);
  });
})();
