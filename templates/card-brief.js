(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CardBrief = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TONES = new Set(['blue', 'green', 'purple', 'orange', 'gold', 'note']);
  const TYPES = new Set(['compare', 'flow', 'list', 'note']);
  const LAYOUT_MODES = new Set(['skin', 'panels', 'full']);
  // full 모드 색·위계 축 (2026-08-04). tone 은 skin·panels 전용으로 남고,
  // full 모드 색은 card.accent 하나 + 중립으로 파생된다 — card-layout.js 의 ACCENTS 와 같은 키.
  const ACCENT_KEYS = new Set(['removed', 'enforced', 'default', 'changed', 'event']);
  const WEIGHTS = new Set(['primary', 'secondary', 'aside']);
  // 동급 나열 레이아웃 (2026-09-15 사용자 확정). 기본(플래그 없음)은 종전 위계 규칙 그대로다.
  // 아래 "primary 정확히 1개" 규칙은 2026-08-04 피드백에서 나왔는데, 그때 문제는 "배경 설명이
  // 핵심 사실과 같은 무게"였다 — 즉 위계가 실제로 있는 카드용이다. 연대기·목록처럼 항목이 전부
  // 동급인 카드에 그 규칙을 적용하면 아무 근거 없이 한 패널만 커진다(실측: 개명 연대기 카드에서
  // 1번 패널만 전폭·최대 글씨로 나와 나머지 3개가 부록처럼 읽혔다).
  // poster = 연례 이벤트 레인의 표지 카드 (2026-09-17 신설). 일상 카드가 "정보 시트"라면
  // 표지는 "포스터"다 — 인스타 그리드에서 줄무늬 텍스처가 끊겨야 구분자 노릇을 한다.
  // 그래서 섹션 수·종류를 여기서 좁힌다. 안 좁히면 일상 카드와 같은 밀도로 되돌아간다.
  const LAYOUTS = new Set(['peer', 'poster', 'timeline', 'ledger']);
  // 위계(primary 패널 하나)가 성립하지 않는 골격들. timeline 은 순서가 내용이고
  // ledger 는 표라서, 한 칸만 키우면 골격 자체가 깨진다 — peer 와 같은 취급.
  const FLAT_LAYOUTS = new Set(['peer', 'timeline', 'ledger']);
  const POSTER_SECTION_TYPES = new Set(['list', 'compare']);
  const text = value => typeof value === 'string' && value.trim().length > 0;
  const list = value => Array.isArray(value) && value.length > 0 && value.every(text);

  /** 독자가 실제로 읽는 문구만 모은다 — 카드 표면 + evidence 코멘트.
   *  image.prompt 같은 기계용 영어 문자열은 대상이 아니다. */
  function collectReaderText(brief) {
    const out = [];
    const push = (where, value) => { if (text(value)) out.push([where, value]); };
    const card = brief && brief.card;
    if (card && typeof card === 'object') {
      push('card.eyebrow', card.eyebrow);
      push('card.title', card.title);
      push('card.lead', card.lead);
      push('card.bubble', card.bubble);
      (Array.isArray(card.sections) ? card.sections : []).forEach((section, i) => {
        if (!section || typeof section !== 'object') return;
        push(`card.sections[${i}].title`, section.title);
        push(`card.sections[${i}].body`, section.body);
        push(`card.sections[${i}].source`, section.source);
        (section.items || []).forEach((item, j) => push(`card.sections[${i}].items[${j}]`, item));
        (section.rows || []).forEach((row, j) => {
          if (!Array.isArray(row)) return;
          push(`card.sections[${i}].rows[${j}][0]`, row[0]);
          push(`card.sections[${i}].rows[${j}][1]`, row[1]);
        });
      });
    }
    (Array.isArray(brief && brief.evidence) ? brief.evidence : []).forEach((ev, i) => {
      if (ev && typeof ev === 'object') push(`evidence[${i}].comment`, ev.comment);
    });
    return out;
  }

  function validateBrief(brief) {
    const errors = [];
    if (!brief || typeof brief !== 'object' || Array.isArray(brief)) {
      return { ok: false, errors: ['brief must be an object'] };
    }
    if (brief.version !== 1) errors.push('version must be 1');
    const card = brief.card;
    if (!card || typeof card !== 'object') errors.push('card must be an object');
    else {
      if (!text(card.title)) errors.push('card.title is required');
      if (!text(card.lead)) errors.push('card.lead is required');
      if ('eyebrow' in card && !text(card.eyebrow)) errors.push('card.eyebrow must be a non-empty string when present');
      if ('layout' in card && !LAYOUTS.has(card.layout)) errors.push(`card.layout must be one of ${[...LAYOUTS].join(', ')} when present`);
      // 이벤트 레인 색 (2026-09-17). 일상 카드는 accent(의미색), 이벤트 카드는 행사 팔레트 —
      // content/palettes.json 의 키. loadBrief 가 읽어 card._palette 로 붙이고, 못 찾으면 여기서 막는다.
      if ('palette' in card) {
        if (!text(card.palette)) errors.push('card.palette must be a non-empty string (content/palettes.json 의 키)');
        else if (!card._palette) errors.push(`card.palette "${card.palette}" 를 content/palettes.json 에서 찾지 못했습니다`);
      }
      // 제품 로고 (2026-09-17). 슬러그는 assets/logo/index.json 에 있어야 한다 — 없는 슬러그를
      // 조용히 넘기면 합성 단계에서야 터지고, 그때는 이미 이미지 생성 비용을 쓴 뒤다.
      // 개수 상한 5: 하단 밴드 폭이 1024px 이고 6개를 넘기면 마크가 읽을 수 없게 작아진다.
      if ('logos' in card) {
        if (!Array.isArray(card.logos) || !card.logos.length) errors.push('card.logos must be a non-empty array of logo slugs when present');
        else if (card.logos.length > 5) errors.push(`card.logos must be ≤5 (found ${card.logos.length}) — 하단 밴드에서 6개부터는 마크가 읽히지 않는다`);
        else if (card._logoTable) {
          const unknown = card.logos.filter(sl => !card._logoTable[sl]);
          if (unknown.length) errors.push(`card.logos 에 assets/logo/index.json 이 모르는 슬러그: ${unknown.join(', ')}`);
        }
      }
      // 등장인물 (2026-09-17). 실존 인물의 생성 이미지라 닮음이 보장되지 않는다 — name·role 을
      // 필수로 두어 그림이 아니라 이름표가 신원을 책임지게 한다. look 은 인상착의 한 줄이고,
      // 색 이름은 막는다(카드 색은 accent 가 독점한다 — image.prompt 와 같은 규율).
      if ('figures' in card) {
        const HUE = /\b(navy|blue|red|crimson|green|teal|orange|amber|yellow|golden|gold|purple|violet|lavender|pink|magenta|cyan)\b/i;
        if (!Array.isArray(card.figures) || !card.figures.length) errors.push('card.figures must be a non-empty array when present');
        else if (card.figures.length > 3) errors.push(`card.figures must be ≤3 (found ${card.figures.length}) — 초상 4개부터는 한 장에서 얼굴이 읽히지 않는다`);
        else card.figures.forEach((f, i) => {
          if (!f || typeof f !== 'object') { errors.push(`card.figures[${i}] must be an object`); return; }
          for (const k of ['name', 'role', 'look']) {
            if (!text(f[k])) errors.push(`card.figures[${i}].${k} is required (name 이름 · role 소속 · look 인상착의 한 줄)`);
          }
          if (text(f.look) && HUE.test(f.look)) errors.push(`card.figures[${i}].look must not name a hue — 카드 색은 card.accent 가 정한다`);
          const tooLong = (v, max) => typeof v === 'string' && v.trim().length > max;
          if (tooLong(f.name, 20)) errors.push(`card.figures[${i}].name must be ≤20 chars`);
          if (tooLong(f.role, 24)) errors.push(`card.figures[${i}].role must be ≤24 chars`);
        });
      }
      if ('bubble' in card && !text(card.bubble)) errors.push('card.bubble must be a non-empty string when present');
      if (!Array.isArray(card.sections) || card.sections.length < 1 || card.sections.length > 8) {
        errors.push('card.sections must contain 1-8 sections');
      } else {
        card.sections.forEach((section, i) => {
          const prefix = `card.sections[${i}]`;
          if (!section || typeof section !== 'object') { errors.push(`${prefix} must be an object`); return; }
          if (!TONES.has(section.tone)) errors.push(`${prefix}.tone is invalid`);
          if (!TYPES.has(section.type)) errors.push(`${prefix}.type is invalid`);
          if (!text(section.title)) errors.push(`${prefix}.title is required`);
          if ('full' in section && typeof section.full !== 'boolean') errors.push(`${prefix}.full must be a boolean when present`);
          if ('weight' in section && !WEIGHTS.has(section.weight)) errors.push(`${prefix}.weight must be "primary", "secondary" or "aside" when present`);
          if ('iconHints' in section && !list(section.iconHints)) errors.push(`${prefix}.iconHints must be a non-empty string array when present`);
          if (section.type === 'compare' && (!Array.isArray(section.rows) || section.rows.length < 1 || section.rows.length > 4 || !section.rows.every(r => Array.isArray(r) && r.length === 2 && r.every(text)))) errors.push(`${prefix}.rows must contain 1-4 label/value pairs`);
          if (section.type === 'flow' && (!Array.isArray(section.steps) || section.steps.length < 2 || section.steps.length > 5 || !section.steps.every(text))) errors.push(`${prefix}.steps must contain 2-5 labels`);
          if (section.type === 'list' && !list(section.items)) errors.push(`${prefix}.items must be a non-empty string array`);
          if (section.type === 'note' && (!text(section.body) || !text(section.source))) errors.push(`${prefix}.body and source are required`);
        });
      }
    }
    const image = brief.image;
    if (!image || typeof image !== 'object') errors.push('image must be an object');
    else {
      if (!text(image.assetPath) || !image.assetPath.startsWith('assets/') || image.assetPath.includes('..')) errors.push('image.assetPath must be a project-relative assets/ path');
      // 파일명 날짜 접두사 (2026-09-15 사용자 확정): 카드 45장이 한 폴더에 평면으로
      // 쌓이는데 슬러그만으로는 언제 낸 카드인지 목록에서 안 보인다. manifest 를 열어야
      // 알 수 있던 것을 파일명에서 바로 읽게 한다 — 정렬도 발행순이 된다.
      // 이전 카드들은 그대로 둔다(개명하면 manifest·git 이력 참조가 끊긴다).
      else if (!/^\d{4}-\d{2}-\d{2}-/.test(image.assetPath.split('/').pop())) {
        errors.push('image.assetPath 파일명은 YYYY-MM-DD- 로 시작해야 합니다 (예: assets/editorial/infographic/2026-09-15-my-slug-full-card.png)');
      }
      if (!text(image.prompt)) errors.push('image.prompt is required');
      if (!text(image.negativePrompt)) errors.push('image.negativePrompt is required');
      if ('layoutMode' in image && !LAYOUT_MODES.has(image.layoutMode)) errors.push('image.layoutMode must be "skin", "panels" or "full"');
      if ('mascotAction' in image && !text(image.mascotAction)) errors.push('image.mascotAction must be a non-empty string when present');
      // panels 모드는 GPT가 패널을 그리는 계약이다 — negativePrompt가 패널을
      // 금지하면 프롬프트가 자기모순이 되어 산출물이 불안정해진다.
      if (image.layoutMode === 'panels' && text(image.negativePrompt) && /panel/i.test(image.negativePrompt)) {
        errors.push('image.negativePrompt must not ban panels when layoutMode is "panels"');
      }
      // full 모드는 GPT가 텍스트까지 그리는 계약이다 — 텍스트 금지어가 있으면 자기모순.
      if (image.layoutMode === 'full' && text(image.negativePrompt) && /readable text|korean letters|english letters/i.test(image.negativePrompt)) {
        errors.push('image.negativePrompt must not ban text when layoutMode is "full"');
      }
      // full 모드 색은 card.accent 가 독점한다 — image.prompt 가 팔레트를 또 선언하면
      // 코드가 붙이는 "only TWO hues" 문장과 충돌한다. 실제로 브리프 5개가 옛
      // "deep navy and golden yellow accent system" 문장을 갖고 있어 색 규율이 무력화됐다
      // (2026-08-04 발견). off-white·gray·neutral 은 허용 — 배경·중립 어휘다.
      // mascotAction 도 같이 본다 — "golden shield" 하나가 카드에 세 번째 색을 들여왔다.
      if (image.layoutMode === 'full') {
        const HUE_RE = /\b(navy|blue|red|crimson|green|teal|orange|amber|yellow|golden|gold|purple|violet|lavender|pink|magenta|cyan)\b/i;
        for (const field of ['prompt', 'mascotAction']) {
          if (!text(image[field])) continue;
          const hue = image[field].match(HUE_RE);
          if (hue) {
            errors.push(`full mode: image.${field} must not name a hue ("${hue[1]}") — full 모드 색은 card.accent 가 정한다 (스타일·포즈·소품만 쓸 것)`);
          }
        }
      }
      // full 모드 텍스트 길이 가드 — 이미지 모델은 블록당 한 문장까지는 안정적이고
      // 30단어급 장문부터 오타율이 급증한다(실측 리뷰 공통). 긴 문구는 브리프에서 자른다.
      if (image.layoutMode === 'full' && card && Array.isArray(card.sections)) {
        const over = (value, max) => typeof value === 'string' && value.trim().length > max;
        // 색은 카드 단위로 하나만 정한다 — 섹션마다 색을 고르게 두면 다시 무지개가 된다.
        if (!card._palette && !ACCENT_KEYS.has(card.accent)) {
          errors.push(`full mode: card.accent is required and must be one of ${[...ACCENT_KEYS].join(', ')} (또는 card.palette)`);
        }
        // 위계는 지배 패널이 하나일 때만 성립한다. 둘 이상 primary 면 다시 "전부 강조"가 된다.
        const primaries = card.sections.filter(s => s && s.weight === 'primary').length;
        const peer = FLAT_LAYOUTS.has(card.layout);
        if (card.layout === 'poster') {
          if (card.sections.length > 2) {
            errors.push(`full mode: card.layout "poster" 는 섹션 1~2개만 허용합니다 (found ${card.sections.length}) — 표지가 성겨야 그리드에서 구분자가 된다`);
          }
          card.sections.forEach((s, i) => {
            if (s && s.type && !POSTER_SECTION_TYPES.has(s.type)) {
              errors.push(`full mode: card.sections[${i}].type "${s.type}" 는 poster 에서 쓸 수 없습니다 (list 또는 compare 만)`);
            }
          });
        }
        if (primaries > 1) errors.push(`full mode: at most 1 section may have weight "primary" (found ${primaries})`);
        // peer 는 "전부 동급"이 계약이다. primary 를 하나라도 두면 반쪽 상태가 되므로 아예 막는다.
        if (peer && primaries > 0) {
          errors.push(`full mode: card.layout "${card.layout}" 는 위계가 없는 골격이라 weight "primary" 섹션을 둘 수 없습니다`);
        }
        // timeline — 축 위 노드 수가 곧 밀도다. compare 는 행 하나가 노드 하나,
        // list 는 섹션 하나가 노드 하나. note 는 축에서 빠져 하단 띠로 내려간다.
        if (card.layout === 'timeline') {
          const nodes = card.sections.reduce((n, sec) => {
            if (!sec || sec.type === 'note') return n;
            return n + (sec.type === 'compare' ? (sec.rows || []).length : 1);
          }, 0);
          if (nodes < 3 || nodes > 6) {
            errors.push(`full mode: card.layout "timeline" 은 축 위 노드가 3~6개여야 합니다 (found ${nodes}) — note 를 뺀 compare 행 수 + list 섹션 수`);
          }
        }
        // ledger — 상자도 아이콘도 없이 가로 실선만으로 행을 가르는 골격이다.
        // iconHints 를 남겨두면 브리프 작성자가 아이콘이 나올 거라 기대하게 된다.
        if (card.layout === 'ledger') {
          card.sections.forEach((sec, i) => {
            if (sec && Array.isArray(sec.iconHints) && sec.iconHints.length) {
              errors.push(`full mode: card.sections[${i}].iconHints 는 card.layout "ledger" 에서 그려지지 않습니다 — 지우세요 (실선만으로 가른다)`);
            }
          });
        }
        if (!peer && card.sections.length >= 3 && primaries === 0) {
          errors.push('full mode: exactly 1 section must have weight "primary" when there are 3+ sections (위계가 없으면 전부 같은 무게로 읽힌다 — 항목이 전부 동급인 카드는 card.layout: "peer")');
        }
        if (over(card.title, 34)) errors.push('full mode: card.title must be ≤34 chars (이미지 텍스트 오타 방지)');
        if (over(card.lead, 90)) errors.push('full mode: card.lead must be ≤90 chars');
        // ── 표지 문구에 발행 절차를 쓰지 않는다 (2026-09-18 사용자 지적) ──────────
        // DAY 3 표지 lead 가 "마지막 날(PDT 9/17)에 게시된 소식을 다음 날 아침에 정리해요"
        // 였다. 이건 뉴스가 아니라 **우리 발행 절차** 설명이다. 인스타 그리드 썸네일
        // (262x350)에서 이 문장이 두 줄을 먹는데, 독자에게는 아무 정보가 아니다.
        // 표지 lead 는 그날 내용의 요점이어야 한다 — 우리가 언제 어떻게 모으는지가 아니라.
        if (card.layout === 'poster') {
          const PROCESS_SPEAK = [
            ['정리해요', '그날 무슨 일이 있었는지로 바꾸세요'],
            ['정리했어요', '그날 무슨 일이 있었는지로 바꾸세요'],
            ['게시된 소식', '무엇이 발표됐는지 직접 쓰세요'],
            ['다음 날 아침', '발행 시점은 독자 관심사가 아닙니다'],
            ['이 피드에', '피드 구성 설명 대신 내용을 쓰세요'],
            ['이 카드에 담긴', '구성 설명 대신 내용을 쓰세요']
          ];
          for (const [needle, hint] of PROCESS_SPEAK) {
            if (String(card.lead || '').includes(needle)) {
              errors.push(`full mode: 표지 card.lead 에 발행 절차 문구("${needle}")를 쓰지 않습니다 — ${hint}`);
            }
          }
        }
        if (over(card.bubble, 25)) errors.push('full mode: card.bubble must be ≤25 chars');
        card.sections.forEach((section, i) => {
          if (!section || typeof section !== 'object') return;
          const prefix = `full mode: card.sections[${i}]`;
          if (over(section.title, 30)) errors.push(`${prefix}.title must be ≤30 chars`);
          if (section.type === 'note' && over(section.body, 90)) errors.push(`${prefix}.body must be ≤90 chars`);
          (section.items || []).forEach((item, j) => { if (over(item, 60)) errors.push(`${prefix}.items[${j}] must be ≤60 chars`); });
          (section.rows || []).forEach((row, j) => { if (Array.isArray(row) && over(row[1], 40)) errors.push(`${prefix}.rows[${j}] value must be ≤40 chars`); });
        });
      }
      if (!Array.isArray(image.references) || image.references.some(p => typeof p !== 'string' || p.includes('..') || !/^assets\/.*\.(png|jpg|jpeg|webp)$/i.test(p))) errors.push('image.references must be project-relative PNG/JPG/WebP paths');
    }
    if (!brief.source || typeof brief.source !== 'object' || !text(brief.source.label)) errors.push('source.label is required');
    if (!brief.source || !Array.isArray(brief.source.links) || brief.source.links.some(url => typeof url !== 'string' || !/^https:\/\//.test(url))) errors.push('source.links must contain https URLs');

    // ── 출처 다양성 (2026-09-18 사용자 지적: "링크 보니까 다 sf ben이네") ──────
    // DF'26 DAY 3 네 장의 링크 7개가 전부 salesforceben.com 이었다. 원인은 수집기가
    // 아니다 — content/blog.json 에 admin.salesforce.com 의 "Dreamforce 2026 Product
    // Highlights for Admins" 가 이미 들어와 있었는데 초안을 쓰며 그 파일을 안 열었다.
    // 남의 블로그 하나를 받아쓰면 1차 사실(예: 새 Well-Architected 의 다섯 필러 이름)이
    // 통째로 빠지고, 카드가 취재물이 아니라 요약물이 된다.
    // 그래서 링크가 둘 이상이면 도메인이 하나뿐인 것을 막는다. 한 건짜리 카드는
    // 막지 않는다 — 출처가 진짜 하나뿐인 사안이 있다.
    const OFFICIAL_HOST = /(^|\.)salesforce\.com$|(^|\.)force\.com$|(^|\.)trailhead\.com$|(^|\.)tableau\.com$|(^|\.)slack\.com$|(^|\.)mulesoft\.com$/;
    const hostOf = url => { try { return new URL(url).hostname.toLowerCase(); } catch (_) { return ''; } };
    if (brief.source && Array.isArray(brief.source.links) && brief.source.links.length >= 2) {
      const hosts = [...new Set(brief.source.links.map(hostOf).filter(Boolean))];
      if (hosts.length === 1) {
        errors.push(`source.links 가 전부 한 도메인(${hosts[0]}) 입니다 — 1차 출처를 한 건 이상 같이 답니다 (공식 문서·블로그·릴리스 노트). 초안 전에 content/blog.json 을 대조하세요`);
      }
    }
    if (brief.source && Array.isArray(brief.source.links) && brief.source.links.length
        && !brief.source.links.some(u => OFFICIAL_HOST.test(hostOf(u)))) {
      errors.push('source.links 에 Salesforce 공식 도메인이 하나도 없습니다 — 제3자 매체만으로는 카드를 내지 않습니다 (공식 출처가 정말 없으면 그 사실을 source.label 에 적고 이 검사를 예외 처리하세요)');
    }


    // ── 가독성 게이트 (2026-09-15 사용자 지시) ────────────────────────────
    // 독자가 읽는 모든 문구(카드 텍스트 + Slack evidence 코멘트 + Instagram 캡션/대체
    // 텍스트)에 같은 규칙을 적용한다. 근거: 예고 카드 evidence 코멘트가 `적용 범위(원문
    // "Where")` 처럼 영어 절 이름을 괄호로 달고 나갔는데 "읽기 어렵다"는 지적을 받았다.
    // 2026-09-14 규칙이 "한국어로 바꾸고 영어 원문은 괄호에" 였던 게 원인 — 괄호 안 영어가
    // 그대로 노이즈였다. 규칙을 바꾼다: 영어 절 이름은 쓰지 않는다.
    for (const [where, value] of collectReaderText(brief)) {
      // ① 릴리스 노트 절 이름(When/Where/How)을 독자에게 노출하지 않는다.
      //    우리가 어디서 읽었는지는 독자의 관심사가 아니다 — 내용만 쓴다.
      const clause = value.match(/(?:원문\s*)?["'(]?\b(When|Where|How|Why|Who)\b["')]?\s*[:：)]/);
      if (clause) {
        errors.push(`${where}: 릴리스 노트 절 이름("${clause[1]}")을 독자 문구에 쓰지 않는다 — 내용만 한국어로 (적용 범위 · 강제 시점 · 조치 방법)`);
      }
      // ② 조사는 앞말에 붙여 쓴다 (한글 맞춤법 제41항). 영문 뒤에서도 같다.
      //    "Flow Builder 의" → "Flow Builder의". 홀로 뜬 조사 토큰만 잡는다.
      const josa = value.match(/[A-Za-z0-9)\]] (로|으로|의|를|을|이|가|은|는|와|과|에|에서|에게|부터|까지|처럼|보다)(?=[\s,.·)\]]|$)/);
      if (josa) {
        errors.push(`${where}: 조사는 앞말에 붙여 쓴다 — "${josa[0].trim()}" → "${josa[0].replace(' ', '')}"`);
      }
      // ③ Setup 경로는 **카드 본문에서는 한국어**로 쓴다 (2026-09-16 신설).
      //    원인은 언어 미스매치다 — 릴리스 노트는 language=en_US 로 받아 "in Setup" 이라 하고,
      //    기준 org 는 Organization.LanguageLocaleKey = ko 라 화면은 "설정" 이다.
      //    읽던 쪽을 그대로 베끼다 보니 실측 2026-09-16 에 브리프 20개가 `Setup >`, 13개가 `설정 >`
      //    였고 **한 카드 안에서도 갈렸다**(case-merge-setup-preview: 본문 `Setup > 사례 병합`,
      //    evidence `설정 > 사례 병합`). 독자는 Quick Find 에 그대로 붙여 넣는 사람이라
      //    화면에 없는 단어를 주면 못 찾는다. 고객사 org 는 대부분 한국어다.
      //    evidence 코멘트는 막지 않는다 — 영어 org 관리자를 위한 병기 자리다
      //    (`설정 > ID > OAuth 및 OpenID 연결 설정 (Setup > Identity > OAuth and OpenID Connect Settings)`).
      if (where.startsWith('card.')) {
        const path = value.match(/\bSetup\s*>/);
        if (path) {
          errors.push(`${where}: 카드 본문의 Setup 경로는 한국어로 쓴다 — "Setup >" → "설정 >" (영어 병기는 evidence 코멘트에)`);
        }
      }
    }
    return { ok: errors.length === 0, errors };
  }

  function loadBrief(readFile, filePath) {
    let parsed;
    try {
      parsed = JSON.parse(String(readFile(filePath, 'utf8')));
    } catch (error) {
      throw new Error(`${filePath} JSON parse failed: ${error.message}`);
    }
    attachPalette(readFile, filePath, parsed);
    attachLogoTable(readFile, filePath, parsed);
    const result = validateBrief(parsed);
    if (!result.ok) throw new Error(`${filePath} invalid:\n- ${result.errors.join('\n- ')}`);
    return parsed;
  }

  // card.palette → card._palette {strong, soft, ink}. 브리프가 content/briefs/ 에 있든
  // out/card-brief.json 복사본이든 잡히게 상위 폴더 후보를 차례로 본다. 실패는 조용히 —
  // validateBrief 가 "_palette 없음"으로 판정한다.
  function attachPalette(readFile, filePath, brief) {
    const card = brief && brief.card;
    if (!card || !text(card.palette)) return;
    const dir = String(filePath).replace(/[\\/][^\\/]+$/, '');
    const candidates = [dir + '/../palettes.json', dir + '/../content/palettes.json', dir + '/content/palettes.json', 'content/palettes.json'];
    for (const cand of candidates) {
      try {
        const table = JSON.parse(String(readFile(cand, 'utf8')));
        const hit = table && table.palettes && table.palettes[card.palette];
        if (hit) { card._palette = { strong: hit.strong, soft: hit.soft, ink: hit.ink, points: hit.points, hex: hit.hex }; return; }
      } catch (_) { /* 다음 후보 */ }
    }
  }

  // card.logos 슬러그 검사용 표. attachPalette 와 같은 이유로 상위 폴더 후보를 훑는다.
  // 표를 못 찾으면 조용히 넘어간다 — 검증기는 _logoTable 이 있을 때만 슬러그를 본다.
  function attachLogoTable(readFile, filePath, brief) {
    const card = brief && brief.card;
    if (!card || !Array.isArray(card.logos) || !card.logos.length) return;
    const dir = String(filePath).replace(/[\\/][^\\/]+$/, '');
    const candidates = [dir + '/../../assets/logo/index.json', dir + '/../assets/logo/index.json',
                        dir + '/assets/logo/index.json', 'assets/logo/index.json'];
    for (const cand of candidates) {
      try {
        const table = JSON.parse(String(readFile(cand, 'utf8')));
        if (table && table.logos) { card._logoTable = table.logos; return; }
      } catch (_) { /* 다음 후보 */ }
    }
  }

  return { validateBrief, loadBrief };
});
