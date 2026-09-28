import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { validateBrief, loadBrief } = require(resolve(ROOT, 'templates/card-brief.js'));

const VALID = {
  version: 1,
  card: {
    title: '배치 결과 첫 줄이 더 이상 오류가 아닙니다',
    lead: 'Summer ’26부터 요청 순서대로 결과가 표시됩니다.',
    accent: 'changed',
    sections: [{ tone: 'blue', type: 'compare', title: '무엇이 달라지나요?', rows: [['지금까지', '오류가 난 요청이 맨 위'], ['Summer ’26', '요청을 받은 순서 그대로']] }]
  },
  image: {
    assetPath: 'assets/editorial/infographic/release-order-dynamic-skin.png',
    prompt: 'flat Korean infographic background',
    negativePrompt: 'text, logos, neon',
    references: ['assets/mascot/base.png']
  },
  source: { label: '공식 릴리스 노트 · Summer ’26', links: ['https://help.salesforce.com/'] }
};

test('Claude 브리프의 필수 카드·이미지 계약을 검증한다', () => {
  const result = validateBrief(VALID);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test('카드 제목·섹션·프롬프트가 빠지면 실패한다', () => {
  const invalid = structuredClone(VALID);
  delete invalid.card.title;
  invalid.image.prompt = '';
  const result = validateBrief(invalid);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /card.title/);
  assert.match(result.errors.join('\n'), /image.prompt/);
});

test('JSON 문자열을 읽어 검증된 브리프로 반환한다', () => {
  const loaded = loadBrief(() => JSON.stringify(VALID), 'brief.json');
  assert.equal(loaded.card.title, VALID.card.title);
});

test('eyebrow는 선택 필드지만 빈 문자열이면 실패한다', () => {
  const withEyebrow = structuredClone(VALID);
  withEyebrow.card.eyebrow = 'SUMMER ’26 · RELEASE UPDATE';
  assert.equal(validateBrief(withEyebrow).ok, true);
  withEyebrow.card.eyebrow = '  ';
  assert.match(validateBrief(withEyebrow).errors.join('\n'), /card.eyebrow/);
});

test('layoutMode는 skin·panels·full만 허용한다', () => {
  const brief = structuredClone(VALID);
  for (const mode of ['skin', 'panels', 'full']) {
    brief.image.layoutMode = mode;
    assert.equal(validateBrief(brief).ok, true, mode);
  }
  brief.image.layoutMode = 'freeform';
  assert.match(validateBrief(brief).errors.join('\n'), /layoutMode/);
});

test('full 모드에서 negativePrompt가 텍스트를 금지하면 자기모순으로 실패한다', () => {
  const brief = structuredClone(VALID);
  brief.image.layoutMode = 'full';
  brief.image.negativePrompt = 'neon, readable text';
  assert.match(validateBrief(brief).errors.join('\n'), /must not ban text/);
  brief.image.negativePrompt = 'neon, misspelled Korean';
  assert.equal(validateBrief(brief).ok, true);
});

test('full 모드는 card.accent 를 요구한다 — 섹션별 tone 무지개를 막는 축이다', () => {
  const brief = structuredClone(VALID);
  brief.image.layoutMode = 'full';
  delete brief.card.accent;
  assert.match(validateBrief(brief).errors.join('\n'), /card\.accent is required/);
  brief.card.accent = 'rainbow';
  assert.match(validateBrief(brief).errors.join('\n'), /card\.accent/);
  brief.card.accent = 'removed';
  assert.equal(validateBrief(brief).ok, true);
});

test('skin·panels 는 accent 를 요구하지 않는다 — 색은 tone 이 정한다', () => {
  const brief = structuredClone(VALID);
  delete brief.card.accent;
  for (const mode of ['skin', 'panels']) {
    brief.image.layoutMode = mode;
    assert.equal(validateBrief(brief).ok, true, mode);
  }
});

test('weight 는 primary·secondary·aside 만 허용한다', () => {
  const brief = structuredClone(VALID);
  brief.card.sections[0].weight = 'huge';
  assert.match(validateBrief(brief).errors.join('\n'), /weight must be/);
  brief.card.sections[0].weight = 'aside';
  assert.equal(validateBrief(brief).ok, true);
});

test('full 모드에서 primary 는 최대 1개다 — 둘이면 위계가 사라진다', () => {
  const brief = structuredClone(VALID);
  brief.image.layoutMode = 'full';
  const base = brief.card.sections[0];
  brief.card.sections = [
    { ...structuredClone(base), weight: 'primary' },
    { ...structuredClone(base), weight: 'primary' }
  ];
  assert.match(validateBrief(brief).errors.join('\n'), /at most 1 section may have weight "primary"/);
});

test('full 모드 섹션이 3개 이상이면 primary 가 정확히 1개 있어야 한다', () => {
  const brief = structuredClone(VALID);
  brief.image.layoutMode = 'full';
  const base = brief.card.sections[0];
  brief.card.sections = [
    { ...structuredClone(base), weight: 'secondary' },
    { ...structuredClone(base), weight: 'secondary' },
    { ...structuredClone(base), weight: 'aside' }
  ];
  assert.match(validateBrief(brief).errors.join('\n'), /exactly 1 section must have weight "primary"/);
  brief.card.sections[0].weight = 'primary';
  assert.equal(validateBrief(brief).ok, true);
});

test('full 모드는 장문 텍스트를 브리프 단계에서 거른다', () => {
  const brief = structuredClone(VALID);
  brief.image.layoutMode = 'full';
  brief.image.negativePrompt = 'neon';
  brief.card.sections[0].rows[0][1] = '아주 길고 긴 값이 사십 자를 넘어가면 이미지 텍스트 오타 위험이 급증하므로 여기서 거른다';
  brief.card.lead = '리드 문장이 구십 자를 넘어가는 경우에도 마찬가지로 이미지 안에서 문단급 본문이 되어 오타 위험이 커지므로 브리프 검증 단계에서 실패시키는 것이 맞다. 그래서 이 문장은 일부러 길게 써 본다.';
  const errors = validateBrief(brief).errors.join('\n');
  assert.match(errors, /rows\[0\] value must be ≤40/);
  assert.match(errors, /card.lead must be ≤90/);
  // skin 모드는 코드 조판이라 길이 가드를 타지 않는다
  brief.image.layoutMode = 'skin';
  assert.doesNotMatch(validateBrief(brief).errors.join('\n'), /≤90/);
});

test('bubble·mascotAction·iconHints는 형식이 틀리면 실패한다', () => {
  const brief = structuredClone(VALID);
  brief.card.bubble = ' ';
  brief.image.mascotAction = '';
  brief.card.sections[0].iconHints = 'not-an-array';
  const errors = validateBrief(brief).errors.join('\n');
  assert.match(errors, /card.bubble/);
  assert.match(errors, /mascotAction/);
  assert.match(errors, /iconHints/);
});

test('panels 모드에서 negativePrompt가 패널을 금지하면 자기모순으로 실패한다', () => {
  const brief = structuredClone(VALID);
  brief.image.layoutMode = 'panels';
  brief.image.negativePrompt = 'text, fixed information panels';
  assert.match(validateBrief(brief).errors.join('\n'), /must not ban panels/);
});

test('compare rows는 4쌍을 넘으면 실패한다', () => {
  const brief = structuredClone(VALID);
  brief.card.sections[0].rows = [['a', '1'], ['b', '2'], ['c', '3'], ['d', '4'], ['e', '5']];
  assert.match(validateBrief(brief).errors.join('\n'), /1-4 label\/value pairs/);
});

test('full은 boolean만 허용한다', () => {
  const brief = structuredClone(VALID);
  brief.card.sections[0].full = 'yes';
  assert.match(validateBrief(brief).errors.join('\n'), /full must be a boolean/);
});

test('eyebrow·layoutMode·full은 선택 필드지만 형식은 검증한다', () => {
  const ok = structuredClone(VALID);
  ok.card.eyebrow = 'SUMMER ’26 · RELEASE UPDATE';
  ok.image.layoutMode = 'panels';
  ok.card.sections[0].full = true;
  assert.equal(validateBrief(ok).ok, true);

  const bad = structuredClone(VALID);
  bad.card.eyebrow = '   ';
  bad.image.layoutMode = 'freeform';
  bad.card.sections[0].full = 'yes';
  const result = validateBrief(bad);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /card.eyebrow/);
  assert.match(result.errors.join('\n'), /image.layoutMode/);
  assert.match(result.errors.join('\n'), /full/);
});

test('panels 모드에서 negativePrompt가 패널을 금지하면 자기모순으로 실패한다', () => {
  const bad = structuredClone(VALID);
  bad.image.layoutMode = 'panels';
  bad.image.negativePrompt = 'text, fixed information panels';
  const result = validateBrief(bad);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /must not ban panels/);
});

test('compare rows는 4쌍을 넘으면 실패한다', () => {
  const bad = structuredClone(VALID);
  bad.card.sections[0].rows = [['a','b'],['c','d'],['e','f'],['g','h'],['i','j']];
  const result = validateBrief(bad);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /1-4 label\/value pairs/);
});
