import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPromptPayload } from '../bin/prepare-gpt-image-prompt.mjs';

const BRIEF = {
  card: {
    title: '테스트 카드',
    lead: '리드',
    sections: [
      { tone: 'blue', type: 'compare', title: '변경', rows: [['a', 'b'], ['c', 'd']] },
      { tone: 'green', type: 'list', title: '확인', items: ['x', 'y'] }
    ]
  },
  image: {
    assetPath: 'assets/editorial/example.png',
    references: ['assets/mascot/base.png'],
    prompt: 'muted editorial background',
    negativePrompt: 'text, logos'
  }
};

test('Claude 브리프에서 GPT Image 2 세션용 합성 프롬프트를 만든다', () => {
  const payload = buildPromptPayload(BRIEF);
  assert.equal(payload.assetPath, BRIEF.image.assetPath);
  assert.deepEqual(payload.references, BRIEF.image.references);
  assert.equal(payload.size, '1024x1536');
  assert.equal(payload.layoutMode, 'skin');
  assert.equal(payload.stylePrompt, BRIEF.image.prompt);
  // 합성 프롬프트: 캔버스 + 스타일 + 레이아웃 + 마스코트
  assert.match(payload.prompt, /1024x1536/);
  assert.match(payload.prompt, /muted editorial/);
  assert.match(payload.prompt, /completely empty/);
  assert.match(payload.prompt, /white brick golem/);
  // 필수 금지어 자동 보강
  assert.match(payload.negativePrompt, /Korean letters/);
});

test('panels 모드면 레이아웃 문장이 패널 배치로 바뀐다', () => {
  const payload = buildPromptPayload({
    ...BRIEF,
    image: { ...BRIEF.image, layoutMode: 'panels', negativePrompt: 'neon' }
  });
  assert.equal(payload.layoutMode, 'panels');
  assert.match(payload.prompt, /exactly 2 empty rounded-rectangle panels/);
});
