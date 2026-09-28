import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const {
  computeLayout, layoutClause, mascotClause, composePrompt, composeNegativePrompt,
  estimateSectionHeight, composeFullPrompt, ACCENTS
} = require(resolve(ROOT, 'templates/card-layout.js'));

const SECTIONS = [
  { tone: 'blue', type: 'compare', title: '변경', rows: [['a', 'b'], ['c', 'd']] },
  { tone: 'green', type: 'flow', title: '흐름', steps: ['1', '2', '3'] },
  { tone: 'purple', type: 'list', title: '확인', items: ['x', 'y', 'z'] },
  { tone: 'orange', type: 'list', title: '영향', items: ['x', 'y', 'z'] },
  { tone: 'gold', type: 'list', title: '체크', items: ['x', 'y', 'z'] },
  { tone: 'note', type: 'note', title: '핵심', body: '본문', source: '출처' }
];

const brief = overrides => ({
  card: { title: '카드', lead: '리드', sections: SECTIONS },
  image: {
    assetPath: 'assets/editorial/infographic/skin.png',
    prompt: 'warm-white editorial background',
    negativePrompt: 'neon, glow',
    references: ['assets/mascot/base.png'],
    ...overrides
  },
  source: { label: '출처 라벨', links: ['https://help.salesforce.com/'] }
});

test('6개 섹션은 2열 3행으로 배치되고 캔버스에 들어간다', () => {
  const layout = computeLayout(SECTIONS);
  assert.equal(layout.rows.length, 3);
  assert.equal(layout.rows[0].cells.length, 2);
  assert.equal(layout.fits, true);
  assert.ok(layout.bottom <= 1508, `bottom ${layout.bottom}`);
});

test('full 섹션은 행을 독점한다', () => {
  const layout = computeLayout([
    SECTIONS[0], SECTIONS[1],
    { ...SECTIONS[5], full: true },
    SECTIONS[2], SECTIONS[3]
  ]);
  // [compare+flow] [full] [list+list] — full이 짝을 깨고 행을 독점한다
  assert.equal(layout.rows.length, 3);
  assert.equal(layout.rows[1].full, true);
  assert.equal(layout.rows[1].cells.length, 1);
});

test('내용이 넘치면 fits가 false다', () => {
  const long = '이 항목은 두 줄 넘게 내려가는 아주 긴 설명 문장이라서 행 높이를 크게 만든다';
  const heavy = Array.from({ length: 8 }, (_, i) => ({
    tone: 'blue', type: 'list', title: '항목 ' + i,
    items: [long, long, long, long, long, long]
  }));
  const layout = computeLayout(heavy);
  assert.equal(layout.fits, false);
});

test('행 높이 추정은 텍스트 길이에 따라 자란다 — 상수 추정이 아니다', () => {
  const shortNote = { tone: 'note', type: 'note', title: '핵심', body: '짧은 본문', source: '출처' };
  const longNote = { ...shortNote, body: '아주 긴 본문 문장이 여러 줄에 걸쳐 이어진다. '.repeat(8) };
  assert.ok(estimateSectionHeight(longNote) > estimateSectionHeight(shortNote));
  // full 여부와 무관하게 행 최소는 CSS grid-auto-rows의 230px다
  assert.equal(estimateSectionHeight({ ...shortNote, full: true }), 230);
});

test('skin 모드 레이아웃 문장은 중앙 비움을 지시한다', () => {
  const clause = layoutClause(brief({ layoutMode: 'skin' }));
  assert.match(clause, /completely empty/);
  assert.doesNotMatch(clause, /rounded-rectangle panels/);
});

test('panels 모드 레이아웃 문장은 섹션 수·행 배치·톤 색을 담는다', () => {
  const clause = layoutClause(brief({ layoutMode: 'panels' }));
  assert.match(clause, /exactly 6 empty rounded-rectangle panels/);
  assert.match(clause, /Row 1 /);
  assert.match(clause, /Row 3 /);
  assert.match(clause, /pale cobalt blue/);
  assert.match(clause, /soft forest green/);
  assert.match(clause, /completely blank/);
});

