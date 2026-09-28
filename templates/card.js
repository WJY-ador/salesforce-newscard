/**
 * 뉴스 카드 템플릿 — admin·developer가 알아야 할 것 중심
 *
 *   deepdive  1건 심층 — 지금→앞으로 대비 · 에디션 · Setup 경로 · 해야 할 일 · 주의
 *   roundup   다건 실무 요약 — 항목별 무엇/요약/할 일 + 자주 쓰는 Setup 경로
 *
 * 이전 버전은 fit 점수와 rubric 분해(적합도·효과·긴급성…)를 실었다. 그건 우리가
 * 무엇을 먼저 볼지 고르는 내부 지표이고, 카드를 읽는 admin·developer에게는
 * 쓸모가 없다. 전부 뺐다. 대신 공식 릴리스 노트의 What / Where / When / How를
 * 실무가 찾는 형태로 재배치한다 — 지금과 뭐가 다른가, 어느 에디션인가,
 * Setup 어디를 눌러야 하나, 뭘 해야 하나.
 *
 * 모든 사실 문장은 content/release-notes.json(공식 원문)에서 온다.
 *
 * 이 카드는 사외로 나간다. 두 가지를 넣지 않는다.
 *   1. 고객사·프로젝트 이름 — 컴플라이언스
 *   2. 내부 해석("우리 분석" 말풍선) — 우리 판단은 내부 문서에 둔다
 * 그래서 말풍선을 뺐고 마스코트는 히어로 우측으로 옮겼다.
 *
 * 한글은 전부 HTML/CSS가 조판한다. 마스코트 SVG에는 글자를 넣지 않는다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NewsCard = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // esc 출력이 class 속성 안에도 들어간다 — 인용부호까지 완전 이스케이프.
  var esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };
  var rich = function (s) { return String(s == null ? '' : s); };

  /**
   * 연출 자리 하나를 꺼낸다. side 를 주면 그 쪽 것만.
   * 없는 자리는 빈 문자열이라 호출부에서 조건을 따로 안 쓴다.
   *
   * R.staged 는 { hero: [{side,size,svg}], … } 꼴이다. 어느 자리에 몇 마리가
   * 서는지는 카드가 staging 으로 정하고 design/staging.js 가 판정한다 —
   * 템플릿은 그리기만 한다.
   */
  function stage(R, at, side) {
    var all = (R && R.staged && R.staged[at]) || [];
    var picked = side ? all.filter(function (m) { return m.side === side; }) : all;
    if (!picked.length) return '';
    return picked.map(function (m) {
      return '<span class="mascot stage stage-' + esc(m.size) + '">' + m.svg + '</span>';
    }).join('');
  }

  function topbar(c, R) {
    return '<div class="topbar">' +
      '<span class="badge ' + esc(c.badge) + '">' + esc(c.badgeLabel) + '</span>' +
      '<span class="cycle">' + esc(c.cycle) + '</span>' +
      '<span class="brandmark">' + R.flat + 'NewsCard</span>' +
    '</div>';
  }

  function head(title, aside) {
    return '<div class="section-head"><h2>' + esc(title) + '</h2><span class="rule"></span>' +
      (aside ? '<span class="aside">' + esc(aside) + '</span>' : '') + '</div>';
  }

  /** Setup 경로 — 실제 클릭 순서를 그대로 보여준다 */
  function pathBar(segs) {
    return '<div class="path">' + segs.map(function (s, i) {
      return (i ? '<span class="arw">▸</span>' : '') +
        '<span class="seg' + (s.q ? ' q' : '') + '">' + esc(s.t) + '</span>';
    }).join('') + '</div>';
  }

  function chips(list) {
    return '<div class="chips">' + list.map(function (x) {
      return '<span class="chip' + (x.on ? ' on' : '') + '">' + esc(x.t) + '</span>';
    }).join('') + '</div>';
  }

  function steps(list, tone) {
    return '<ol class="steps">' + list.map(function (t, i) {
      return '<li class="' + (tone || '') + '"><span class="n">' + (i + 1) +
        '</span><span class="tx">' + rich(t) + '</span></li>';
    }).join('') + '</ol>';
  }

  function warnBlock(w, R) {
    if (!w) return '';
    return '<div class="section" style="margin-top:28px"><div class="warn ' + (w.kind || '') + '">' +
      stage(R, 'warn') +
      '<span class="lb">' + esc(w.label) + '</span>' +
      '<span class="tx">' + rich(w.text) + '</span></div></div>';
  }

  function band(c, R) {
    // R.staged 가 있으면 그쪽만 본다. || R.band 로만 쓰면 staging:[] 인 0마리
    // 카드에서 undefined 가 찍힌다.
    return '<div class="band">' +
      '<span class="mascot">' +
        (stage(R, 'band') || (R.staged ? '' : (R.band || ''))) + '</span>' +
      '<span class="msg"><span class="big">' + rich(c.cta) + '</span>' +
        '<span class="sub">' + esc(c.ctaSub) + '</span></span>' +
      '<span class="src"><b>' + esc(c.srcTop || '공식 릴리스 노트') + '</b>' +
        esc(c.srcSub || 'help.salesforce.com') + '</span>' +
    '</div>';
  }

  /**
   * ── figure ── 무엇이 바뀌느냐에 따라 그림이 달라진다 ──────
   *
   * 전후 2박스는 만능이 아니다. 전부 그걸로 그리면 카드가 다 똑같아 보이고
   * 채널에서 벽지가 된다. 바뀌는 것의 모양을 따라가야 눈에 걸린다.
   *
   *   quantity  양이 바뀐다      → 칸 (레코드 8개 → 3개)
   *   timeline  시점이 온다      → 가로 바 위의 두 점
   *   flow      단계가 늘어난다  → 흐름 두 줄 비교
   *   toggle    화면이 사라진다  → 스위치가 있다가 없어진다
   */
  function figure(f, tone) {
    if (!f) return '';
    var t = tone || '';

    if (f.kind === 'timeline') {
      return '<div class="fig-timeline">' +
        '<div class="tl-bar"><span class="tl-fill"></span>' +
          '<span class="tl-dot start"></span><span class="tl-dot end ' + t + '"></span></div>' +
        '<div class="tl-labels">' +
          '<span class="tl-a"><b>' + esc(f.fromLabel) + '</b><i>' + esc(f.fromNote || '') + '</i></span>' +
          '<span class="tl-gap">' + rich(f.gap || '') + '</span>' +
          '<span class="tl-b ' + t + '"><b>' + esc(f.toLabel) + '</b><i>' + esc(f.toNote || '') + '</i></span>' +
        '</div>' +
      '</div>';
    }

    if (f.kind === 'flow') {
      var row = function (r, isAfter) {
        return '<div class="fl-row' + (isAfter ? ' after ' + t : '') + '">' +
          '<span class="fl-when">' + esc(r.when) + '</span>' +
          '<span class="fl-steps">' + r.steps.map(function (st, i) {
            var isAdded = typeof st === 'object' && st.added;
            var label = typeof st === 'object' ? st.t : st;
            return (i ? '<i class="fl-arw">→</i>' : '') +
              '<span class="fl-step' + (isAdded ? ' added ' + t : '') + '">' + esc(label) + '</span>';
          }).join('') + '</span>' +
        '</div>';
      };
      return '<div class="fig-flow">' + row(f.before, false) + row(f.after, true) + '</div>';
    }

    if (f.kind === 'toggle') {
      return '<div class="fig-toggle">' +
        '<div class="tg-side">' +
          '<span class="tg-when">' + esc(f.before.when) + '</span>' +
          '<span class="tg-ui"><span class="tg-name">' + esc(f.name) + '</span>' +
            '<span class="tg-sw off"><i></i></span></span>' +
          '<span class="tg-note">' + rich(f.before.note) + '</span>' +
        '</div>' +
        '<span class="tg-arw">→</span>' +
        '<div class="tg-side after ' + t + '">' +
          '<span class="tg-when">' + esc(f.after.when) + '</span>' +
          '<span class="tg-ui gone"><span class="tg-name">' + esc(f.name) + '</span>' +
            '<span class="tg-sw removed">제거</span></span>' +
          '<span class="tg-note">' + rich(f.after.note) + '</span>' +
        '</div>' +
      '</div>';
    }
    return '';
  }

  /** ── deepdive ─────────────────────────────────────────── */
  function deepdive(c, R) {
    var tone = c.tone || '';
    return '<div class="sheet" style="height:' + (c.height || 1560) + 'px">' +
      topbar(c, R) +

      // 마스코트가 히어로에 서는지는 카드가 staging 으로 정한다. staging 이 없으면
      // 예전 경로 — R.hero 를 주면 우측, 안 주면 밴드에만 남는다.
      (function () {
        var heroL = stage(R, 'hero', 'left');
        var heroR = stage(R, 'hero', 'right') || (R.staged ? '' : (R.hero || ''));
        return '<div class="hero' + ((heroL || heroR) ? ' withmascot' : '') +
                 (heroL ? ' mascotleft' : '') + '">' +
          (heroL ? '<div class="mascot-slot">' + heroL + '</div>' : '') +
          '<div>' +
            // 걸리는 조건. 읽는 사람이 3초 안에 "나랑 상관있나"를 판단하게 한다.
            // 에디션 목록은 거의 모든 org가 해당돼서 필터 역할을 못 한다 —
            // 우리가 구축한 것 중 무엇에 걸리는지를 써야 필터가 된다.
            (c.applies
              ? '<div class="applies"><span class="k">해당</span>' +
                '<span class="t">' + rich(c.applies) + '</span></div>'
              : '') +
            '<h1 class="' + (c.headlineSmall ? 'sm ' : '') + tone + '">' + rich(c.headline) + '</h1>' +
            '<p class="lead">' + rich(c.lead) + '</p>' +
          '</div>' +
          // 폴백 경로는 예전 그대로 .mascot 이다 — .hero.withmascot .mascot svg 가
          // 178px 을 강제한다. staged 경로는 .mascot-slot 을 써서 그 규칙을 피해야
          // size(lg/md/sm)가 살아난다.
          (heroR ? '<div class="' + (R.staged ? 'mascot-slot' : 'mascot') + '">' +
                   heroR + '</div>' : '') +
        '</div>';
      })() +

      // 지금 → 앞으로. 한 블록으로 "무엇이 바뀌나"를 가장 빠르게 전달한다.
      '<div class="section" style="margin-top:34px">' +
        head(c.compareTitle || '무엇이 달라지나') +
        (c.figure
          ? (function () {
              var l = stage(R, 'figure', 'left'), r = stage(R, 'figure', 'right');
              var fig = figure(c.figure, tone);
              return (l || r)
                ? '<div class="figrow">' +
                    (l ? '<span class="mascot-slot">' + l + '</span>' : '') +
                    '<div class="figbody">' + fig + '</div>' +
                    (r ? '<span class="mascot-slot">' + r + '</span>' : '') +
                  '</div>'
                : fig;
            })()
          : '<div class="compare">' +
          '<div class="col"><span class="when">' + esc(c.before.when) + '</span>' +
            '<span class="what">' + rich(c.before.what) + '</span></div>' +
          // 마스코트가 화살표를 대체한다. 둘을 같이 두면 1fr auto 1fr 의 가운데
          // 칸이 넓어져 전후 두 박스가 눌린다.
          '<span class="mid">' + (stage(R, 'compare', 'mid') || '→') + '</span>' +
          '<div class="col after ' + tone + '"><span class="when">' + esc(c.after.when) + '</span>' +
            '<span class="what">' + rich(c.after.what) + '</span></div>' +
        '</div>') +
      '</div>' +

      // 왼쪽 = 어디에 걸리나, 오른쪽 = 뭘 해야 하나. 둘 다 공식 노트에서 온 사실이다.
      //
      // 둘 다 옵셔널이다. 가이던스 문서가 따로 있는 카드는 절차를 싣지 않는다 —
      // 슬랙은 훑는 곳이고 절차는 복사해 쓰는 것이라 문서가 맡는 게 맞다.
      // 스레드 텍스트로 내렸을 때는 실패했지만(카드가 비었다), 제대로 된 문서가
      // 목적지로 있으면 카드는 훅만 해도 된다.
      ((c.editions && c.editions.length) || (c.todo && c.todo.length)
        ? '<div class="section" style="margin-top:34px">' +
            '<div class="cols' +
              ((c.editions && c.editions.length) && (c.todo && c.todo.length) ? '' : ' one') +
              (stage(R, 'cols') ? ' withmascot' : '') + '">' +
              (c.editions && c.editions.length
                ? '<div class="colblock"><div>' +
                    head('어디에 적용되나', c.editionNote || '') + chips(c.editions) +
                  '</div></div>'
                : '') +
              (c.todo && c.todo.length
                ? '<div class="colblock"><div>' + head('해야 할 일') +
                    (c.path ? '<div style="margin-bottom:18px">' + pathBar(c.path) + '</div>' : '') +
                    steps(c.todo, tone) +
                  '</div></div>'
                : '') +
              (stage(R, 'cols')
                ? '<div class="cols-mascot">' + stage(R, 'cols') + '</div>' : '') +
            '</div>' +
          '</div>'
        : '') +

      warnBlock(c.warn, R) +
      band(c, R) +
    '</div>';
  }

  /** ── roundup ──────────────────────────────────────────── */
  function roundup(c, R) {
    var cards = c.items.map(function (it, i) {
      return '<div class="pcard">' +
        '<div class="art"><span class="mascot">' + R.items[i] + '</span></div>' +
        '<div class="main">' +
          '<div class="top"><span class="no">' + (i + 1) + '</span>' +
            '<span class="badge ' + esc(it.badge) + '">' + esc(it.badgeLabel) + '</span></div>' +
          '<h3>' + rich(it.title) + '</h3>' +
          '<div class="sum">' + rich(it.sum) + '</div>' +
          '<div class="meta">' + esc(it.meta) + '</div>' +
          '<div class="do ' + (it.tone || '') + '"><b>' + esc(it.doLabel) + '</b>' +
            '<span>' + rich(it.doText) + '</span></div>' +
        '</div>' +
      '</div>';
    }).join('');

    return '<div class="sheet" style="height:' + (c.height || 1700) + 'px">' +
      topbar(c, R) +

      '<div class="hero">' +
        '<h1 class="sm ' + esc(c.tone || '') + '">' + rich(c.headline) + '</h1>' +
        '<p class="lead">' + rich(c.lead) + '</p>' +
      '</div>' +

      '<div class="section" style="margin-top:34px">' +
        head(c.listTitle || '항목별로 해야 할 일', c.items.length + '건') +
        // 항목 수를 클래스로 넘긴다. 3의 배수가 아니면 3열에서 오른쪽이 빈다.
        '<div class="pgrid n' + c.items.length + '">' + cards + '</div>' +
      '</div>' +

      warnBlock(c.warn, R) +

      // paths는 옵셔널이다. 모든 roundup이 Setup 경로를 갖지는 않는다 —
      // 제품 폐기·판매 중단은 Setup에서 할 일이 아니라 제안·마이그레이션 판단이다.
      // 빈 배열을 줘도 "Setup 경로 모음" 제목만 남은 빈 섹션이 생기므로 통째로 뺀다.
      (c.paths && c.paths.length
        ? '<div class="section" style="margin-top:30px">' +
            head('Setup 경로 모음') +
            '<div style="display:flex;flex-direction:column;gap:14px">' +
              c.paths.map(function (p) {
                return '<div><div style="font-size:16px;color:var(--ink-2);margin-bottom:8px">' +
                  esc(p.label) + '</div>' + pathBar(p.segs) + '</div>';
              }).join('') +
            '</div>' +
          '</div>'
        : '') +

      band(c, R) +
    '</div>';
  }

  /** ── event ── 교육·웨비나 포스터 ─────────────────────
   * 릴리스 카드와 골격이 다르다. 릴리스는 "문서"라 위에서 아래로 섹션을 읽지만,
   * 행사는 "포스터"다 — 날짜가 먼저 박히고 내용이 뒤따른다.
   * 그래서 좌측에 어두운 날짜 레일을 세우고 우측을 본문으로 쓴다.
   * .sheet 를 쓰지 않으므로 릴리스 카드와 시각적으로 섞이지 않는다.
   */
  function event(c, R) {
    var dd = c.dday;
    var soon = dd != null && dd >= 0 && dd <= 7;
    var ddText = dd == null ? '' : (dd < 0 ? '종료' : (dd === 0 ? 'TODAY' : 'D-' + dd));
    var ddNote = dd == null ? '' : (dd < 0 ? '지난 행사' : (dd === 0 ? '오늘' : '남음'));

    return '<div class="poster">' +

      '<div class="rail">' +
        '<span class="kind">' + esc(c.kind || 'EVENT') + '</span>' +
        '<div>' +
          '<div class="mon">' + esc(c.date.mon) + '</div>' +
          '<div class="day">' + esc(c.date.day) + '</div>' +
          '<div class="dow">' + esc(c.date.dow) + '</div>' +
        '</div>' +
        // 시간·장소는 자동 수집 이벤트에서 비어 있을 수 있다 (Dreamforce처럼
        // 날짜 범위만 공개된 행사). 빈 블록을 그리면 레일에 구멍이 나므로 통째로 뺀다.
        (c.date.time
          ? '<div class="time">' +
              '<span class="hh">' + esc(c.date.time) + '</span>' +
              '<span class="zz">' + esc(c.date.zone) + '</span>' +
            '</div>'
          : '') +
        (c.where
          ? '<div class="place">' +
              '<span class="fm">' + esc(c.where.big) + '</span>' +
              '<span class="vn">' + esc(c.where.small) + '</span>' +
              (c.where.sub ? '<span class="ad">' + esc(c.where.sub) + '</span>' : '') +
            '</div>'
          : '') +
        '<div class="left' + (soon ? ' soon' : '') + '">' +
          '<span class="mascot">' + R.hero + '</span>' +
          '<span class="cnt"><span class="big">' + esc(ddText) + '</span>' +
            '<span class="sm">' + esc(ddNote) + '</span></span>' +
        '</div>' +
      '</div>' +

      '<div class="pbody">' +
        '<div class="ptop">' +
          '<span class="badge ' + esc(c.badge) + '">' + esc(c.badgeLabel) + '</span>' +
          '<span class="host">' + esc(c.host) + '</span>' +
          '<span class="brandmark">' + R.flat + 'NewsCard</span>' +
        '</div>' +

        '<h1>' + rich(c.headline) + '</h1>' +
        '<p class="sub">' + rich(c.lead) + '</p>' +

        // 대상·어젠다는 사람이 원문을 읽고 채운 카드에만 있다. 자동 수집 이벤트는
        // 이 필드가 없다 — 지어내지 않고 섹션을 뺀다.
        (c.who
          ? '<div class="audience">' +
              '<span class="k">누구를 위한</span>' +
              '<span class="v">' + rich(c.who.big) + '</span>' +
              '<span class="q">' + esc(c.who.sub) + '</span>' +
            '</div>'
          : '') +

        (c.agenda && c.agenda.length
          ? '<div class="agwrap">' +
              head('무엇을 다루나', c.agendaNote || '') +
              '<ul class="agenda">' + c.agenda.map(function (a) {
                return '<li><span class="bar"></span><span class="tx">' +
                  '<span class="tt">' + rich(a[0]) + '</span>' +
                  '<span class="dd">' + rich(a[1]) + '</span></span></li>';
              }).join('') + '</ul>' +
            '</div>'
          : '') +

        // 행사 대표 이미지 — 어젠다가 없는 자동 수집 카드에서 우측이 비는 문제의
        // 답이다. 렌더러가 데이터 URI로 넘기며, 어젠다가 있으면 아예 안 넘긴다.
        (c.img
          ? '<div class="pimg"><img src="' + esc(c.img.src) + '" alt="' + esc(c.img.alt || '') + '"></div>'
          : '') +

        '<div class="foot">' +
          '<span class="go">' + rich(c.cta) + '</span>' +
          '<span class="src"><b>' + esc(c.srcTop) + '</b>' + esc(c.srcSub) + '</span>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  return { deepdive: deepdive, roundup: roundup, event: event };
});
