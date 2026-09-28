/**
 * 브릭 빌더 마스코트 렌더러
 *
 * 3단 조적 브릭 로고 위에 같은 규격의 브릭 한 장을 얹어 머리로 쓴다.
 * 직육면체를 실제로 세우고 카메라를 회전시킨 뒤 램버트 명암을 계산해 SVG polygon으로 뱉는다.
 * 이미지가 아니라 벡터이므로 확대·재색상이 자유롭고 헤드리스 캡처에서도 결과가 동일하다.
 *
 * 브라우저: <script src="brick-render.js"> 후 window.BrickRender
 * Node    : const { renderMascot } = require('./brick-render.js')
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BrickRender = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BH = 5;    // 모든 브릭 높이 (조적 단 높이)
  var GAP = 1;   // 단 간격

  var TOKENS = {
    brickLight: '#F7FAFB',   // 로고 실측 — 순백 아님
    brickDark: '#1B2833',    // 밝은 배경용 반전값
    blueRaw: '#4997CF',      // 로고 실측 블루
    blueDeep: '#2F7CB8',     // 밝은 배경 대비 보정
    unit: { width: 24, height: 23, gap: GAP, brickHeight: BH, radius: 0.55 }
  };

  // ── 포즈별 브릭 배치 ────────────────────────────────
  // blue: 'body' = C-1 (로고 그대로, 가슴에 블루) / 'head' = C-2
  function boxes(pose, blue) {
    var headKind = blue === 'head' ? 'a' : 'w';
    var chestKind = blue === 'head' ? 'w' : 'a';

    var L = [
      { x: 5, y: 0, w: 14, h: BH, kind: headKind, isHead: true },
      { x: 0, y: 6, w: 6, h: BH, kind: chestKind },
      { x: 7, y: 6, w: 17, h: BH, kind: 'w' },
      { x: 0, y: 12, w: 24, h: BH, kind: 'w' },
      { x: 0, y: 18, w: 14, h: BH, kind: 'w' },
      { x: 15, y: 18, w: 9, h: BH, kind: 'w' }
    ];

    // ── 팔 ───────────────────────────────────────────
    // 팔은 2개 단을 세로로 걸치는 11u(5+1+5) 브릭이고, 몸통과 1u 줄눈을 둔다.
    //
    // 처음엔 팔을 몸통에 밀착시켰는데, 같은 단·같은 높이라서 몸통 브릭과 하나로
    // 합쳐져 팔이 아예 사라졌다. 반대로 5u 짧은 팔에 줄눈을 주면 떠 있는 조각으로 보였다.
    // 2개 단을 걸치면 어느 단과도 합쳐지지 않고, 가늘고 길어서 팔로 읽힌다.
    // 1u 줄눈은 로고 자신의 문법(6|1|17, 14|1|9)과 같은 값이다.
    var ARM = 3, GAPX = 1;
    var LX = -(ARM + GAPX), RX = 24 + GAPX;   // -4 / 25
    var ARMH = BH * 2 + GAP;                  // 11u — 3·4단을 걸쳐 아래가 바닥과 맞는다
    var DOWN = 12, UP = 6;                    // 내린 팔 / 든 팔 (2·3단을 걸침)

    var armDown = function (x) { return { x: x, y: DOWN, w: ARM, h: ARMH, kind: 'w' }; };
    var armUp = function (x) { return { x: x, y: UP, w: ARM, h: ARMH, kind: 'w' }; };

    if (pose === 'wave') {
      L.push(armUp(LX), armDown(RX));
    } else if (pose === 'point') {
      L.push(armDown(LX));
      L.push({ x: RX, y: DOWN, w: 9, h: BH, kind: 'w' });   // 옆으로 뻗어 헤드라인을 가리킴
    } else if (pose === 'check') {
      L.push(armDown(LX), armUp(RX));
    } else if (pose === 'alert' || pose === 'jump') {
      L.push(armUp(LX), armUp(RX));
    } else if (pose === 'lean') {
      L.push(armDown(LX));
      L.push({ x: RX, y: DOWN, w: 6, h: BH, kind: 'w' });   // 진행 방향으로 살짝 뻗음
    } else {
      L.push(armDown(LX), armDown(RX));
    }
    return L;
  }

  // ── 기하 ────────────────────────────────────────────
  function rotZ(p, deg, px, py) {
    if (!deg) return p;
    var t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
    var dx = p[0] - px, dy = p[1] - py;
    return [px + dx * c - dy * s, py + dx * s + dy * c, p[2]];
  }

  // 카메라: Y축(좌우) → X축(위아래). -z 방향이 시점.
  function cam(p, rx, ry) {
    var cy = Math.cos(ry), sy = Math.sin(ry);
    var x1 = p[0] * cy + p[2] * sy;
    var z1 = -p[0] * sy + p[2] * cy;
    var cx = Math.cos(rx), sx = Math.sin(rx);
    return [x1, p[1] * cx - z1 * sx, p[1] * sx + z1 * cx];
  }

  var FACES = [
    { i: [0, 1, 2, 3], n: [0, 0, -1] },  // front
    { i: [5, 4, 7, 6], n: [0, 0, 1] },   // back
    { i: [1, 5, 6, 2], n: [1, 0, 0] },   // right
    { i: [4, 0, 3, 7], n: [-1, 0, 0] },  // left
    { i: [4, 5, 1, 0], n: [0, -1, 0] },  // top
    { i: [3, 2, 6, 7], n: [0, 1, 0] }    // bottom
  ];

  var LIGHT = (function () {
    var v = [-0.42, -0.72, -0.58];
    var m = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    return [v[0] / m, v[1] / m, v[2] / m];
  })();

  function lambert(n, ambient) {
    var d = n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2];
    return ambient + (1 - ambient) * (d < 0 ? 0 : d);
  }

  function clamp255(v) { v = Math.round(v); return v < 0 ? 0 : v > 255 ? 255 : v; }

  // 그림자 쪽은 살짝 차갑게 — 플라스틱 재질감
  function tint(hex, s) {
    var r = parseInt(hex.slice(1, 3), 16),
        g = parseInt(hex.slice(3, 5), 16),
        b = parseInt(hex.slice(5, 7), 16);
    var kr = s < 1 ? 0.975 : 1, kb = s < 1 ? 1.045 : 1;
    return '#' + [clamp255(r * s * kr), clamp255(g * s), clamp255(b * s * kb)]
      .map(function (v) { return v.toString(16).padStart(2, '0'); }).join('');
  }

  function num(v) { return (Math.round(v * 1000) / 1000).toString(); }

  // ── 표정 ────────────────────────────────────────────
  // 머리 앞면 좌표계(머리는 x 5..19, y 0..5)에서 그린다. 바깥에서 평면 기저벡터로
  // 변환되므로 각도가 바뀌어도 눈이 얼굴에 붙어 같이 눕는다.
  // 몸(pose)과 눈(expression)은 분리돼 있어 5 × 8 조합이 전부 나온다.
  var EYE_L = 9.5, EYE_R = 14.5, EYE_Y = 2.5;

  var EXPRESSIONS = {
    neutral:   { label: '기본',     use: '일반 릴리스 · 하단 밴드' },
    happy:     { label: '반가움',   use: '좋은 소식 · 기능 추가' },
    wide:      { label: '놀람',     use: '속보 · 긴급 릴리스 업데이트' },
    look:      { label: '주목',     use: '헤드라인 쪽으로 시선' },
    wink:      { label: '윙크',     use: '팁 · 노하우 · 꿀팁' },
    skeptical: { label: '의심',     use: '검증 필요 · 커뮤니티 출처' },
    sleepy:    { label: '심심',     use: '영향 없는 마이너 릴리스' },
    dead:      { label: '종료',     use: '기능 중단 · deprecated' }
  };

  var DEFAULT_EXPR = {
    base: 'neutral', wave: 'happy', alert: 'wide', point: 'look', check: 'happy',
    jump: 'happy', lean: 'look', tumble: 'dead'
  };

  // ── 동작 ────────────────────────────────────────────
  // 팔만 올리는 것으로는 정적이다. 몸 전체를 기울이고(tilt) 띄우고(lift)
  // 흩뜨리면(spread) 같은 브릭으로 동작이 생긴다.
  // 개별 브릭을 기울이면 조적 격자가 깨져 부서진 것처럼 보이지만,
  // 몸 전체를 한 덩어리로 기울이면 움직임으로 읽힌다.
  var POSE_MOTION = {
    base:   { tilt: 0,   lift: 0, spread: 0,    shadow: 1 },
    wave:   { tilt: -3,  lift: 0, spread: 0,    shadow: 1 },
    alert:  { tilt: 0,   lift: 1, spread: 0,    shadow: 0.94 },
    point:  { tilt: 2,   lift: 0, spread: 0,    shadow: 1 },
    check:  { tilt: -2,  lift: 0, spread: 0,    shadow: 1 },
    jump:   { tilt: -5,  lift: 6, spread: 0,    shadow: 0.62 },  // 떠 있음 · 그림자 축소
    lean:   { tilt: 11,  lift: 0, spread: 0,    shadow: 1 },     // 전진 · 이동감
    tumble: { tilt: -14, lift: 1, spread: 0.16, shadow: 0.85 }   // 무너짐 · deprecated
  };

  var POSE_INFO = {
    base:   { label: '기본',   use: '일반 릴리스 · 하단 밴드' },
    wave:   { label: '인사',   use: '카드 도입 · 시리즈 첫 장' },
    alert:  { label: '속보',   use: '긴급 · 릴리스 업데이트 기한' },
    point:  { label: '가리킴', use: '헤드라인 옆 · 핵심 지목' },
    check:  { label: '확인',   use: '검증 완료 · 적용 권장' },
    jump:   { label: '점프',   use: '큰 기능 출시 · GA 전환' },
    lean:   { label: '전진',   use: '로드맵 · 다음 단계 안내' },
    tumble: { label: '붕괴',   use: '기능 중단 · deprecated · 알려진 버그' }
  };

  function drawExpression(name, eyeHex, brickHex) {
    var S = 'stroke="' + eyeHex + '" stroke-width="0.62" stroke-linecap="round" fill="none"';

    // 동그란 눈 + 하이라이트 (dx로 시선 이동)
    function ball(cx, r, dx) {
      dx = dx || 0;
      return '<circle cx="' + num(cx + dx) + '" cy="' + EYE_Y + '" r="' + r + '" fill="' + eyeHex + '"/>' +
             '<circle cx="' + num(cx + dx + 0.44) + '" cy="' + (EYE_Y - 0.52) + '" r="0.34" fill="' +
             brickHex + '" opacity="0.85"/>';
    }
    // 위로 휜 호 = 웃는 눈
    function smile(cx) {
      return '<path d="M ' + num(cx - 1.32) + ' ' + (EYE_Y + 0.36) + ' Q ' + cx + ' ' +
             (EYE_Y - 1.28) + ' ' + num(cx + 1.32) + ' ' + (EYE_Y + 0.36) + '" ' + S + '/>';
    }
    // 아래로 휜 호 = 처진 눈
    function droop(cx) {
      return '<path d="M ' + num(cx - 1.32) + ' ' + (EYE_Y - 0.5) + ' Q ' + cx + ' ' +
             (EYE_Y + 1.2) + ' ' + num(cx + 1.32) + ' ' + (EYE_Y - 0.5) + '" ' + S + '/>';
    }
    // 가늘게 뜬 눈
    function slit(cx, cy) {
      return '<ellipse cx="' + cx + '" cy="' + num(cy) + '" rx="1.22" ry="0.46" fill="' + eyeHex + '"/>';
    }
    // X 눈
    function cross(cx) {
      var d = 1.05;
      return '<path d="M ' + num(cx - d) + ' ' + num(EYE_Y - d) + ' L ' + num(cx + d) + ' ' +
             num(EYE_Y + d) + '" ' + S + '/>' +
             '<path d="M ' + num(cx + d) + ' ' + num(EYE_Y - d) + ' L ' + num(cx - d) + ' ' +
             num(EYE_Y + d) + '" ' + S + '/>';
    }

    switch (name) {
      case 'happy':     return smile(EYE_L) + smile(EYE_R);
      // 1.5 / 0.62로는 기본과 구분이 안 됐다. 머리 안에서 최대치까지 키운 값.
      case 'wide':      return ball(EYE_L, 1.72) + ball(EYE_R, 1.72);
      case 'look':      return ball(EYE_L, 1.15, 0.95) + ball(EYE_R, 1.15, 0.95);
      case 'wink':      return ball(EYE_L, 1.15) + smile(EYE_R);
      case 'skeptical': return slit(EYE_L, EYE_Y + 0.25) + slit(EYE_R, EYE_Y - 0.42);
      case 'sleepy':    return droop(EYE_L) + droop(EYE_R);
      case 'dead':      return cross(EYE_L) + cross(EYE_R);
      default:          return ball(EYE_L, 1.15) + ball(EYE_R, 1.15);
    }
  }

  /**
   * @param {object} o
   *   pose      base|wave|alert|point|check
   *   ry, rx    카메라 회전(도). 0,0이면 정면 = 2D 플랫과 동일
   *   depth     브릭 두께(u)
   *   ambient   그림자 깊이 0..1 (낮을수록 대비 큼)
   *   blue      'body'(C-1) | 'head'(C-2)
   *   brickHex, blueHex, eyeHex
   *   shadow    접지 그림자 on/off
   *   idPrefix  filter id 충돌 방지용
   */
  function renderMascot(o) {
    o = o || {};
    var pose = o.pose || 'base';
    var ry = (o.ry === undefined ? 24 : o.ry) * Math.PI / 180;
    var rx = (o.rx === undefined ? 14 : o.rx) * Math.PI / 180;
    var depth = o.depth === undefined ? 4 : o.depth;
    var ambient = o.ambient === undefined ? 0.52 : o.ambient;
    var blue = o.blue || 'body';
    var brickHex = o.brickHex || TOKENS.brickLight;
    var blueHex = o.blueHex || TOKENS.blueRaw;
    var eyeHex = o.eyeHex || '#0A0E12';
    var shadow = o.shadow !== false;
    var outline = o.outline || null;      // 윤곽선 색. null이면 선 없음
    var idp = o.idPrefix || ('bk' + pose);

    // 앞면 밝기를 1.0으로 정규화 → 어느 각도에서도 브랜드 색이 그대로 나온다
    var frontShade = lambert(cam([0, 0, -1], rx, ry), ambient);
    if (frontShade < 0.05) frontShade = 0.05;

    // 동작 — 포즈 기본값을 쓰되 개별 지정도 허용
    var mo = POSE_MOTION[pose] || POSE_MOTION.base;
    var tilt = o.tilt === undefined ? mo.tilt : o.tilt;
    var lift = o.lift === undefined ? mo.lift : o.lift;
    var spread = o.spread === undefined ? mo.spread : o.spread;
    var shadowScale = o.shadowScale === undefined ? mo.shadow : o.shadowScale;
    var PIVX = 12, PIVY = 23;        // 기울임 축 — 몸통 바닥 중앙

    var polys = [], eye = null;
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    var list = boxes(pose, blue);

    // 몸 전체에 적용되는 변형. 브릭별 rz(개별 회전)와 달리 덩어리째 움직인다.
    function place(p, bx) {
      var q = p;
      if (spread) {
        q = [q[0] + (bx.x + bx.w / 2 - 12) * spread,
             q[1] + (bx.y + bx.h / 2 - 11.5) * spread, q[2]];
      }
      if (lift) q = [q[0], q[1] - lift, q[2]];
      if (bx.rz) q = rotZ(q, bx.rz, bx.px, bx.py);
      if (tilt) q = rotZ(q, tilt, PIVX, PIVY - lift);
      return q;
    }

    for (var b = 0; b < list.length; b++) {
      var bx = list[b];
      var raw = [
        [bx.x, bx.y, 0], [bx.x + bx.w, bx.y, 0],
        [bx.x + bx.w, bx.y + bx.h, 0], [bx.x, bx.y + bx.h, 0],
        [bx.x, bx.y, depth], [bx.x + bx.w, bx.y, depth],
        [bx.x + bx.w, bx.y + bx.h, depth], [bx.x, bx.y + bx.h, depth]
      ];
      var pv = [];
      for (var v = 0; v < 8; v++) pv.push(cam(place(raw[v], bx), rx, ry));

      for (var f = 0; f < FACES.length; f++) {
        var F = FACES[f], n = F.n;
        var spin = (bx.rz || 0) + tilt;          // 법선도 같이 돌아야 명암이 맞는다
        if (spin) {
          var rn2 = rotZ([n[0], n[1], 0], spin, 0, 0);
          n = [rn2[0], rn2[1], F.n[2]];
        }
        var wn = cam(n, rx, ry);
        if (wn[2] >= -1e-4) continue;               // 백페이스 컬링

        var s = lambert(wn, ambient) / frontShade;
        if (s > 1.22) s = 1.22;

        var pts = '', zs = 0;
        for (var k = 0; k < 4; k++) {
          var q = pv[F.i[k]];
          pts += (k ? ' ' : '') + num(q[0]) + ',' + num(q[1]);
          zs += q[2];
          if (q[0] < minX) minX = q[0];
          if (q[0] > maxX) maxX = q[0];
          if (q[1] < minY) minY = q[1];
          if (q[1] > maxY) maxY = q[1];
        }
        polys.push({ z: zs / 4, pts: pts, kind: bx.kind, s: s });
      }

      // 눈 — 머리 앞면 평면의 기저벡터로 변환해 원을 타원으로 눕힌다
      if (bx.isHead) {
        var fn = cam([0, 0, -1], rx, ry);
        if (fn[2] < 0) {
          // 기저벡터는 tilt만 반영(회전), 원점은 place()를 그대로 통과시킨다.
          // place()가 아핀변환이므로 screen = 원점 + ex·u + ey·w 가 정확히 성립한다.
          var u = cam(tilt ? rotZ([1, 0, 0], tilt, 0, 0) : [1, 0, 0], rx, ry),
              w = cam(tilt ? rotZ([0, 1, 0], tilt, 0, 0) : [0, 1, 0], rx, ry),
              org = cam(place([0, 0, -0.04], bx), rx, ry);
          eye = 'matrix(' + num(u[0]) + ',' + num(u[1]) + ',' +
                num(w[0]) + ',' + num(w[1]) + ',' +
                num(org[0]) + ',' + num(org[1]) + ')';
        }
      }
    }

    polys.sort(function (a, c) { return c.z - a.z; });   // 먼 면부터 (페인터)

    var pad = 1.8;
    minX -= pad; maxX += pad; minY -= pad; maxY += pad + 1.6;
    // viewBox를 밖에서 넘기면 그 값을 쓴다. 포즈를 바꿔도 몸통이 제자리에 있어야 하므로
    // 카드에서는 반드시 unionViewBox()로 구한 공통값을 넘겨야 한다.
    var vb = o.viewBox ||
      (num(minX) + ' ' + num(minY) + ' ' + num(maxX - minX) + ' ' + num(maxY - minY));

    var out = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + vb +
      '" role="img" aria-label="브릭 빌더 마스코트 ' + pose + '">';

    if (shadow) {
      var gu = cam([1, 0, 0], rx, ry),
          gw = cam([0, 0, 1], rx, ry),
          go = cam([12, 23.9, depth / 2], rx, ry);
      out += '<defs><filter id="' + idp + '-sh" x="-45%" y="-45%" width="190%" height="190%">' +
             '<feGaussianBlur stdDeviation="1.5"/></filter></defs>';
      // 그림자는 땅에 남는다 — 점프해도 y는 그대로, 크기와 진하기만 줄어든다
      var sc = shadowScale === undefined ? 1 : shadowScale;
      out += '<ellipse cx="0" cy="0" r="1" filter="url(#' + idp + '-sh)" opacity="' +
             num(0.5 * sc) + '" fill="#000" ' +
             'transform="matrix(' + num(gu[0] * 15 * sc) + ',' + num(gu[1] * 15 * sc) + ',' +
             num(gw[0] * 5.5 * sc) + ',' + num(gw[1] * 5.5 * sc) + ',' +
             num(go[0]) + ',' + num(go[1]) + ')"/>';
    }

    // ── 윤곽선 ──────────────────────────────────────
    // 흰 브릭(#F7FAFB) 앞면과 흰 배경(#FFFFFF)은 차이가 4뿐이라 실루엣이 사라진다.
    //
    // 처음엔 모든 면에 선을 그었더니(mode 'edges') 브릭 하나의 앞면·윗면·옆면 경계까지
    // 전부 선이 생겨 50개 면이 테두리를 갖게 됐다. 선이 화면을 지배해서 명암이 죽고
    // 3D 렌더가 와이어프레임 상자 그림처럼 싸 보였다.
    //
    // 'silhouette'는 2패스로 바깥 테두리만 남긴다.
    //   1패스 — 전 폴리곤을 윤곽선 색으로 굵게 칠해 조금 부푼 덩어리를 만든다
    //   2패스 — 실제 음영 색으로 원래 크기로 덮는다
    // 내부 면 경계는 2패스가 덮어 사라지고, 바깥 둘레와 1u 줄눈에만 선이 남는다.
    // 줄눈에 선이 생기는 건 실제 조적과 같아서 오히려 구조가 잘 읽힌다.
    var lw = o.outlineWidth === undefined ? 0.62 : o.outlineWidth;
    var mode = o.outlineMode || 'silhouette';

    if (outline && mode === 'silhouette') {
      for (var s1 = 0; s1 < polys.length; s1++) {
        out += '<polygon points="' + polys[s1].pts + '" fill="' + outline + '" stroke="' +
               outline + '" stroke-width="' + lw + '" stroke-linejoin="round"/>';
      }
    }

    for (var i = 0; i < polys.length; i++) {
      var P = polys[i];
      var col = tint(P.kind === 'a' ? blueHex : brickHex, P.s);
      var edged = outline && mode === 'edges';
      // 같은 색 stroke + round join = 미세한 모따기. 실제 브릭의 chamfer 느낌.
      out += '<polygon points="' + P.pts + '" fill="' + col + '" stroke="' +
             (edged ? outline : col) + '" stroke-width="' + (edged ? lw : 0.14) +
             '" stroke-linejoin="round"/>';
    }

    if (eye) {
      out += '<g transform="' + eye + '">' +
             drawExpression(o.expression || DEFAULT_EXPR[pose] || 'neutral', eyeHex, brickHex) +
             '</g>';
    }

    return out + '</svg>';
  }

  /**
   * 브랜드 마크 — 마스코트가 아니라 로고 그 자체다.
   * 머리·팔·눈이 없는 3단 조적. 카드 우상단 락업이나 파비콘처럼
   * 아주 작게 쓰는 자리에는 마스코트를 축소하지 말고 이걸 쓴다.
   */
  function renderLogo(o) {
    o = o || {};
    var brick = o.brickHex || TOKENS.brickLight;
    var accent = o.blueHex || TOKENS.blueRaw;
    var ol = o.outline || null;
    var lw = o.outlineWidth === undefined ? 0.4 : o.outlineWidth;
    var R = function (x, y, w, h, fill) {
      return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h +
        '" rx="0.55" fill="' + fill + '"' +
        (ol ? ' stroke="' + ol + '" stroke-width="' + lw + '"' : '') + '/>';
    };
    var pad = ol ? lw : 0.2;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' +
      (-pad) + ' ' + (-pad) + ' ' + (24 + pad * 2) + ' ' + (17 + pad * 2) +
      '" role="img" aria-label="브릭 로고">' +
      R(0, 0, 6, 5, accent) + R(7, 0, 17, 5, brick) +
      R(0, 6, 24, 5, brick) +
      R(0, 12, 14, 5, brick) + R(15, 12, 9, 5, brick) +
      '</svg>';
  }

  /**
   * 슬랙 커스텀 이모지 — 128×128 정사각 얼굴 타일.
   *
   * 슬랙은 본문에서 이모지를 약 22px로 그린다. 브릭 9개짜리 마스코트를 그 크기로
   * 줄이면 회색 덩어리가 된다. 22px에서 읽히는 건 도형 2~3개가 한계라서
   * 이모지에서는 조적 문법을 의도적으로 깬다 — 정사각 브릭 하나 + 눈 + 블루 칩.
   * 눈 반지름을 1u로 잡아 22px에서 지름 4px 정도가 되게 했다(실측 하한).
   *
   * 카드 안 마스코트와 표정 이름이 같아서, 캡션 이모지와 카드가 같은 얼굴이 된다.
   */
  function renderEmoji(o) {
    o = o || {};
    var brick = o.brickHex || TOKENS.brickLight;
    var accent = o.blueHex || TOKENS.blueRaw;
    var eye = o.eyeHex || '#0A0E12';
    var ol = o.outline || '#16212B';
    var expr = o.expression || 'neutral';

    // drawExpression은 머리 앞면 좌표(눈 9.5/14.5, y 2.5)로 그린다.
    // 10×10 캔버스 중앙(5.0, 5.4)에 눈 지름이 커지도록 0.87배로 맞춘다.
    var sc = 0.87, tx = 5.0 - 12 * sc, ty = 5.4 - 2.5 * sc;

    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-0.35 -0.35 10.7 10.7" ' +
      'role="img" aria-label="브릭 마스코트 ' + expr + '">' +
      '<rect x="0" y="0" width="10" height="10" rx="1.3" fill="' + brick +
        '" stroke="' + ol + '" stroke-width="0.5"/>' +
      '<rect x="1" y="1" width="2.4" height="2.4" rx="0.45" fill="' + accent +
        '" stroke="' + ol + '" stroke-width="0.34"/>' +
      '<g transform="translate(' + num(tx) + ',' + num(ty) + ') scale(' + sc + ')">' +
        drawExpression(expr, eye, brick) +
      '</g></svg>';
  }

  /** 2D 플랫 버전 — 32px 이하나 파비콘용. 3D의 정면(0,0)과 동일한 실루엣. */
  function renderFlat(o) {
    o = o || {};
    return renderMascot({
      pose: o.pose || 'base', ry: 0, rx: 0, depth: 0.001, ambient: 1,
      blue: o.blue || 'body', brickHex: o.brickHex, blueHex: o.blueHex,
      eyeHex: o.eyeHex, shadow: false, idPrefix: o.idPrefix
    });
  }

  var POSES = ['base', 'wave', 'alert', 'point', 'check', 'jump', 'lean', 'tumble'];

  // 자세 그룹 — jump(6u 띄움)와 tumble(흩뜨림)은 프레임을 크게 먹는다.
  // 차분한 자세들과 같은 viewBox를 쓰면 그쪽이 작아져 카드에서 여백만 남는다.
  // 그룹을 나누면 각 그룹 안에서는 몸통이 제자리에 고정되면서 프레임을 꽉 채운다.
  // big 그룹은 위아래로 뻗는다. 높이가 고정된 자리(카드 하단 밴드)에 쓰면 잘린다.
  var POSE_GROUPS = {
    calm: ['base', 'wave', 'alert', 'point', 'check', 'lean'],
    big: ['jump', 'tumble']
  };

  /** 그 자세가 속한 그룹의 공통 viewBox */
  function viewBoxFor(pose, o) {
    var group = POSE_GROUPS.big.indexOf(pose) >= 0 ? POSE_GROUPS.big : POSE_GROUPS.calm;
    return unionViewBox(o, group);
  }

  /**
   * 여러 포즈를 감싸는 공통 viewBox.
   * 카드에서 포즈를 교체할 때 몸통이 튀지 않게 하려면 이 값을 renderMascot에 넘긴다.
   * 자체 출력에서 viewBox를 되읽는 방식이라 계산 경로가 렌더와 항상 일치한다.
   */
  function unionViewBox(o, poses) {
    poses = poses || POSES;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < poses.length; i++) {
      var opts = {};
      for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) opts[k] = o[k];
      opts.pose = poses[i];
      opts.viewBox = null;
      var m = /viewBox="([-\d. ]+)"/.exec(renderMascot(opts));
      if (!m) continue;
      var p = m[1].trim().split(/\s+/).map(Number);
      if (p[0] < minX) minX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[0] + p[2] > maxX) maxX = p[0] + p[2];
      if (p[1] + p[3] > maxY) maxY = p[1] + p[3];
    }
    return num(minX) + ' ' + num(minY) + ' ' + num(maxX - minX) + ' ' + num(maxY - minY);
  }

  return {
    renderMascot: renderMascot,
    renderFlat: renderFlat,
    renderLogo: renderLogo,
    renderEmoji: renderEmoji,
    unionViewBox: unionViewBox,
    viewBoxFor: viewBoxFor,
    POSE_GROUPS: POSE_GROUPS,
    TOKENS: TOKENS,
    POSES: POSES,
    POSE_INFO: POSE_INFO,
    POSE_MOTION: POSE_MOTION,
    EXPRESSIONS: EXPRESSIONS,
    DEFAULT_EXPR: DEFAULT_EXPR
  };
});