test('마스코트 참조가 있으면 정체성 문장이 붙고 없으면 빈 문자열이다', () => {
  assert.match(mascotClause(['assets/mascot/base.png']), /white brick golem/);
  assert.equal(mascotClause(['assets/editorial/other.png']), '');
});

test('합성 프롬프트는 캔버스·스타일·레이아웃·마스코트를 모두 담는다', () => {
  const prompt = composePrompt(brief({ layoutMode: 'panels' }));
  assert.match(prompt, /1024x1536/);
  assert.match(prompt, /warm-white editorial background/);
  assert.match(prompt, /rounded-rectangle panels/);
  assert.match(prompt, /white brick golem/);
});

test('full 모드는 모든 한국어 문구를 원문 그대로 따옴표로 고정한다', () => {
  const b = brief({ layoutMode: 'full', negativePrompt: 'neon', mascotAction: 'holding a pencil' });
  b.card.eyebrow = 'WINTER ’27 · RELEASE UPDATE';
  b.card.bubble = '지금 확인해요!';
  b.card.sections = [
    { tone: 'blue', type: 'compare', title: '변경', rows: [['지금', '가능'], ['이후', '차단']] },
    { tone: 'purple', type: 'list', title: '체크', items: ['첫 항목'], iconHints: ['magnifying glass'] },
    { tone: 'note', type: 'note', title: '핵심', body: '요약 문장', source: '출처 라벨' }
  ];
  const prompt = require(resolve(ROOT, 'templates/card-layout.js')).composeFullPrompt(b);
  for (const s of ['"WINTER ’27 · RELEASE UPDATE"', '"카드"', '"리드"', '"지금 확인해요!"',
    '"지금"', '"차단"', '"첫 항목"', 'magnifying glass', 'holding a pencil', '"요약 문장"', '"출처 라벨"']) {
    assert.ok(prompt.includes(s), s);
  }
  assert.match(prompt, /EXACTLY as written/);
  assert.match(prompt, /Image 1 is the brick mascot identity reference/);
  // composePrompt가 full 모드를 자동 분기한다
  assert.equal(require(resolve(ROOT, 'templates/card-layout.js')).composePrompt(b), prompt);
});

// ── 2026-08-04 피드백: 타이틀 강조 · 중요도별 크기 · 색 수 줄이기 ──

test('full 모드는 accent 하나 + 중립 두 색만 쓰고 tone 무지개를 쓰지 않는다', () => {
  const b = brief({ layoutMode: 'full', negativePrompt: 'neon' });
  b.card.accent = 'removed';
  b.card.sections = [
    { tone: 'blue', type: 'list', title: '핵심', items: ['a'], weight: 'primary' },
    { tone: 'green', type: 'list', title: '조치', items: ['b'], weight: 'secondary' },
    { tone: 'orange', type: 'list', title: '배경', items: ['c'], weight: 'aside' }
  ];
  const prompt = composeFullPrompt(b);
  assert.match(prompt, /only TWO hues/);
  assert.ok(prompt.includes('deep crimson red'), 'accent removed → crimson');
  assert.ok(prompt.includes('dark slate gray'), '중립색');
  // 섹션 tone(green·orange 등)이 full 모드 프롬프트로 새지 않는다
  for (const leaked of ['soft forest green', 'warm apricot orange', 'gentle lavender purple']) {
    assert.ok(!prompt.includes(leaked), `tone 누출: ${leaked}`);
  }
});

