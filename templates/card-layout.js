// 브리프 섹션에서 존(zone) 기하를 결정적으로 파생하는 단일 진실이다.
// 같은 존 맵이 두 소비자에게 공급된다 —
//   ① prepare-gpt-image-prompt.mjs: GPT Image 2 프롬프트의 레이아웃 문장
//   ② render-cards.mjs / validate-card-brief.mjs: 텍스트 배치 좌표·수용량 검증
// 둘이 갈라지면 GPT가 그린 패널과 코드가 얹는 텍스트가 어긋난다. 기하 상수는
// design/editorial-infographic-dynamic.css 와 같은 값이어야 한다.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CardLayout = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // editorial-infographic-dynamic.css 의 기하 상수.
  // 행 최소는 full 여부와 무관하게 230이다 — grid-auto-rows: minmax(230px, …)가
  // 트랙 최소를 강제해서 .full의 min-height:170px는 실측에 나타나지 않는다.
  const CANVAS = { width: 1024, height: 1536 };
  const GRID = { top: 305, left: 54, width: 916, gap: 18, rowMin: 230 };
  // 패널 허용 하단 = 프롬프트가 GPT에 약속하는 "빈 영역" 하단과 같은 값이어야 한다.
  // 둘이 갈라지면 GPT는 자유 구역인 줄 알고 그린 장식 위에 코드가 패널을 얹는다.
  const BOTTOM_LIMIT = Math.floor(CANVAS.height * 0.95); // 1459px = 95%

  // GPT Image 2 프롬프트에서 쓰는 톤 색 어휘 — tokens/CSS의 톤 팔레트와 1:1.
  // skin·panels 모드 전용이다. full 모드는 ACCENTS + weight 로 색을 파생한다
  // (아래 "색 규율" 주석 참고).
  const TONE_WORDS = {
    blue: 'pale cobalt blue',
    green: 'soft forest green',
    purple: 'gentle lavender purple',
    orange: 'warm apricot orange',
    gold: 'muted mustard gold',
    note: 'calm slate blue'
  };

  // ── full 모드 색 규율 (2026-08-04 피드백 반영) ──
  // 종전에는 브리프가 섹션마다 tone 을 순서로 박아서 카드 한 장에 4~5색이 깔렸다
  // (실측: 브리프 5개 전부 blue·green·purple·orange·note 동일 배열, 카드에서 센 색 7가지).
  // "색이 4개 이상이면 눈이 피로하다"는 피드백의 원인이 이 순서 배정이었다.
  //
  // 이제 색은 의미에서 나온다. 카드 1장 = 강조색 1개 + 중립 1개.
  //   강조색  card.accent 가 정한다 — behavior-changes 의 changeKind 어휘와 같은 축이라
  //           카드 종류가 색으로 구분되는 부수 효과가 생긴다
  //   중립    조치·배경 패널 전부. 정보이지 경고가 아닌 것은 색을 쓰지 않는다
  const ACCENTS = {
    removed:  { strong: 'deep crimson red',    soft: 'pale blush pink' },
    enforced: { strong: 'strong amber orange', soft: 'pale apricot cream' },
    default:  { strong: 'deep cobalt blue',    soft: 'pale sky blue' },
    changed:  { strong: 'deep teal',           soft: 'pale mint' },
    event:    { strong: 'deep violet',         soft: 'pale lavender' }
  };
  const NEUTRAL = { strong: 'dark slate gray', soft: 'very light warm gray' };

  // ── 로고 밴드 (2026-09-17 신설) ──────────────────────────────────────
  // 제품 로고는 GPT 가 그리지 않는다 — 이미지 모델은 로고를 못 그리고, 뉴스 카드에서
  // "비슷하지만 틀린" 로고는 없느니만 못하다. 대신 bin/compose-logos.mjs 가 실물 SVG 를
  // 생성된 PNG 위에 얹는다. GPT 가 무엇을 어디에 그렸는지 우리는 모르므로 반대로 한다:
  // 프롬프트가 이 고정 밴드를 "비워라"고 지시하고, 합성기가 같은 상수를 읽어 그 자리에
  // 얹는다. 양쪽 다 이 값을 쓰므로 좌표가 어긋날 수 없다.
  // 2색 규율의 예외 둘 (2026-09-18). 로고와 사람은 "원래 색"이어야 현실감이 산다는 사용자
  // 판단이다. 규율 자체는 살려 둔다 — 예외를 이 두 가지로 못 박아야 나머지가 흐트러지지 않는다.
  const PALETTE_EXCEPTION = ' Exceptions: real product logos, human figures, and any depicted real-world object that has a colour of its own (metal is metal-grey, a key is brass, a screen glows its own colour, skin is skin, clothing is cloth-coloured) are drawn in those true colours and are exempt from the hue count. Everything structural — panels, header bars, rules, captions, number badges — stays inside the card palette.';

  // ── 중요도 계단 (2026-09-18) ────────────────────────────────────────
  // 사용자 지시: "중요한 걸 상단에 두고, 아래로 내려가면서 같은 색상인데 채도를 낮춰
  // 그라데이션 느낌". 종전의 3색 순환(퍼플·틸·핑크)은 알록달록했을 뿐 순서를 말하지 않았다.
  // 한 색이 위에서 아래로 옅어지면 색 자체가 "위가 더 중요하다"를 말한다.
  //   섹션 순서 = 중요도 순서다. 초안이 쓴 순서가 그대로 계단이 된다.
  const hexToHsl = hex => {
    const n = parseInt(hex.replace('#', ''), 16);
    const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, dc = mx - mn;
    if (!dc) return [0, 0, l];
    const sat = l > 0.5 ? dc / (2 - mx - mn) : dc / (mx + mn);
    let h = mx === r ? (g - b) / dc + (g < b ? 6 : 0) : mx === g ? (b - r) / dc + 2 : (r - g) / dc + 4;
    return [h * 60, sat, l];
  };
  const hslToHex = (h, s, l) => {
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
      : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return '#' + [r, g, b].map(v => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
  };
  // 단계마다 채도를 내리고 밝기를 올린다. 4단계를 넘어가면 배경과 구분이 안 되므로 바닥을 둔다.
  // 계단 어휘. ink 기준으로 바뀌면서 'pale' 은 거짓말이 됐다 — 5단계도 흰 글자가 읽히는
  // 짙기다. 밝기가 아니라 **깊이**를 말하는 말로 바꾼다.
  const RAMP_WORDS = ['deepest', 'deep', 'mid-depth', 'lighter but still deep', 'lightest of the ladder, still dark enough for white text'];
  function toneRamp(hex, count) {
    const [h, s, l] = hexToHsl(hex);
    return Array.from({ length: count }, (_, i) => {
      const t = count < 2 ? 0 : Math.min(i / (count - 1), 1);
      const sat = Math.max(s * (1 - 0.62 * t), s * 0.32);
      const lig = Math.min(l + (0.86 - l) * 0.55 * t, 0.86);
      return `${RAMP_WORDS[Math.min(i, RAMP_WORDS.length - 1)]} ${hslToHex(h, sat, lig)}`;
    });
  }

  const eventColorClause = brief => {
    const pts = brief.card && brief.card._palette && brief.card._palette.points;
    if (!Array.isArray(pts) || !pts.length) return '';
    return `Tone ladder (important): the section header bars are the DARK structure of this card. They all use the same deep hue, stepping from the darkest at the top to a lighter slate further down, so the colour itself says which section matters most. The exact tone for each panel is named in the panel list below; use those values and no others. Header bar text is white — it must stay clearly legible against every step of that ladder, so no step is ever pale. Row icons are NOT on the ladder: they sit on the white panel body and are drawn in the bright accent colour named for each panel. Body text and hairline rules stay near-black and neutral gray.`;
  };

  // 색 규율 한 곳에서 (2026-09-18). 종전에는 같은 문장이 세 컴포저에 복사돼 있어 한쪽만
  // 고치면 갈라졌다. 행사 팔레트가 있으면 "제3색 금지"를 풀어야 한다 — 포인트 색을 쓰라고
  // 아래에서 지시해 놓고 여기서 막으면 자기모순이고, 모델은 앞선 금지를 따른다(실측).
  function colorDisciplineClause(brief, accent, extra) {
    const pts = brief.card && brief.card._palette && brief.card._palette.points;
    const cap = Array.isArray(pts) && pts.length
      ? ' Beyond that hue, only the event point colours listed below may appear, and only in the small roles named there — no other hue is invented.'
      : ' Do not introduce any third hue.';
    return `Color discipline (important): the card is built on ONE hue — ${accent.strong} as the single structural accent — with ${NEUTRAL.strong} as the neutral, on a cool very light gray-white background.`
      + cap + (extra || '') + PALETTE_EXCEPTION;
  }

  // ── 포인트 색 (2026-09-18) ──────────────────────────────────────────
  // 사용자 지적: 카드가 통째로 한 파랑이라 단색으로 보인다. DF'26 팔레트에는 포인트 색이
  // 셋 있는데 프롬프트가 한 번도 이름을 부르지 않아 모델이 쓸 수가 없었다. 톤 계단은
  // 머리띠의 **순서**를 맡고, 포인트 색은 작은 자리에서 **강세**를 맡는다 — 역할을 갈라
  // 놓아야 알록달록해지지 않는다. 면적 상한을 문장에 박는 이유도 같다.
  const pointAccentClause = brief => {
    const pts = (brief.card && brief.card._palette && brief.card._palette.points) || [];
    if (!Array.isArray(pts) || !pts.length) return '';
    // 셋을 다 쓰면 캠페인 키아트 색끼리 싸운다 (2026-09-18: 연보라 배지를 하늘색 머리띠에
    // 얹었더니 대비 1.13:1, 사용자 반려). 구조는 ink 계단이 잡고, 포인트 색은 **카드 전체에
    // 딱 한 번** 시선을 꽂는 데만 쓴다. 한 번뿐이니 어느 색이든 싸울 상대가 없다.
    const one = pts[pts.length - 1];
    return `One highlight colour: ${one} appears EXACTLY ONCE on the whole card — a single underline, arrow, tick or small mark on the one line that matters most. It never fills a header bar, never colours a body sentence, never repeats. Everywhere else the card stays on its dark structural tone, the bright accent and the neutrals. Do not introduce the other campaign colours.`;
  };

  // 로고는 헤더 우상단에 앉는다 (2026-09-18 · 이전에는 하단 전폭 밴드였다).
  // 왜 옮겼나: 전폭 밴드가 캔버스 높이의 7.5% 를 통째로 먹는데 로고가 한두 개면 그 자리가
  // 거의 비어 있었다 — 본문에 줄 수 있는 공간을 장식이 잡고 있던 셈이다(사용자 지적).
  // 우상단은 종전에 마스코트가 쓰던 자리라 제목과 부딪히지 않는 폭 규율이 이미 검증돼 있다.
  const LOGO_SLOT = { top: 0.016, right: 0.045, height: 0.034, maxWidth: 0.30 };

  // ── 배경 규율 (2026-09-17) ──────────────────────────────────────────
  // 마스코트 참조 PNG 를 -i 로 붙이던 동안에는 그 깨끗한 플랫 이미지가 렌더 톤의 앵커였다.
  // 참조를 떼자 모델이 빈 배경을 안개·글로우·어두운 그라디언트로 채우기 시작했고, 그 대기
  // 효과가 헤더를 덮어 제목이 안 읽혔다. 실측(2026-09-17 DF'26 13장): 이 문장을 우연히
  // 갖고 있던 카드(로고 밴드 절의 "background color only")는 5/5 깨끗, 없는 카드는 5/5 흐림.
  // 한 장은 캔버스 전체가 어둠에 묻혀 폐기했다. 그래서 골격과 무관하게 항상 박는다.
  const BACKGROUND_CLAUSE = 'Background discipline (critical): the CANVAS BACKGROUND — the empty area behind and between the panels — is ONE flat very light cool gray-white, edge to edge, a shade that sits in the same cool family as the card hues rather than a warm cream. That background carries no gradient, no fog, no haze, no glow, no vignette, no atmospheric depth, no darkening and no shadow spill. Every panel, icon and letter sits crisply on it, fully opaque and fully legible — nothing may be veiled, dimmed or blurred, least of all the header. This rule governs the background ONLY. The shapes drawn on top of it are modelled as described under Rendering, and that modelling is not a violation of this rule.';

  // ── 입체 규율 (2026-09-18) ──────────────────────────────────────────
  // 사용자 지적: "이미지 들어가는 것까지 단색이라 현실감이 떨어진다". 원인은 위 배경 규율이다 —
  // 안개를 막으려고 "그라디언트·그림자·깊이 금지"를 전역으로 썼더니 모델이 캔버스가 아니라 **모든
  // 도형**에 적용했다. 그래서 인물도 소품도 아이콘도 한 색으로 부어 놓은 실루엣이 됐다(실측:
  // architect-keynote 의 가위·열쇠·얼굴이 전부 같은 파랑). 배경은 평평하게 두되 도형 안쪽은
  // 면을 나눠 형태를 만들게 분리한다. 플랫 벡터의 반대말은 입체가 아니라 사진이다.
  const MATERIAL_CLAUSE = 'Rendering (important): "flat vector" here means no photographic texture and no 3D render — it does NOT mean every shape is a single pour of one color. Give the drawn objects form. Build each object from two or three tones of its own color: a base tone, a darker tone on the side turned away from the light, and a lighter tone on the lit edge — so a cylinder reads round, a folded surface reads folded, and a face has a jaw and a cheek rather than a silhouette. Light falls consistently from the upper left. Use crisp hard-edged tone breaks, never soft airbrush blends. Vary line weight — a heavier outline around the main subject, hairlines on the details behind it. Panels may carry one very soft contact shadow directly beneath them. Hard limit: the tone break is a FLAT SHAPE with a crisp edge, the way a screen-printed poster separates colours — never a rounded 3D bevel, never a plastic or glassy highlight, never an airbrushed falloff, never a rendered drop shadow inside an object. This limit binds hardest on the LARGEST objects: a big single illustration gets fewer tones, not more, because at that size any softness reads as a 3D render. All of this modelling lives INSIDE the shapes and never leaks onto the canvas background.';

  // ── 등장인물 (2026-09-17 신설) ──────────────────────────────────────
  // 뉴스에 실제로 나온 사람을 그린다 — 우리 마스코트가 아니라. 사용자가 참조로 든 인포그래픽이
  // 이렇게 했고, 발표자 얼굴이 있으면 "누가 한 말인지"가 한눈에 붙는다.
  // 주의: 실존 인물의 생성 이미지라 닮음이 보장되지 않는다. 이름표를 반드시 같이 그려
  // 그림이 아니라 이름이 신원을 책임지게 한다.
  const figuresClause = (figures, accent) => {
    if (!Array.isArray(figures) || !figures.length) return '';
    const each = figures.map(f =>
      `${q(f.name)} (${f.look}), with the name ${q(f.name)} and the affiliation ${q(f.role)} set beside the portrait`
    ).join('; and ');
    // 2026-09-18 사용자 지시: "인물이나 로고등은 원래 색상으로 보여야 현실감을 더 느낄거같아".
    // 종전에는 강조색 단색으로 묶어 2색 규율을 지켰는데, 그러면 사람이 아니라 아이콘으로 읽혔다.
    // 자연스러운 피부·머리·옷 색을 허용하되 배경과 장식은 카드 색 규율 안에 남긴다.
    return `Portraits: draw ${figures.length} head-and-shoulders portrait illustration${figures.length > 1 ? 's' : ''} in a flat vector editorial style, with NATURAL lifelike coloring — real skin tone, real hair color, real clothing color — so each person reads as a recognizable human, not an icon. The portrait's own colors are exempt from the card's two-hue rule; everything around it (panel, rules, captions) stays within the card palette. ${each}. Keep each portrait no wider than 20% of the canvas, and place all portraits together in one dedicated strip across the bottom of the body area, BELOW the last content panel. Critical: the portraits are an addition, not a replacement — every quoted body line listed elsewhere must still be rendered in full, in its own row, with its own text intact. Do not substitute a portrait or a name label for any body line.`;
  };

  const logoBandClause = logos => {
    if (!Array.isArray(logos) || !logos.length) return '';
    const top = Math.round(LOGO_SLOT.top * 100);
    const bot = Math.round((LOGO_SLOT.top + LOGO_SLOT.height) * 100);
    const w = Math.round(LOGO_SLOT.maxWidth * 100);
    return `Reserved slot (critical): keep the TOP-RIGHT corner empty — the region from ${top}% to ${bot}% of the canvas height and from ${100 - w}% to 100% of the canvas width must contain background color only: no text, no chip, no icon, no shape. Real product logos are composited there afterwards. The eyebrow chip sits at the top LEFT on the same row. The title starts BELOW that row — its first line must not begin higher than 8% of the canvas height, and no letter of the title may enter the reserved corner.`;
  };

  // 섹션 무게 — 위계를 만드는 축. primary 하나가 카드를 지배하고 나머지는 물러난다.
  // 종전에는 4패널이 같은 크기·같은 헤더 처리라 "왜 바뀌나요?"(배경)가 "무엇이
  // 달라지나요?"(핵심)와 같은 무게였다. 전부 강조하면 아무것도 강조되지 않는다.
  const WEIGHTS = new Set(['primary', 'secondary', 'aside']);
  const weightOf = section => (WEIGHTS.has(section.weight) ? section.weight : 'secondary');
  // 이벤트 카드는 행사 팔레트가 의미색보다 먼저다 (card.palette → loadBrief 가 붙인 _palette).
  const accentOf = brief => (brief.card && brief.card._palette)
    || ACCENTS[(brief.card && brief.card.accent)] || ACCENTS.changed;

  // negativePrompt에 반드시 있어야 하는 금지어 — 없으면 자동 보강한다.
  // skin/panels: 텍스트는 코드가 조판하므로 이미지 속 텍스트를 전면 금지.
  // full: GPT가 텍스트까지 그리므로 텍스트 금지 대신 오타·잡문자·타사 로고를 금지.
  const REQUIRED_NEGATIVES = [
    'readable text', 'Korean letters', 'English letters',
    'numbers', 'logos', 'watermark'
  ];
  const FULL_MODE_NEGATIVES = [
    'misspelled Korean', 'gibberish characters', 'lorem ipsum',
    'third-party company logos', 'watermark', 'photorealistic rendering', 'blurry text',
    // 색 규율 보강 — 프롬프트 본문의 "TWO hues" 지시와 같은 축이다.
    'rainbow palette', 'more than two accent colors', 'multicolored icons',
    // 배경 규율 (2026-09-17 실측) — 참조 PNG 를 떼자 모델이 빈 배경을 안개로 채웠다.
    'fog', 'haze', 'vignette', 'gradient background', 'dark background',
    // 단색 평면화 방지 (2026-09-18) — 같은 아이콘 반복·한 색 실루엣이 카드를 스톡 클립아트로 만든다.
    'repeated identical icons', 'single-fill silhouettes',
    'atmospheric lighting', 'blurred text', 'translucent overlay'
  ];
  // card.logos 가 있는 카드에서는 로고 금지어를 뺀다 (2026-09-17). 우리는 여전히 GPT 가
  // 로고를 그리길 원하지 않지만, 금지어를 그대로 두면 "이 밴드를 비워라 / 로고는 금지다"가
  // 한 프롬프트 안에서 부딪혀 모델이 밴드까지 본문으로 채워 버린다. 로고를 안 그리게 하는
  // 일은 밴드 예약 문장 하나가 맡는다.
  const LOGO_NEGATIVE = 'third-party company logos';
  const FIGURE_CONFLICTS = new Set(['more than two accent colors', 'multicolored icons']);

  // CSS min-height 아래로는 내려가지 않고, 내용이 많으면 max-content로 자란다.
  // 여기 추정은 캡처 크기를 정하는 게 아니라(그건 shoot.sh 실측) 수용량 초과와
  // panels 모드 % 대역을 렌더 전에 잡기 위한 보수적 근사다. 텍스트 길이를 무시하면
  // 긴 항목이 스키마를 통과하고도 하단이 소리 없이 잘리므로 줄 수를 근사한다.

  // CJK는 전각(≈폰트 크기), 라틴·숫자·공백은 반각(≈0.55em)으로 센다.
  const CJK_RE = /[ᄀ-ᇿ⺀-鿿가-힯豈-﫿！-｠]/;
  function textUnits(value) {
    let units = 0;
    for (const ch of String(value)) units += CJK_RE.test(ch) ? 1 : 0.55;
    return units;
  }
  const lineCount = (value, unitsPerLine) => Math.max(1, Math.ceil(textUnits(value) / unitsPerLine));

  function estimateSectionHeight(section) {
    const chrome = 43 + 56; // padding(23+20) + header(38 + margin 18)
    // 반열 텍스트 폭 ≈ 363px, full 이면 두 열 폭. 폰트 크기로 나눠 전각 단위/줄.
    const halfCols = section.full ? 48 : 21;   // list: 17px 폰트
    const compareCols = section.full ? 39 : 16; // compare 값: 18px 폰트, 라벨 120px 제외
    let body = 0;
    if (section.type === 'compare') {
      body = section.rows.reduce((sum, row) =>
        sum + Math.max(57, lineCount(row[1], compareCols) * 23 + 12), 0)
        + (section.rows.length - 1) * 13;
    } else if (section.type === 'flow') {
      body = 132;
    } else if (section.type === 'note') {
      body = lineCount(section.body, 19) * 27 + 18 + 21; // 20px 폰트 · max-width 385px
    } else {
      const items = section.items || [];
      body = items.reduce((sum, item) => sum + Math.max(24, lineCount(item, halfCols) * 22), 0)
        + Math.max(0, items.length - 1) * 8;
    }
    return Math.max(GRID.rowMin, chrome + body);
  }

  // CSS grid auto-flow와 같은 순서로 행을 채운다: full은 행 독점, 나머지는 2열 짝.
  function computeLayout(sections) {
    const rows = [];
    let pending = null;
    sections.forEach((section, index) => {
      const h = estimateSectionHeight(section);
      if (section.full) {
        if (pending) { rows.push(pending); pending = null; }
        rows.push({ cells: [{ index, section }], height: h, full: true });
        return;
      }
      if (pending) {
        pending.cells.push({ index, section });
        pending.height = Math.max(pending.height, h);
        rows.push(pending);
        pending = null;
      } else {
        pending = { cells: [{ index, section }], height: h, full: false };
      }
    });
    if (pending) rows.push(pending);

    let y = GRID.top;
    for (const row of rows) {
      row.topPx = y;
      row.bottomPx = y + row.height;
      y = row.bottomPx + GRID.gap;
    }
    const bottom = rows.length ? rows[rows.length - 1].bottomPx : GRID.top;
    return { rows, bottom, fits: bottom <= BOTTOM_LIMIT };
  }

  const pct = px => Math.round((px / CANVAS.height) * 100);

  function describeRow(row, i) {
    const range = `about ${pct(row.topPx)}%–${pct(row.bottomPx)}% of the canvas height`;
    if (row.cells.length === 1) {
      const tone = TONE_WORDS[row.cells[0].section.tone] || TONE_WORDS.note;
      const span = row.full ? 'one full-width panel' : 'one panel in the left column';
      return `- Row ${i + 1} (${range}): ${span}, tinted very lightly in ${tone} with a slightly darker ${tone} rounded border.`;
    }
    const left = TONE_WORDS[row.cells[0].section.tone] || TONE_WORDS.note;
    const right = TONE_WORDS[row.cells[1].section.tone] || TONE_WORDS.note;
    return `- Row ${i + 1} (${range}): two side-by-side panels — left tinted very lightly in ${left}, right in ${right}, each with a slightly darker rounded border of its own color.`;
  }

  function layoutClause(brief) {
    const mode = (brief.image && brief.image.layoutMode) || 'skin';
    if (mode === 'skin') {
      // 비움 대역 하단을 fits 상한과 같은 소스에서 파생한다 — 리터럴로 두 벌 적으면 갈라진다.
      return `Layout: keep the header zone (top ${pct(GRID.top)}% of the canvas) light and calm, and keep the entire central region between ${pct(GRID.top)}% and ${pct(BOTTOM_LIMIT)}% of the height completely empty and undecorated — production code will overlay information panels there. Decoration belongs only along the outer edges and corners.`;
    }
    const layout = computeLayout(brief.card.sections);
    const lines = layout.rows.map(describeRow);
    return [
      `Layout: below the light header zone (top 20% of the canvas), draw exactly ${brief.card.sections.length} empty rounded-rectangle panels arranged in a two-column grid with even gutters, occupying the horizontal band from 5% to 95% of the canvas width:`,
      ...lines,
      'Every panel interior must stay completely blank — no text, no icons, no lines, no placeholder marks. Production code will typeset the real content inside each panel, so panel positions must follow this arrangement exactly.'
    ].join('\n');
  }

  // 마스코트를 그릴지는 브리프의 image.references 하나가 정한다 (2026-09-17 단일화).
  // 프롬프트 문장과 codex 의 -i 첨부가 같은 조건을 봐야 한다 — 종전에는 generate-card.sh 가
  // 마스코트 PNG 를 무조건 첨부해, 문장이 없어도 캐릭터가 그려졌다.
  const hasMascotRef = references =>
    Array.isArray(references) && references.some(p => /mascot/i.test(p));

  function mascotClause(references, action) {
    if (!hasMascotRef(references)) return '';
    const identity = 'a white brick golem with two round black eyes and a single sky-blue brick on its left shoulder — match the reference image exactly for body shape, eyes and the blue brick';
    if (action) {
      // full 모드 연출: 정체성은 고정, 포즈·소품만 카드마다 변주한다.
      // 폭 상한을 18% → 14% 로 줄였다 (2026-08-04). 종전에는 마스코트+소품 클러스터가
      // 헤더 폭 3분의 1을 먹어 타이틀이 좁은 칼럼으로 밀려 2줄로 접혔다.
      return `Character: the brick mascot (${identity}), placed in the upper-right corner of the header, ${action}. Any prop it holds is drawn only in the card's accent color or the neutral gray — the prop must not introduce a new hue. Keep it charming and small (no wider than 14% of the canvas) and never let it crowd or wrap the title text — the title takes priority for horizontal space.`;
    }
    return `Mascot: include the brick mascot from the reference image in the lower-right corner — ${identity}. Keep it no wider than 15% of the canvas, and never let it overlap the panel area.`;
  }

  // ── full 모드: GPT Image 2가 텍스트까지 카드 전체를 그린다 ──
  // 레퍼런스 카드뉴스의 시각 문법을 코드화한 합성기다. 모든 한국어 문구는
  // 브리프 원문을 따옴표로 고정해 넣고, 목록에 없는 텍스트 생성을 금지한다.
  // 생성 후 사람·Claude가 PNG를 브리프와 글자 단위로 대조하는 교정이 필수다 —
  // audit-share.sh는 픽셀 속 텍스트를 검사하지 못한다.
  const q = value => `"${String(value).replace(/"/g, "'")}"`;

  // 무게가 패널의 크기·헤더 처리·색을 한꺼번에 정한다. 색은 강조색 아니면 중립뿐이다.
  function weightStyle(weight, accent, peer) {
    // peer = 동급 나열 (2026-09-15). 무게 축을 끄고 전 패널을 같은 크기·같은 헤더로 그린다.
    // weight 값이 남아 있어도 무시한다 — 검증기가 primary 를 이미 막지만, 렌더 쪽도 독립적으로
    // 동급을 보장해야 "한 패널만 커지는" 증상이 프롬프트 경로로 되살아나지 않는다.
    if (peer) {
      return {
        span: ' (one cell of the grid, exactly the same size as every other body panel)',
        header: `a ${NEUTRAL.strong} filled header bar`,
        headText: 'bold white Korean text',
        body: 'Use the same body text size as every other panel.'
      };
    }
    if (weight === 'primary') {
      return {
        span: ' (full width, the most prominent panel of the body)',
        header: `a ${accent.strong} filled header bar`,
        headText: 'bold white Korean text at the largest panel-header size',
        body: 'Body rows use the largest body text size of any panel.'
      };
    }
    if (weight === 'aside') {
      return {
        span: ' (compact, visually quietest — this is background context, not an action)',
        header: `a thin ${NEUTRAL.strong} outlined header strip with no fill`,
        headText: `${NEUTRAL.strong} Korean text at the smallest panel-header size`,
        body: 'Keep this panel shorter than the others and use the smallest body text size.'
      };
    }
    return {
      span: '',
      header: `a ${NEUTRAL.strong} filled header bar`,
      headText: 'bold white Korean text',
      body: ''
    };
  }

  function fullSectionClause(section, index, accent, peer, pointColor, badgeColor) {
    const weight = weightOf(section);
    const st = weightStyle(weight, accent, peer);
    // 행사색 (2026-09-18). 전역으로 "머리띠를 행사색으로 돌려라"만 적으면 무시된다 —
    // 패널마다 "a bright sky blue filled header bar" 라는 더 구체적인 지시가 앞서 이기기
    // 때문이다(실측). 그래서 색을 패널 절 자체에 박는다. 테두리만 있는 aside 는 건드리지
    // 않는다 — 조용한 패널이 색을 얻으면 위계가 뒤집힌다.
    if (pointColor && /filled header bar/.test(st.header)) {
      st.header = st.header.replace(/a .*? filled header bar/, `a ${pointColor} filled header bar`);
    }
    const width = section.full && weight !== 'primary' ? ' (full width)' : st.span;
    // 번호는 제목 문자열이 아니라 **배지**다 (2026-09-17). 종전에는 "1. 무엇이 되나요" 처럼
    // 한 덩어리로 넘겨, 번호가 제목 글자와 같은 크기·같은 색으로 흘러 스캔 동선이 안 생겼다.
    // 두 자리(01·02)로 고정한 건 한 자리 숫자가 배지 안에서 외로워 보이기 때문이다.
    const badge = String(index + 1).padStart(2, '0');
    // 배지는 머리띠 **위에** 얹힌다. 머리띠 톤 계단과 같은 계열이면 대비가 사라진다
    // (연보라 배지 on 하늘색 바 = 1.13:1, 사용자 지적 "무슨 연보라야, 가독성 떨어짐").
    // 어두운 머리띠 위에 밝은 강조색을 얹으면 6.83:1 이 나온다.
    const badgeFill = badgeColor ? `filled ${badgeColor} with near-black digits` : 'outlined';
    // 아이콘 색은 iconHints 유무와 무관하게 박는다 — 힌트가 없어도 모델은 아이콘을 그리고,
    // 그때 색 지시가 없으면 강조색 하나로 통일돼 카드가 단조로워진다(2026-09-18 사용자 지적).
    // 아이콘은 머리띠가 아니라 **흰 패널 본문** 위에 앉는다. 머리띠 톤 계단(네이비 계열)을
    // 그대로 쓰면 아래 패널로 갈수록 흐려져 안 보인다. 강조색을 쓰되 패널마다 농도를 달리한다.
    const iconTone = badgeColor
      ? ` Every small icon inside this panel is drawn in ${badgeColor}, flat and monochrome — never multicolored within a single icon.`
      : '';
    const head = `Panel ${index + 1}${width}: rounded white panel with ${st.header}; at the left end of that header sits a small square badge, ${badgeFill}, reading ${q(badge)} in bold, then the title ${q(section.title)} in ${st.headText}.${iconTone}`;
    const tail = st.body ? ' ' + st.body : '';
    // 아이콘 색도 패널 절에 박는다. 전역 문장만 두면 패널별 지시가 이겨 무시된다 —
    // 머리띠에서 이미 겪은 함정이다(2026-09-18).
    const iconColor = badgeColor ? ` in ${badgeColor}` : '';
    const icon = i => (section.iconHints && section.iconHints[i]) ? ` beside a small flat${iconColor} ${section.iconHints[i]} icon` : '';
    if (section.type === 'compare') {
      // 전후 대비는 강조색 대 중립으로 읽힌다 — 두 색을 쓰면 대비가 아니라 장식이 된다.
      return head + ' Inside, stacked labeled rows: ' + section.rows.map((row, i) =>
        `a ${i === 0 ? NEUTRAL.strong : accent.strong} label chip ${q(row[0])} followed by the text ${q(row[1])}`).join('; ') + '.' + tail;
    }
    if (section.type === 'flow') {
      return head + ` Inside, a horizontal flow of ${section.steps.length} rounded chips connected by arrows, reading ${section.steps.map(q).join(' → ')}.` + tail;
    }
    if (section.type === 'note') {
      return `Panel ${index + 1} (full-width highlight band, ${accent.soft} tint with a ${accent.strong} left edge): bold Korean text ${q(section.body)} with a small caption ${q(section.source)}.`;
    }
    return head + ' Inside, ' + section.items.map((item, i) =>
      `a row${icon(i)} reading ${q(item)}`).join('; ') + '.' + tail;
  }

  // 표지(poster) — 연례 이벤트 레인의 첫 장 (2026-09-17 신설).
  // 일상 카드와 명도로 가르지 않는다(사용자 반려). 가르는 축은 **텍스처**다: 일상 카드는
  // 패널 6~7개가 만드는 가로 줄무늬이고, 표지는 큰 덩어리 2~3개다. 인스타 프로필 그리드
  // 썸네일(262x350)에서는 글자가 안 읽히므로 이 질감 차이만 신호로 남는다.
  function composePosterPrompt(brief) {
    const card = brief.card;
    const accent = accentOf(brief);
    const hasMascot = hasMascotRef(brief.image.references);
    const bubble = card.bubble ? ` A small speech bubble from the character reads ${q(card.bubble)}.` : '';
    // 캐릭터가 없으면 말풍선의 화자도 없다 — 인용 띠로 내린다.
    const bubbleOnly = card.bubble
      ? `5) Near the bottom, a single quiet line ${q(card.bubble)} in ${accent.strong}, set off by a short horizontal rule above it. No speech bubble, no character.`
      : '';
    const refLabel = hasMascot
      ? 'Reference images: Image 1 is the brick mascot identity reference — copy its body shape, round black eyes and the sky-blue brick exactly; it defines the character, not the layout.'
      : '';
    const lines = [];
    (card.sections || []).forEach(section => {
      if (section.type === 'compare') {
        lines.push(`a single centered row of ${section.rows.length} items, each an ${accent.strong} label chip ${''}${section.rows.map(r => `${q(r[0])} above the larger text ${q(r[1])}`).join(', then ')}`);
      } else {
        lines.push(`${section.items.length} short centered lines of large text, reading ${section.items.map(q).join(', then ')}`);
      }
    });
    return [
      `A vertical ${CANVAS.width}x${CANVAS.height} pixel (2:3 portrait) Korean poster-style cover card. Flat vector illustration on a cool light gray-white background. This is a COVER, not an information sheet: very few, very large elements and a lot of empty space. All quoted strings below are EXACT text to render verbatim.`,
      brief.image.prompt,
      refLabel,
      colorDisciplineClause(brief, accent, ' The background stays light; do NOT darken the canvas.'),
      BACKGROUND_CLAUSE,
      MATERIAL_CLAUSE,
      `Composition, in this exact vertical order, centered, with generous empty margins between every element:`,
      `1) A single wide solid ${accent.strong} band across the upper area, with the text ${q(card.eyebrow || brief.source.label)} inside it in bold white Korean and English letters.`,
      `2) The title ${q(card.title)} in enormous very bold near-black Korean lettering — by far the largest text on the canvas, cap height roughly 4 times the body text, occupying up to two lines and nearly the full width.`,
      `3) A single line ${q(card.lead)} in medium gray, clearly smaller than the title.`,
      lines.length ? `4) Then ${lines.join('; then ')}. Draw these as plain text on the background — NO panel boxes, NO cards, NO header bars, NO icons, NO bullet marks.` : '',
      // mascotClause 는 일상 카드용이라 "헤더 우상단 · 폭 14% 이하"를 박는다. 포스터에서는
      // 마스코트가 큰 덩어리 셋 중 하나라 그 문장을 쓰면 서로 모순된다 — 여기서 따로 쓴다.
      // references 에 마스코트가 없으면 이 항목 자체를 넣지 않는다 (2026-09-17): 이벤트 레인은
      // 브릭 캐릭터를 쓰지 않는다 — 행사 카드에 우리 마스코트가 서 있으면 행사 소식이 아니라
      // 우리 홍보물로 읽힌다(사용자 반려).
      hasMascot
        ? `5) The brick mascot (a white brick golem with two round black eyes and a single sky-blue brick on its left shoulder — match the reference image exactly for body shape, eyes and the blue brick), drawn LARGE at roughly one third of the canvas width, centered near the bottom of the composition, ${brief.image.mascotAction || 'looking at the reader'}. Any prop it holds is drawn only in the accent color or the neutral gray.${bubble}`
        : bubbleOnly,
      logoBandClause(card.logos),
      `Footer, bottom edge: a slim bar reading ${q(brief.source.label)}.`,
      `Strictly forbidden on this card: rounded white panels, panel grids, two-column layouts, numbered panel headers, tables, list bullets, small body text blocks. The card must read as a poster at thumbnail size, with no more than four large shapes.`,
      ICON_RULE,
      ILLUSTRATION_TEXT_RULE,
      'Text fidelity is critical: render every quoted Korean and English string EXACTLY as written, character for character — do not paraphrase, translate, abbreviate or invent any text. No text may appear anywhere on the card other than the quoted strings.'
    ].filter(Boolean).join('\n\n');
  }

  // ── 레이아웃 변형 (2026-09-17 신설) ────────────────────────────────
  // 인스타 그리드·슬랙 타임라인에서 카드가 매일 같아 보이는 문제. full 모드는 코드가
  // 글자를 얹지 않으므로(render-cards.mjs) 배치는 전부 이 프롬프트가 정한다 —
  // 렌더러 결합 없이 골격만 갈아끼울 수 있다. 가르는 축은 명도가 아니라 **질감**이다:
  //   grid     둥근 흰 패널 6~7개 = 가로 줄무늬
  //   timeline 세로 축 + 노드     = 세로 줄무늬
  //   ledger   패널 없음, 가로 실선만 = 평평하고 성김
  //   poster   큰 덩어리 3~4개    = 구분자
  // 썸네일(262x350)에서는 글자가 안 읽히므로 이 질감 차이만 신호로 남는다.

  // 공통 머리·꼬리. 변형마다 다시 쓰면 색 규율·텍스트 충실도 문장이 갈라진다.
  function headerClauses(brief, accent) {
    const card = brief.card;
    const mascot = hasMascotRef(brief.image.references);
    const bubble = !card.bubble ? ''
      : mascot ? ` A small speech bubble from the character reads ${q(card.bubble)}.`
      : ` To the right of the subtitle, the short phrase ${q(card.bubble)} sits inside a small ${accent.soft} rounded tag — plain text, no speech bubble and no character.`;
    const refLabel = mascot
      ? 'Reference images: Image 1 is the brick mascot identity reference — copy its body shape, round black eyes and the sky-blue brick exactly; it defines the character, not the layout.'
      : '';
    return [
      brief.image.prompt,
      refLabel,
      colorDisciplineClause(brief, accent),
      BACKGROUND_CLAUSE,
      MATERIAL_CLAUSE,
      `Header, top of canvas (all text EXACT, verbatim): first a small pill-shaped chip reading ${q(card.eyebrow || brief.source.label)} — thin ${NEUTRAL.strong} outline, no fill, quiet ${NEUTRAL.strong} letters. Then the main title ${q(card.title)} as the single most dominant element: very bold near-black Korean lettering, cap height roughly 2.5 times the body text, spanning the full text column (up to two lines). Then a one-line subtitle ${q(card.lead)} in medium gray at clearly smaller size.${bubble}`,
      mascotClause(brief.image.references, brief.image.mascotAction || 'looking at the reader'),
      eventColorClause(brief),
      pointAccentClause(brief),
      figuresClause(card.figures, accent),
      logoBandClause(card.logos)
    ].filter(Boolean);
  }

  // 아이콘은 추상 기호다. 실물 로고는 코드가 하단 밴드에 얹는다(compose-logos.mjs).
  const ICON_RULE = 'Icon rule (critical): never draw a company logo, brandmark, wordmark or app icon anywhere on the card, even when the line of text beside it names that company — a drawn logo is always wrong here, because real logos are composited in afterwards by code. Within that limit the row icons must be SPECIFIC and ALL DIFFERENT from one another. Read each row of text and draw the concrete object, tool or action that row is actually about, so a reader could guess the row from its icon alone. Do not reuse a pictogram anywhere on the card, and do not fall back on a small set of interchangeable generic symbols. Each icon is modelled with the two-or-three-tone treatment described under Rendering, so it reads as a small object with form rather than a flat silhouette.';

    // 일러스트가 스스로 만든 글자 (2026-09-18 실측). 모델은 도해 안에 라벨을 붙인다 —
  // 이번엔 전부 맞았지만 대조할 원문이 없어 교정 게이트를 그냥 통과한다. 금지하면 도해가
  // 밋밋해지므로, 출처를 카드 안 문구로 묶어 새 글자가 생기지 않게 한다.
  const ILLUSTRATION_TEXT_RULE = 'Labels inside an illustration: a diagram may carry short labels, but every one of them must be copied from a quoted string that already appears elsewhere on this card, or be a product name that appears there. Never invent a word, slogan, headline or caption that is not already quoted on the card. Two or three such labels at most.';

const FIDELITY = 'Text fidelity is critical: render every quoted Korean and English string EXACTLY as written, character for character — do not paraphrase, translate, abbreviate or invent any text. No text may appear anywhere on the card other than the quoted strings.';

  // timeline — 세로 축 위 노드. 순서가 내용인 카드(일정·단계·일별)를 위한 골격이다.
  // 노드 재료: compare 는 행 하나가 노드 하나, list 는 섹션 하나가 노드 하나다.
  // note 는 축에서 빼고 하단 띠로 내린다 — 한 줄 핵심은 시간축 위의 단계가 아니다.
  function composeTimelinePrompt(brief) {
    const card = brief.card;
    const accent = accentOf(brief);
    const nodes = [];
    let noteClause = '';
    (card.sections || []).forEach(section => {
      if (!section) return;
      if (section.type === 'note') {
        noteClause = `Below the axis, a full-width highlight band in ${accent.soft} tint with a ${accent.strong} left edge: bold Korean text ${q(section.body)} with a small caption ${q(section.source)}.`;
        return;
      }
      if (section.type === 'compare') {
        section.rows.forEach(r => nodes.push(
          `node labelled ${q(r[0])} in bold ${accent.strong}, with ${q(r[1])} beside it in near-black`));
        return;
      }
      nodes.push(`node labelled ${q(section.title)} in bold ${accent.strong}, with the lines ${section.items.map(q).join(', then ')} stacked under it in near-black`);
    });
    return [
      `A vertical ${CANVAS.width}x${CANVAS.height} pixel (2:3 portrait) Korean infographic card-news poster laid out as a VERTICAL TIMELINE. Flat vector illustration, clean and airy. All quoted strings below are EXACT text to render verbatim.`,
      ...headerClauses(brief, accent),
      `Body: one continuous thin vertical ${accent.strong} line running from just under the subtitle down to the footer, positioned about one fifth in from the left edge. On that line, ${nodes.length} evenly spaced filled ${accent.strong} circles. All text sits to the RIGHT of the line, left-aligned against a common margin, with generous vertical space between nodes, in this order:\n${nodes.map((n, i) => `- ${i + 1}: ${n}`).join('\n')}`,
      noteClause,
      `Footer, bottom of canvas: a slim bar reading ${q(brief.source.label)}.`,
      `Strictly forbidden on this card: rounded white panels, panel boxes, card tiles, drop shadows around text blocks, two-column grids, tables. The only structural graphic is the single vertical line with its circular nodes — the card must read as one continuous axis, not as stacked boxes.`,
      ICON_RULE,
      ILLUSTRATION_TEXT_RULE,
      ILLUSTRATION_TEXT_RULE,
      FIDELITY
    ].filter(Boolean).join('\n\n');
  }

  // ledger — 패널 상자를 전부 없애고 전폭 가로 실선으로만 행을 가른다. 표 성격의
  // 카드(전 vs 후, 버전별 변화)가 패널에 갇히면 비교가 눈에 안 들어온다.
  function composeLedgerPrompt(brief) {
    const card = brief.card;
    const accent = accentOf(brief);
    // 계단의 기준색은 strong 이 아니라 **ink** 다 (2026-09-18 재측정).
    // #00b6ff 는 상대휘도 0.407 로 밝은 색이다 — 흰 글자를 얹으면 대비 2.30:1 로 최저
    // 기준(3:1)에도 못 미친다. 밝은 색을 머리띠에 쓰고 어두운 ink 를 안 쓰고 있었던 게
    // "색이 별로"의 실체다. 네이비(15.71:1)를 구조로 내리고 하늘색을 강조로 올린다.
    const rampHex = card._palette && card._palette.hex && (card._palette.hex.ink || card._palette.hex.strong);
    const badgeHex = card._palette && card._palette.hex && card._palette.hex.strong;
    const ramp = rampHex ? toneRamp(rampHex, (card.sections || []).length) : [];
    const blocks = [];
    (card.sections || []).forEach(section => {
      if (!section) return;
      if (section.type === 'note') {
        blocks.push(`a final block with no rule above it: bold Korean text ${q(section.body)} in ${accent.strong}, then a small caption ${q(section.source)} in gray`);
        return;
      }
      // ledger 는 머리띠가 없어 kicker 가 유일한 색 자리다. 행사색이 있으면 여기서 돌린다 —
      // 안 그러면 카드 전체가 강조색 한 가지로 눌려 "단색이라 재미없다"가 된다(사용자 지적).
      const kColor = ramp[blocks.length] || accent.strong;
      const kicker = section.title
        ? `a small all-caps ${kColor} kicker reading ${q(section.title)}, then `
        : '';
      if (section.type === 'compare') {
        blocks.push(kicker + `${section.rows.length} rows separated by hairline rules — ${section.rows.map(r => `one row with ${q(r[0])} left-aligned in medium gray and ${q(r[1])} right-aligned in bold near-black`).join('; ')}`);
        return;
      }
      blocks.push(kicker + `${section.items.length} rows separated by hairline rules, each one a single left-aligned line of near-black Korean text — ${section.items.map(q).join('; then ')}`);
    });
    return [
      `A vertical ${CANVAS.width}x${CANVAS.height} pixel (2:3 portrait) Korean infographic card-news poster laid out as a FLAT LEDGER — a printed table with no boxes. Flat vector illustration, airy and typographic. All quoted strings below are EXACT text to render verbatim.`,
      ...headerClauses(brief, accent),
      `Body: a single full-width column of rows, edge margins equal on both sides. Rows are separated ONLY by thin horizontal ${NEUTRAL.strong} hairline rules that run the full text width — there are no boxes, no fills and no shadows anywhere in the body. Generous vertical padding inside every row. In this order:\n${blocks.map((b, i) => `- Block ${i + 1}: ${b}`).join('\n')}`,
      `Footer, bottom of canvas: a slim bar reading ${q(brief.source.label)}.`,
      `Strictly forbidden on this card: rounded white panels, card tiles, drop shadows, colored panel fills, two-column panel grids, icons, bullet marks. The body must read as a clean printed table held together by hairlines alone.`,
      ICON_RULE,
      ILLUSTRATION_TEXT_RULE,
      ILLUSTRATION_TEXT_RULE,
      FIDELITY
    ].filter(Boolean).join('\n\n');
  }

  function composeFullPrompt(brief) {
    const card = brief.card;
    if (card.layout === 'poster') return composePosterPrompt(brief);
    if (card.layout === 'timeline') return composeTimelinePrompt(brief);
    if (card.layout === 'ledger') return composeLedgerPrompt(brief);
    const accent = accentOf(brief);
    const mascot = hasMascotRef(brief.image.references);
    const bubble = !card.bubble ? ''
      : mascot ? ` A small speech bubble from the character reads ${q(card.bubble)}.`
      : ` To the right of the subtitle, the short phrase ${q(card.bubble)} sits inside a small ${accent.soft} rounded tag — plain text, no speech bubble and no character.`;
    const peer = card.layout === 'peer';
    // 중요도 계단. 섹션 순서가 그대로 색 농도 순서다 — 위가 진하고 아래로 옅어진다.
    const rampHex = card._palette && card._palette.hex && (card._palette.hex.ink || card._palette.hex.strong);
    const badgeHex = card._palette && card._palette.hex && card._palette.hex.strong;
    const ramp = rampHex ? toneRamp(rampHex, card.sections.length) : [];
    const sections = card.sections.map((s, i) =>
      fullSectionClause(s, i, accent, peer, ramp[i] || null, badgeHex || null));
    const refLabel = hasMascotRef(brief.image.references)
      ? 'Reference images: Image 1 is the brick mascot identity reference — copy its body shape, round black eyes and the sky-blue brick exactly; it defines the character, not the layout.'
      : '';
    return [
      `A vertical ${CANVAS.width}x${CANVAS.height} pixel (2:3 portrait) Korean infographic card-news poster. Flat vector illustration, crisp and clean, dense but organized editorial layout like premium Korean tech card-news. All quoted strings below are EXACT text to render verbatim.`,
      brief.image.prompt,
      refLabel,
      // 색 규율을 프롬프트 앞쪽에 둔다 — 뒤쪽 패널 지시보다 먼저 읽혀야 전체 팔레트를 잡는다.
      colorDisciplineClause(brief, accent, " Row icons are drawn in their own panel's colour, modelled in two or three tones of that colour rather than poured as one flat fill."),
      BACKGROUND_CLAUSE,
      MATERIAL_CLAUSE,
      // 타이틀은 종전에 크기가 아니라 경쟁 때문에 묻혔다. eyebrow 를 채운 칩 + 금색
      // 글씨로 두면 타이틀 바로 위에서 같은 세기로 시선을 나눠 가진다. 칩을 외곽선·
      // 중립으로 낮추고, 타이틀에 상대 크기(2.5배)를 명시한다.
      `Header, top of canvas (all text EXACT, verbatim): first a small pill-shaped chip reading ${q(card.eyebrow || brief.source.label)} — thin ${NEUTRAL.strong} outline, no fill, quiet ${NEUTRAL.strong} letters, deliberately understated so it never competes with the title. Then the main title ${q(card.title)} as the single most dominant element on the whole canvas: very bold near-black Korean lettering, cap height roughly 2.5 times the panel header text, spanning the full text column width (up to two lines). Then a one-line subtitle ${q(card.lead)} in medium gray at clearly smaller size than the title.${bubble}`,
      mascotClause(brief.image.references, brief.image.mascotAction || 'looking at the reader'),
      `Body (all quoted text EXACT, verbatim, no extra characters), arranged as a two-column grid of rounded white panels with soft shadows (full-width panels span both columns). ${peer
        ? 'All body panels carry EQUAL visual weight: identical panel height, identical header bar treatment and identical body text size. No panel may be enlarged, highlighted or made more prominent than the others — they are peer items in one list, not a hierarchy.'
        : 'Panel sizes must follow the prominence described for each panel below — the body must read as a clear hierarchy, not as equally weighted tiles'}:\n${sections.map(s => '- ' + s).join('\n')}`,
      eventColorClause(brief),
      pointAccentClause(brief),
      figuresClause(card.figures, accent),
      logoBandClause(card.logos),
      `Footer, bottom of canvas: a slim bar reading ${q(brief.source.label)}.`,
      ICON_RULE,
      ILLUSTRATION_TEXT_RULE,
      'Text fidelity is critical: render every quoted Korean and English string EXACTLY as written, character for character — do not paraphrase, translate, abbreviate or invent any text. No text may appear anywhere on the card other than the quoted strings.'
    ].filter(Boolean).join('\n\n');
  }

  function composePrompt(brief) {
    if ((brief.image && brief.image.layoutMode) === 'full') return composeFullPrompt(brief);
    return [
      `A vertical ${CANVAS.width}x${CANVAS.height} pixel (2:3 portrait) Korean internal card-news canvas.`,
      brief.image.prompt,
      layoutClause(brief),
      mascotClause(brief.image.references)
    ].filter(Boolean).join('\n\n');
  }

  function composeNegativePrompt(brief) {
    const given = String(brief.image.negativePrompt);
    const lower = given.toLowerCase();
    let required = (brief.image && brief.image.layoutMode) === 'full' ? FULL_MODE_NEGATIVES : REQUIRED_NEGATIVES;
    if ((brief.card.logos || []).length) required = required.filter(t => t !== LOGO_NEGATIVE);
    // 인물이 있는 카드에서는 색 상한 금지어를 뺀다 (2026-09-18) — 초상은 자연스러운 피부·머리
    // 색으로 그리라고 본문에서 지시해 놓고 여기서 "두 색 초과 금지"를 걸면 자기모순이다.
    if ((brief.card.figures || []).length) required = required.filter(t => !FIGURE_CONFLICTS.has(t));
    if ((brief.card._palette || {}).points) required = required.filter(t => !FIGURE_CONFLICTS.has(t));
    const missing = required.filter(term => !lower.includes(term.toLowerCase()));
    return missing.length ? `${given}, ${missing.join(', ')}` : given;
  }

  return {
    CANVAS, GRID, BOTTOM_LIMIT, TONE_WORDS, ACCENTS, NEUTRAL, WEIGHTS, LOGO_SLOT, logoBandClause, figuresClause, BACKGROUND_CLAUSE, MATERIAL_CLAUSE, PALETTE_EXCEPTION, eventColorClause, pointAccentClause, colorDisciplineClause, ICON_RULE, ILLUSTRATION_TEXT_RULE, toneRamp,
    REQUIRED_NEGATIVES, FULL_MODE_NEGATIVES,
    estimateSectionHeight, computeLayout, weightOf, accentOf,
    layoutClause, mascotClause, composePrompt, composeFullPrompt, composePosterPrompt,
    composeTimelinePrompt, composeLedgerPrompt, composeNegativePrompt
  };
});
