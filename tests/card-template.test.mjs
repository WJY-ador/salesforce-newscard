/**
 * templates/card.js — deepdive 템플릿 스모크.
 * 렌더 전체를 검증하지 않는다 (시각 검증은 check-staging --measure 의 몫).
 * 여기서 잡는 것: ① 필수 내용이 출력에 실린다 ② 이스케이프가 뚫리지 않는다
 * ③ 높이 지정이 반영된다 — 셋 다 깨져도 렌더는 조용히 성공하는 것들이다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NewsCard = require(resolve(ROOT, 'templates/card.js'));

const base = {
  badge: 'urgent', badgeLabel: '릴리스 업데이트', cycle: "Summer '26",
  headline: '배치 결과 순서가 바뀝니다', lead: '리드 문장.', height: 900,
  // deepdive 는 전후 2박스(compare)가 필수 골격이다
  before: { when: '지금', text: '오류 요청이 맨 위' },
  after: { when: "Summer '26", text: '요청 순서 그대로' }
};

test('deepdive — 헤드라인·리드·높이가 출력에 실린다', () => {
  const html = NewsCard.deepdive(base, {});
  assert.ok(html.includes('배치 결과 순서가 바뀝니다'));
  assert.ok(html.includes('리드 문장.'));
  assert.ok(html.includes('height:900px'));
  assert.ok(html.includes('class="sheet"'));
});

test('deepdive — esc 경로(badge·cycle)는 속성 주입이 안 된다', () => {
  const html = NewsCard.deepdive({
    ...base,
    badge: 'x" onload="alert(1)',          // esc() 를 타는 값
    cycle: '<script>alert(1)</script>'
  }, {});
  assert.ok(!html.includes('onload="alert(1)"'), 'badge 값의 인용부호가 속성을 탈출했다');
  assert.ok(!html.includes('<script>alert(1)'), 'cycle 값의 태그가 살아서 들어갔다');
});

test('deepdive — headline/lead 는 rich 경로다 (의도된 마크업 통과)', () => {
  // 카드 정의가 <b> 강조를 쓰므로 rich() 는 이스케이프하지 않는 게 계약이다.
  // 이 테스트는 그 계약을 문서화한다 — 수집 데이터를 headline 에 넣으려면
  // 호출자(render-cards)가 esc0 를 먼저 통과시켜야 한다.
  const html = NewsCard.deepdive({ ...base, headline: '<b>강조</b> 제목' }, {});
  assert.ok(html.includes('<b>강조</b> 제목'));
});
