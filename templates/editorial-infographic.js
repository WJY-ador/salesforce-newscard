(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EditorialInfographic = factory();
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

  function renderItems(items) {
    return '<ul>' + (items || []).map(item => '<li><span class="check">✓</span><span>' + esc(item) + '</span></li>').join('') + '</ul>';
  }

  function renderPanel(panel, index) {
    var body = panel.steps
      ? '<div class="flow">' + panel.steps.map((step, i) =>
          '<span class="flow-step"><b>' + (i + 1) + '</b><em>' + esc(step) + '</em></span>' +
          (i < panel.steps.length - 1 ? '<i class="arrow">→</i>' : '')
        ).join('') + '</div>'
      : renderItems(panel.items);
    return '<section class="info-panel tone-' + esc(panel.tone) + ' panel-' + (index + 1) + '">' +
      '<header><span class="panel-icon">' + (index + 1) + '</span><h2>' + esc(panel.title) + '</h2></header>' +
      body +
      '</section>';
  }

  function renderEditorialInfographic(card, assets) {
    var bg = assets && assets.background;
    if (!bg) return '';
    return '<main class="editorial-infographic">' +
      '<img class="infographic-bg" src="' + esc(bg) + '" alt="저채도 카드뉴스 인포그래픽 배경">' +
      '<section class="headline-area"><span class="eyebrow">SUMMER ’26 · RELEASE UPDATE</span>' +
        '<h1>' + esc(card.title) + '</h1><p>' + esc(card.lead) + '</p></section>' +
      '<div class="panel-grid">' + card.panels.map(renderPanel).join('') + '</div>' +
      '<section class="takeaway"><span class="takeaway-label">한 줄 요약</span><strong>' + esc(card.takeaway) + '</strong><small>' + esc(card.source) + '</small></section>' +
    '</main>';
  }

  return { renderEditorialInfographic };
});
