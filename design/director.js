/**
 * 연출 감독 — 뉴스 한 건을 받아서 시각 결정을 내린다.
 *
 * AI를 쓰는 지점이 여기다. 이미지 모델로 캐릭터를 매번 새로 그리는 게 아니라,
 * 렌더러(배우)는 고정해두고 "이 뉴스엔 어떤 자세·표정·배지가 맞나"를 고른다.
 * 그래서 카드가 정적이지 않으면서도 캐릭터는 안 흔들린다.
 *
 * 역할 분담
 *   규칙(이 파일)  점수·권장·키워드로 판정. 결정론적이고 공짜이고 재현된다. 약 80%.
 *   Claude        규칙이 못 잡는 것 — 헤드라인 한 줄 요약, 뉘앙스, 애매한 케이스. 약 20%.
 *                 decide()가 confidence:'low'를 반환하면 그때 md를 읽혀 판단시킨다.
 *
 * 입력은 .ai/digests/<cycle>/ 의 항목 스키마를 그대로 쓴다.
 *   { id, category, score, recommendation, evidence[], tier, tags[] }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BrickDirector = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 상태 배지 — 브랜드 블루(#4997CF)와 별개다.
  // 블루는 브랜드 상수이고 이건 의미색이라 섞으면 안 된다.
  var BADGES = {
    urgent:    { label: '긴급',      color: '#C2492D', fill: true },
    official:  { label: '공식',      color: '#2F7CB8', fill: true },
    retired:   { label: '기능 중단', color: '#5A6B7A', fill: true },
    reversed:  { label: '계획 철회', color: '#2E7D5B', fill: true },
    community: { label: '커뮤니티',  color: '#8A6D1F', fill: false },
    minor:     { label: '참고',      color: '#5A6B7A', fill: false }
  };

  // 역전 어휘. RETIRE_RE보다 반드시 먼저 판정해야 한다.
  //
  // "Salesforce Backtracks on Permission Retirement in Profiles" 는 RETIRE_RE에도
  // 걸린다. 순서를 반대로 두면 "폐기 철회" 소식이 tumble+dead+기능중단 배지로
  // 나가서 의미가 정반대인 카드가 된다. 사외 채널에 나가는 오보라 순서가 중요하다.
  //
  // 어휘는 실측에서 뽑았다 — Salesforce가 Profile 권한 폐기(Spring '26 EOL)를
  // 취소한 2026-07 사건의 기사 제목들:
  //   "Salesforce Backtracks on Permission Retirement in Profiles"
  //   "What the Community Really Thinks About Salesforce's Permissions U-Turn"
  // 공식 쪽은 발표 없이 KB 문서를 조용히 수정했다. 그래서 폐기 목록에서 행이
  // 사라지는 것으로 감지한다 (bin/fetch-retirements.mjs).
  // 강한 어휘는 단독으로 역전을 뜻한다. "Salesforce's Permissions U-Turn" 처럼
  // retirement 단어가 없는 제목도 잡아야 하기 때문이다(실측 기사).
  var REVERSE_STRONG_RE = /backtrack|u[-_ ]?turn|revers|reinstat|calls?[-_ ]off|called[-_ ]off|walks?[-_ ]back|no[-_ ]longer[-_ ](enforc|retir|plan)|철회|번복/i;
  // 약한 어휘는 폐기 맥락에서만 역전이다. "Dreamforce delayed" 를 계획 철회로
  // 잡으면 안 되므로 RETIRE_RE 와 함께일 때만 인정한다.
  var REVERSE_WEAK_RE = /cancel|postpon|delay|취소|연기/i;
  var RETIRE_RE = /retire|retirement|deprecat|removal|removed|end[-_ ]?of[-_ ]?life|sunset/i;
  var GA_RE = /\bga\b|general[-_ ]availability|now[-_ ]available|launch|출시/i;
  var UPDATE_RE = /release[-_ ]update|enforce|enforcement|breaking/i;
  var TIP_RE = /tip|how[-_ ]?to|best[-_ ]practice|노하우|꿀팁/i;

  /**
   * @param {object} item  다이제스트 항목
   * @returns {{pose,expression,badge,template,reason,confidence}}
   */
  function decide(item) {
    item = item || {};
    var id = String(item.id || '');
    var text = id + ' ' + String(item.title || '');
    var score = Number(item.score || 0);
    var rec = String(item.recommendation || '');
    var tier = item.tier === 'community' ? 'community' : 'official';

    var out = null;

    // item.eventType 이 있으면 규칙보다 우선한다. 폐기 목록 diff처럼 이벤트 유형이
    // 이미 확정된 입력(bin/fetch-retirements.mjs)은 제목 어휘를 추측할 필요가 없다.
    //   'reversed' 행이 사라짐 = 철회 / 'announced' 행 추가 = 신규 / 'rescheduled' 시점 변경
    var ev = String(item.eventType || '');
    if (ev === 'reversed') {
      out = { pose: 'check', expression: 'wide', badge: 'reversed',
              reason: '폐기 목록에서 항목이 사라짐 = 계획 철회', confidence: 'high' };
    }
    else if (ev === 'rescheduled') {
      out = { pose: 'point', expression: 'look', badge: 'urgent',
              reason: '폐기 시점 변경', confidence: 'high' };
    }
    // 제품명만으로는 폐기인지 알 수 없다("Quip", "Maps Mobile App"). 목록에 올랐다는
    // 사실 자체가 정보이므로 유형을 넘겨받아야 한다. 안 넘기면 기본값(official)로
    // 떨어져서 폐기 소식이 파란 "공식" 배지로 나간다.
    else if (ev === 'announced') {
      out = { pose: 'tumble', expression: 'dead', badge: 'retired',
              reason: '폐기 목록에 신규 등재', confidence: 'high' };
    }
    else if (ev === 'imminent') {
      out = { pose: 'alert', expression: 'wide', badge: 'urgent',
              reason: '폐기 임박', confidence: 'high' };
    }
    // Release Update 신규 등재 — "안 하면 자동 적용"이라 임박과 같은 연출이 맞다.
    // 카드 1번(Apex 배치 정렬)이 이미 alert+wide+urgent 다.
    else if (ev === 'enforced') {
      out = { pose: 'alert', expression: 'wide', badge: 'urgent',
              reason: 'Release Update 신규 — 강제 적용 예정', confidence: 'high' };
    }
    // 0. 계획이 뒤집혔다 — RETIRE_RE보다 먼저 봐야 한다. "Backtracks on Retirement"
    //    는 두 패턴에 다 걸리는데, 뒤에 두면 "기능 중단" 카드가 되어 의미가 반대가 된다.
    else if (REVERSE_STRONG_RE.test(text) ||
             (REVERSE_WEAK_RE.test(text) && RETIRE_RE.test(text))) {
      out = { pose: 'check', expression: 'wide', badge: 'reversed',
              reason: '중단 계획 철회·연기 키워드', confidence: 'high' };
    }
    // 1. 기능이 죽는다 — 가장 강한 신호. 점수와 무관하게 최우선.
    else if (RETIRE_RE.test(text)) {
      out = { pose: 'tumble', expression: 'dead', badge: 'retired',
              reason: '중단·제거 키워드', confidence: 'high' };
    }
    // 2. 기한이 박힌 릴리스 업데이트 — 강제 적용이라 GA보다 우선한다
    else if (UPDATE_RE.test(text)) {
      out = { pose: 'alert', expression: 'wide', badge: 'urgent',
              reason: '릴리스 업데이트 · 기한 있음', confidence: 'high' };
    }
    // 3. 새로 나온 것
    //    GA 판정을 "즉시검토 고득점"보다 먼저 봐야 한다. 순서를 반대로 뒀더니
    //    82점 GA 항목이 jump가 아니라 alert로 분류됐다.
    else if (GA_RE.test(text)) {
      out = { pose: 'jump', expression: 'happy', badge: 'official',
              reason: 'GA · 신규 출시', confidence: 'high' };
    }
    // 4. 고득점 즉시검토 — 기한은 없지만 급하다
    else if (rec.indexOf('즉시') === 0 && score >= 75) {
      out = { pose: 'alert', expression: 'wide', badge: 'urgent',
              reason: '즉시 검토 · 75점 이상', confidence: 'high' };
    }
    // 5. 지금 봐야 함
    else if (rec.indexOf('즉시') === 0) {
      out = { pose: 'point', expression: 'look', badge: 'official',
              reason: '권장 즉시 검토', confidence: 'high' };
    }
    // 6. 다음 단계로 넘김
    //    실제 다이제스트는 POC 권장이 몰린다(Summer '26은 6건 중 4건). 같은 자세가
    //    줄줄이 나오면 시리즈가 정적으로 보이므로, 데이터 안에 있는 의미 있는 축으로 쪼갠다.
    //    걸리는 프로젝트 수 — 둘 다 걸리면 "양쪽을 지목", 한 곳이면 "다음 단계로 전진".
    else if (/POC|sandbox/i.test(rec)) {
      var multi = (Array.isArray(item.evidence) ? item.evidence.length : 0) >= 2;
      out = multi
        ? { pose: 'point', expression: 'look', badge: 'official',
            reason: 'POC · 두 프로젝트 모두 영향', confidence: 'high' }
        : { pose: 'lean', expression: 'look', badge: 'official',
            reason: 'POC · 단일 프로젝트 · 다음 단계', confidence: 'high' };
    }
    // 6. 팁성 콘텐츠
    else if (TIP_RE.test(text)) {
      out = { pose: 'wave', expression: 'wink', badge: 'official',
              reason: '팁 · 노하우', confidence: 'medium' };
    }
    // 7. 영향이 작다
    else if (score > 0 && score < 60) {
      out = { pose: 'base', expression: 'sleepy', badge: 'minor',
              reason: '점수 60 미만 · 영향 낮음', confidence: 'medium' };
    }
    // 8. 규칙 미적용 — Claude가 md를 읽고 판단해야 하는 구간
    else {
      out = { pose: 'base', expression: 'neutral', badge: 'official',
              reason: '규칙 미적용 — Claude 판단 필요', confidence: 'low' };
    }

    // 커뮤니티 출처는 표정을 덮어쓴다. "이건 아직 검증 안 됐다"를 얼굴로 말한다.
    // 자세는 유지 — 내용의 성격은 출처와 별개다.
    if (tier === 'community') {
      out.expression = 'skeptical';
      out.badge = 'community';
      out.reason += ' + 커뮤니티 출처';
    }

    // 템플릿 — 프로젝트 영향이 둘 이상이면 비교 레이아웃이 필요하다
    var hits = Array.isArray(item.evidence) ? item.evidence.length : 0;
    out.template = hits >= 2 ? 'deepdive-dual' : 'deepdive';
    out.badgeStyle = BADGES[out.badge];
    return out;
  }

  /**
   * ── 선별 게이트 ────────────────────────────────────────
   * decide()는 "어떤 연출이 맞나"를 정한다. "이걸 보낼까"는 별개다.
   * 둘을 섞어 쓰면 how-to·팁이 전부 통과한다 — 실측으로 확인했다.
   * SF Ben 한 달치 43건에 decide()만 걸었더니 9건이 통과했고 그중 6건이 오탐이었다:
   *   "How to Connect SharePoint" / "10 Tips for Layoff-Proofing Career"
   *   "How to Deploy Flows" / "How to Prevent Technical Debt"
   *   "Winter '27 Release: What to Expect and How to Prepare"
   *   "Jack Dorsey Launches Rival to Salesforce's Slack"   ← 경쟁사 출시를 GA로 잡았다
   *
   * 우리가 보내려는 것은 "공식 상태가 바뀌었다는 소식"이다. 읽을거리가 아니다.
   * how-to·팁·커리어·설문·업계 가십은 유용해도 카드로 만들 대상이 아니다.
   */

  // 타사 주체. "Jack Dorsey Launches…" 처럼 남의 출시를 우리 GA로 잡으면 안 된다.
  // Salesforce 자산(Slack·Tableau·Heroku·Mulesoft)이 제목에 있어도 주체가 타사면 탈락이다.
  var OTHER_ORG_RE = /servicenow|microsoft|openai|anthropic|google|hubspot|oracle|sap|workday|zoom|jack dorsey|dropbox|monday\.com/i;
  // 읽을거리 신호. 하나라도 있으면 변화 소식이 아니다.
  var READ_RE = /\bhow to\b|\btips?\b|best[-_ ]practice|guide\b|checklist(?!.*enforc)|infographic|according to|survey|career|salary|certification|interview|\bwhy\b|\bwhat\b.*\?|failed\?|dream\b|안내서|가이드/i;

  /**
   * @returns {{pass:boolean, reason:string}}
   */
  function gate(item) {
    item = item || {};
    var text = String(item.id || '') + ' ' + String(item.title || '');

    // 폐기 목록 diff처럼 유형이 확정된 입력은 무조건 통과한다. 공식 목록의 변화
    // 자체가 소식이므로 제목 어휘를 볼 필요가 없다.
    if (item.eventType) return { pass: true, reason: 'eventType 확정 입력' };

    // 1. 계획이 뒤집혔다 — 가장 강한 신호. 다른 조건을 다 무시한다.
    //    "What the Community Really Thinks About the Permissions U-Turn" 은
    //    READ_RE(what…?)에도 걸리지만 철회 소식이므로 통과해야 한다.
    if (REVERSE_STRONG_RE.test(text)) return { pass: true, reason: '계획 철회·번복' };

    // 2. 타사 주체는 여기서 자른다. Salesforce 플랫폼의 변화가 아니다.
    if (OTHER_ORG_RE.test(text)) return { pass: false, reason: '타사 주체' };

    // 3. 강제 적용·릴리스 업데이트 — 기한이 박힌 변화다. 읽을거리 어휘가 섞여
    //    있어도 통과한다("5 Days to Go: MFA Enforcement Checklist").
    if (UPDATE_RE.test(text)) return { pass: true, reason: '강제 적용·릴리스 업데이트' };

    // 4. 폐기·중단
    if (RETIRE_RE.test(text) || REVERSE_WEAK_RE.test(text) && RETIRE_RE.test(text)) {
      return { pass: true, reason: '폐기·중단' };
    }

    // 5. 읽을거리는 여기서 자른다. 3·4를 먼저 본 뒤라야 한다.
    if (READ_RE.test(text)) return { pass: false, reason: '읽을거리(how-to·팁·설문·커리어)' };

    // 6. 공식 GA. launch 는 3~5를 통과한 뒤에만 인정한다.
    if (GA_RE.test(text)) return { pass: true, reason: 'GA·신규 출시' };

    return { pass: false, reason: '변화 소식이 아니다' };
  }

  /** 여러 건을 한 번에. roundup 카드용. */
  function decideAll(items) {
    return (items || []).map(function (it) {
      var d = decide(it);
      d.id = it.id;
      return d;
    });
  }

  return { decide: decide, decideAll: decideAll, gate: gate, BADGES: BADGES };
});
