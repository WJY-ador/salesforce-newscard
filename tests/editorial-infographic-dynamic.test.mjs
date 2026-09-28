import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { renderDynamicEditorialInfographic } = require(resolve(ROOT, 'templates/editorial-infographic-dynamic.js'));

const CARD = {
  eyebrow: 'SUMMER ’26 · RELEASE UPDATE',
  title: '배치 결과 첫 줄이 더 이상 오류가 아닙니다',
  lead: '지금은 실패한 요청이 위로 보이지만 Summer ’26부터는 요청 순서대로 표시됩니다.',
  sections: [
    { tone: 'blue', type: 'compare', title: '무엇이 달라지나요?', rows: [['지금까지', '오류가 난 요청이 맨 위'], ['Summer ’26', '요청을 받은 순서 그대로']] },
    { tone: 'green', type: 'flow', title: '처리 흐름', steps: ['Flow 요청', 'Apex 배치 액션', '결과 표시'] },
    { tone: 'purple', type: 'list', title: 'Setup에서 확인', items: ['Setup → Quick Find → Release Updates', 'Sort Apex Batch Action Results by Request Order', '테스트·활성화 단계 진행'] },
    { tone: 'orange', type: 'list', title: '영향을 받는 경우', items: ['Flow가 Apex 배치 결과 순서를 전제로 할 때', '첫 결과가 성공이어도 정상일 수 있음', '현재 결과와 변경 후 결과를 비교'] },
    { tone: 'gold', type: 'list', title: '배포 전 체크', items: ['현재 Flow 결과 캡처', 'Release Updates에서 미리 테스트', 'Trust Status에서 업그레이드 날짜 확인'] },
    { tone: 'note', type: 'note', title: '핵심', body: 'Summer ’26부터 자동 적용됩니다. 지금 미리 테스트해 결과 순서에 대한 가정을 확인하세요.', source: '공식 릴리스 노트 · Summer ’26' }
  ]
};

test('콘텐츠 수에 맞춰 동적 인포그래픽 패널을 만든다', () => {
  const html = renderDynamicEditorialInfographic(CARD, { background: 'data:image/png;base64,AA==' });
  assert.match(html, /editorial-infographic-dynamic/);
  assert.equal((html.match(/class="dynamic-section/g) || []).length, 6);
  assert.match(html, /Sort Apex Batch Action Results by Request Order/);
  assert.match(html, /Summer ’26부터 자동 적용됩니다/);
});

test('배경이 없으면 동적 카드를 렌더링하지 않는다', () => {
  assert.equal(renderDynamicEditorialInfographic(CARD, { background: '' }), '');
});

test('eyebrow는 브리프 데이터에서 오고 하드코딩되지 않는다', () => {
  const html = renderDynamicEditorialInfographic(CARD, { background: 'data:image/png;base64,AA==' });
  assert.match(html, /SUMMER ’26 · RELEASE UPDATE/);
  const other = renderDynamicEditorialInfographic(
    { ...CARD, eyebrow: 'WINTER ’27 · RETIREMENT' },
    { background: 'data:image/png;base64,AA==' }
  );
  assert.match(other, /WINTER ’27 · RETIREMENT/);
  assert.doesNotMatch(other, /SUMMER ’26 · RELEASE UPDATE/);
});

test('panels 모드는 panels-mode 클래스를 붙이고 skin 모드는 붙이지 않는다', () => {
  const skin = renderDynamicEditorialInfographic(CARD, { background: 'data:image/png;base64,AA==' });
  assert.doesNotMatch(skin, /panels-mode/);
  const panels = renderDynamicEditorialInfographic(CARD, { background: 'data:image/png;base64,AA==', layoutMode: 'panels' });
  assert.match(panels, /editorial-infographic-dynamic panels-mode/);
});

test('full 모드는 완성 카드 이미지를 그대로 흘려보내고 텍스트를 얹지 않는다', () => {
  const html = renderDynamicEditorialInfographic(CARD, { background: 'data:image/png;base64,AA==', layoutMode: 'full' });
  assert.match(html, /editorial-infographic-full/);
  assert.doesNotMatch(html, /dynamic-header/);
  assert.doesNotMatch(html, /dynamic-section/);
});

test('note 렌더는 type으로만 판정한다 — body가 있어도 list는 list로 그린다', () => {
  const card = { ...CARD, sections: [{ tone: 'blue', type: 'list', title: '목록', items: ['하나'], body: '무시될 본문' }] };
  const html = renderDynamicEditorialInfographic(card, { background: 'data:image/png;base64,AA==' });
  assert.match(html, /<ul>/);
  assert.doesNotMatch(html, /note-body/);
});
