import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { renderGptDirectedCard } = require(resolve(ROOT, 'templates/gpt-directed-card.js'));

const CARD = {
  label: 'GPT IMAGE 2 · VISUAL CONCEPT',
  title: '배치 결과 첫 줄이 더 이상 오류가 아닙니다',
  lead: 'Summer ’26부터 요청을 받은 순서대로 결과가 표시됩니다.',
  before: '오류가 난 요청이 맨 위',
  after: '요청을 받은 순서 그대로',
  actions: ['Release Updates에서 미리 테스트', 'Trust Status에서 업그레이드 날짜 확인'],
  source: '공식 릴리스 노트 · Summer ’26'
};

test('GPT 주도형 배경 위에 정확한 릴리스 사실을 세 패널로 합성한다', () => {
  const html = renderGptDirectedCard(CARD, { background: 'data:image/png;base64,AA==' });
  assert.match(html, /class="gpt-directed-card"/);
  assert.match(html, /GPT IMAGE 2 · VISUAL CONCEPT/);
  assert.match(html, /배치 결과 첫 줄이 더 이상 오류가 아닙니다/);
  assert.match(html, /오류가 난 요청이 맨 위/);
  assert.match(html, /Trust Status에서 업그레이드 날짜 확인/);
});

test('배경 data URI가 없으면 빈 카드 문자열을 돌린다', () => {
  assert.equal(renderGptDirectedCard(CARD, { background: '' }), '');
});
