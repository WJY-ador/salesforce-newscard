/**
 * 연출 배치 판정 — "어디에 몇 마리를 어떤 크기로" 를 계산한다. SVG 는 안 만든다.
 *
 * 위치를 규칙으로 고정하지 않는 것이 목적이다. 마스코트가 늘 같은 자리에 서면
 * 카드가 "같은 양식에 액션만 반복하는 자료"가 된다. 마리 수는 배열 길이가 정하고,
 * 이 모듈은 그 배열이 실제로 그려질 수 있는지만 본다 — 없는 블록을 가리키는
 * 항목을 버리고, 크기 하한을 지키고, viewBox 를 tight 로 할지 정한다.
 *
 * 판단은 여기 없다. 카드를 만드는 세션에서 사람과 Claude 가 정해서 데이터로
 * 남기고, 무인 09:30 렌더는 그 데이터를 읽기만 한다 — 구독은 프로그래매틱
 * 엔드포인트를 안 주므로 무인 실행에 모델 호출을 넣을 수 없다.
 *
 * 설계 근거: docs/superpowers/specs/2026-08-02-mascot-staging-design.md
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BrickStaging = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SLOTS = ['hero', 'figure', 'compare', 'cols', 'warn', 'band'];
  var SIZE_PX = { lg: 178, md: 96, sm: 56 };

  // 밴드는 여러 자세가 한 줄에 서는 자리라 크기를 항목마다 다르게 두면
  // 줄이 들쭉날쭉해진다. 폭이 아니라 높이로 맞춘다.
  var BAND_PX = 72;

  // 위로 크게 뻗는 자세. 56px 로 줄이면 몸통이 뭉갠다.
  var BIG_POSES = ['jump', 'tumble'];

  /**
   * 그 카드에 실제로 존재하는 블록만 돌려준다.
   * figure 와 compare 는 배타다 — templates/card.js 가 figure 가 있으면
   * 전후 2박스를 안 그린다.
   */
  function availableSlots(c) {
    c = c || {};
    var out = ['hero', 'band'];
    out.push(c.figure ? 'figure' : 'compare');
    if ((c.editions && c.editions.length) || (c.todo && c.todo.length)) out.push('cols');
    if (c.warn) out.push('warn');
    return out;
  }

  /**
   * @param {Array} staging  카드가 준 연출 배열 (없으면 0마리)
   * @param {string[]} [available]  그릴 수 있는 자리. 생략하면 전부 허용
   * @returns {{items: Array, warnings: string[]}}
   */
  function planStaging(staging, available) {
    var list = Array.isArray(staging) ? staging : [];
    var warnings = [];
    var items = [];

    // 자리별 마리 수를 먼저 센다. viewBox 규칙이 자리가 아니라 마리 수로 정해진다.
    var counts = {};
    list.forEach(function (s) {
      if (s && s.at) counts[s.at] = (counts[s.at] || 0) + 1;
    });

    list.forEach(function (s) {
      s = s || {};
      if (SLOTS.indexOf(s.at) < 0) {
        warnings.push('알 수 없는 자리 — 건너뛴다: ' + String(s.at));
        return;
      }
      if (available && available.indexOf(s.at) < 0) {
        warnings.push('이 카드에 없는 블록 — 건너뛴다: ' + s.at);
        return;
      }

      var size = SIZE_PX[s.size] ? s.size : 'md';
      var px;
      if (s.at === 'band') {
        size = 'band';
        px = BAND_PX;
      } else {
        if (size === 'sm' && BIG_POSES.indexOf(s.pose) >= 0) {
          warnings.push('big 자세는 sm 에서 뭉갠다 — md 로 올린다: ' + s.pose);
          size = 'md';
        }
        px = SIZE_PX[size];
      }

      items.push({
        at: s.at,
        side: s.side || 'right',
        pose: s.pose,
        expr: s.expr,
        size: size,
        px: px,
        tight: counts[s.at] === 1
      });
    });

    return { items: items, warnings: warnings };
  }

  return {
    planStaging: planStaging,
    availableSlots: availableSlots,
    SLOTS: SLOTS,
    SIZE_PX: SIZE_PX,
    BAND_PX: BAND_PX
  };
});
