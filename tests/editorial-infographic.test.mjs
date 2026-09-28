import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { renderEditorialInfographic } = require(resolve(ROOT, 'templates/editorial-infographic.js'));

const CARD = {
  title: '배치 결과 첫 줄이 더 이상 오류가 아닙니다',
  lead: '지금은 실패한 요청이 위로 보이지만, Summer ’26부터는 요청을 보낸 순서대로 결과가 표시됩니다.',
  panels: [
    { tone: 'blue', title: '무엇이 바뀌나요?', items: ['지금: 오류가 난 요청이 맨 위로 정렬', '변경: 요청을 받은 순서 그대로 표시', '첫 줄이 성공이어도 정상일 수 있음'] },
    { tone: 'green', title: '처리 흐름', steps: ['요청 보냄', 'Apex 배치 실행', '결과 표시'] },
    { tone: 'purple', title: 'Setup에서 확인', items: ['Setup → Quick Find → Release Updates', 'Sort Apex Batch Action Results by Request Order', '테스트 후 활성화'] },
    { tone: 'orange', title: '배포 전 체크', items: ['현재 Flow 결과 순서 캡처', '변경 후 결과와 비교', 'Trust Status에서 업그레이드 일정 확인'] }
  ],
  takeaway: 'Apex 배치 결과 정렬이 요청 순서로 바뀝니다',
  source: '공식 릴리스 노트 · Summer ’26'
};

test('B 배너형 배경 위에 검증된 릴리스 문구를 카드 구조로 얹는다', () => {
  const html = renderEditorialInfographic(CARD, { background: 'data:image/png;base64,AA==' });
  assert.match(html, /class="editorial-infographic"/);
  assert.match(html, /배치 결과 첫 줄이 더 이상 오류가 아닙니다/);
  assert.match(html, /오류가 난 요청이 맨 위로 정렬/);
  assert.match(html, /Sort Apex Batch Action Results by Request Order/);
  assert.match(html, /Trust Status에서 업그레이드 일정 확인/);
  assert.match(html, /Apex 배치 결과 정렬이 요청 순서로 바뀝니다/);
});

test('배경이 없으면 카드를 렌더링하지 않는다', () => {
  assert.equal(renderEditorialInfographic(CARD, { background: '' }), '');
});
