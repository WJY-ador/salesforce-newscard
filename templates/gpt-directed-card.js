/** GPT Image 2가 만든 공간형 배경 위에 검증된 사실만 얹는 비교 카드 템플릿. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GptDirectedCard = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderGptDirectedCard(c, assets) {
    var bg = assets && assets.background;
    if (!bg) return '';
    return '<main class="gpt-directed-card">' +
      '<img class="gpt-bg" src="' + esc(bg) + '" alt="3D 브릭 마스코트가 릴리스 변경 흐름을 안내하는 장면">' +
      '<section class="gpt-panel gpt-hero">' +
        '<span class="gpt-label">' + esc(c.label) + '</span>' +
        '<h1>' + esc(c.title) + '</h1>' +
        '<p>' + esc(c.lead) + '</p>' +
      '</section>' +
      '<section class="gpt-panel gpt-change">' +
        '<span class="gpt-kicker">변경점</span>' +
        '<div><b>지금</b><span>' + esc(c.before) + '</span></div>' +
        '<i>→</i>' +
        '<div><b>Summer ’26</b><span>' + esc(c.after) + '</span></div>' +
      '</section>' +
      '<section class="gpt-panel gpt-action">' +
        '<span class="gpt-kicker">먼저 할 일</span>' +
        '<ol>' + c.actions.map(function (action, i) {
          return '<li><b>' + (i + 1) + '</b><span>' + esc(action) + '</span></li>';
        }).join('') + '</ol>' +
        '<small>' + esc(c.source) + '</small>' +
      '</section>' +
    '</main>';
  }

  return { renderGptDirectedCard: renderGptDirectedCard };
});