test('accent 키가 각각 다른 강조색을 준다 — 카드 종류가 색으로 구분된다', () => {
  const seen = new Set();
  for (const key of Object.keys(ACCENTS)) {
    const b = brief({ layoutMode: 'full', negativePrompt: 'neon' });
    b.card.accent = key;
    b.card.sections = [{ tone: 'blue', type: 'list', title: '핵심', items: ['a'], weight: 'primary' }];
    const prompt = composeFullPrompt(b);
    assert.ok(prompt.includes(ACCENTS[key].strong), key);
    seen.add(ACCENTS[key].strong);
  }
  assert.equal(seen.size, Object.keys(ACCENTS).length, '강조색이 서로 달라야 한다');
});

test('weight 가 패널 크기·헤더 처리를 가른다 — primary 지배 · aside 후퇴', () => {
  const b = brief({ layoutMode: 'full', negativePrompt: 'neon' });
  b.card.accent = 'enforced';
  b.card.sections = [
    { tone: 'blue', type: 'list', title: '핵심', items: ['a'], weight: 'primary' },
    { tone: 'blue', type: 'list', title: '조치', items: ['b'], weight: 'secondary' },
    { tone: 'blue', type: 'list', title: '배경', items: ['c'], weight: 'aside' }
  ];
  const prompt = composeFullPrompt(b);
  assert.match(prompt, /most prominent panel of the body/);
  assert.match(prompt, /largest panel-header size/);
  assert.match(prompt, /visually quietest/);
  assert.match(prompt, /smallest panel-header size/);
  assert.match(prompt, /outlined header strip with no fill/);
  assert.match(prompt, /clear hierarchy, not as equally weighted tiles/);
});

test('weight 를 안 주면 secondary 로 본다 — 기존 브리프가 깨지지 않는다', () => {
  const b = brief({ layoutMode: 'full', negativePrompt: 'neon' });
  b.card.accent = 'changed';
  b.card.sections = [{ tone: 'blue', type: 'list', title: '항목', items: ['a'] }];
  const prompt = composeFullPrompt(b);
  assert.ok(!prompt.includes('most prominent panel'), 'primary 아님');
  assert.ok(!prompt.includes('visually quietest'), 'aside 아님');
  assert.match(prompt, /dark slate gray filled header bar/);
});

test('타이틀이 카드에서 가장 지배적이고 eyebrow 는 물러난다', () => {
  const b = brief({ layoutMode: 'full', negativePrompt: 'neon' });
  b.card.accent = 'removed';
  b.card.eyebrow = 'SUMMER ’26 · SECURITY';
  b.card.sections = [{ tone: 'blue', type: 'list', title: '핵심', items: ['a'], weight: 'primary' }];
  const prompt = composeFullPrompt(b);
  assert.match(prompt, /single most dominant element on the whole canvas/);
  assert.match(prompt, /2\.5 times the panel header text/);
  assert.match(prompt, /no fill, quiet .* letters, deliberately understated/);
  assert.match(prompt, /never competes with the title/);
  // 마스코트가 타이틀 폭을 먹지 않게 상한을 줄였다
  assert.match(prompt, /no wider than 14% of the canvas/);
  assert.match(prompt, /title takes priority for horizontal space/);
});

test('full 모드 negativePrompt는 오타·잡문자를 보강하고 텍스트 금지는 넣지 않는다', () => {
  const composed = composeNegativePrompt(brief({ layoutMode: 'full', negativePrompt: 'neon' }));
  assert.ok(composed.includes('misspelled Korean'));
  assert.ok(composed.includes('gibberish characters'));
  assert.ok(!composed.toLowerCase().includes('readable text'));
  assert.ok(!composed.toLowerCase().includes('korean letters'));
});

test('negativePrompt에 필수 금지어가 없으면 자동 보강하고 있으면 중복하지 않는다', () => {
  const composed = composeNegativePrompt(brief({}));
  for (const term of ['readable text', 'Korean letters', 'numbers', 'logos', 'watermark']) {
    assert.ok(composed.toLowerCase().includes(term.toLowerCase()), term);
  }
  const already = composeNegativePrompt(brief({ negativePrompt: composed }));
  assert.equal(already, composed);
});
