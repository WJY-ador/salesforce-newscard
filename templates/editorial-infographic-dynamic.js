(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DynamicEditorialInfographic = factory();
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

  function renderBody(section) {
    if (section.type === 'compare') {
      return '<div class="compare-rows">' + section.rows.map(row =>
        '<div class="compare-row"><b>' + esc(row[0]) + '</b><span>' + esc(row[1]) + '</span></div>'
      ).join('') + '</div>';
    }
    if (section.type === 'flow') {
      return '<div class="flow-steps">' + section.steps.map((step, i) =>
        '<div class="flow-step"><b>' + (i + 1) + '</b><span>' + esc(step) + '</span></div>' +
        (i < section.steps.length - 1 ? '<i>→</i>' : '')
      ).join('') + '</div>';
    }
    if (section.type === 'note') {
      return '<p class="note-body">' + esc(section.body) + '</p><small class="source">' + esc(section.source) + '</small>';
    }
    return '<ul>' + (section.items || []).map(item => '<li><span class="bullet">✓</span><span>' + esc(item) + '</span></li>').join('') + '</ul>';
  }

  function renderSection(section, index) {
    return '<section class="dynamic-section tone-' + esc(section.tone) + (section.full ? ' full' : '') + '" data-index="' + index + '">' +
      '<header><span class="section-mark">' + (index + 1) + '</span><h2>' + esc(section.title) + '</h2></header>' +
      renderBody(section) +
    '</section>';
  }

  function renderDynamicEditorialInfographic(card, assets) {
    var bg = assets && assets.background;
    if (!bg) return '';
    // full 모드는 GPT가 텍스트까지 그린 완성 카드다 — 코드는 아무것도 얹지 않는다.
    // 텍스트 정확성은 발송 전 사람·Claude의 원문 대조 교정이 책임진다.
    if ((assets && assets.layoutMode) === 'full') {
      return '<main class="editorial-infographic-full">' +
        '<img class="full-card" src="' + esc(bg) + '" alt="' + esc(card.title) + '">' +
      '</main>';
    }
    // panels 모드는 GPT 배경이 패널까지 그렸다는 계약이다 — 코드는 패널 상자를
    // 다시 그리지 않고 텍스트만 같은 존에 얹는다.
    var mode = (assets && assets.layoutMode) === 'panels' ? ' panels-mode' : '';
    return '<main class="editorial-infographic-dynamic' + mode + '">' +
      '<img class="dynamic-skin" src="' + esc(bg) + '" alt="저채도 카드뉴스 장식 배경">' +
      '<section class="dynamic-header"><span>' + esc(card.eyebrow || '') + '</span><h1>' + esc(card.title) + '</h1><p>' + esc(card.lead) + '</p></section>' +
      '<div class="dynamic-grid">' + (card.sections || []).map(renderSection).join('') + '</div>' +
    '</main>';
  }

  return { renderDynamicEditorialInfographic };
});
