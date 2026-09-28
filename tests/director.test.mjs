/**
 * design/director.js — 연출 결정 규칙.
 * 주석에 박힌 실측 사고 사례들이 그대로 테스트 케이스다: 순서가 바뀌면
 * 의미가 정반대인 카드(철회를 기능 중단으로)가 사외 채널에 나간다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { decide, gate, BADGES } = require(resolve(ROOT, 'design/director.js'));

test('eventType 확정 입력이 제목 어휘보다 우선한다', () => {
  assert.equal(decide({ eventType: 'reversed', title: 'Quip' }).badge, 'reversed');
  assert.equal(decide({ eventType: 'announced', title: 'Quip' }).badge, 'retired');
  assert.equal(decide({ eventType: 'imminent', title: 'Maps Mobile App' }).badge, 'urgent');
  assert.equal(decide({ eventType: 'enforced', title: 'ICU Locale' }).badge, 'urgent');
  assert.equal(decide({ eventType: 'rescheduled', title: 'Lightning Sync' }).badge, 'urgent');
});

test('철회가 폐기보다 먼저 — Backtracks 제목이 기능 중단으로 나가면 오보다', () => {
  const d = decide({ id: 'x', title: 'Salesforce Backtracks on Permission Retirement in Profiles' });
  assert.equal(d.badge, 'reversed');
  assert.equal(d.pose, 'check');
});

test('약한 역전 어휘는 폐기 맥락에서만 — Dreamforce delayed 는 철회가 아니다', () => {
  const d = decide({ id: 'x', title: 'Dreamforce 2026 delayed to October' });
  assert.notEqual(d.badge, 'reversed');
});

test('폐기 키워드 → tumble·dead·retired', () => {
  const d = decide({ id: 'x', title: 'Workflow Rules Are Being Retired' });
  assert.deepEqual([d.pose, d.expression, d.badge], ['tumble', 'dead', 'retired']);
});

test('GA 판정이 고득점 즉시검토보다 먼저 — 82점 GA 는 jump 다', () => {
  const d = decide({ id: 'x', title: 'Agentforce Voice now available',
    score: 82, recommendation: '즉시 검토' });
  assert.equal(d.pose, 'jump');
  assert.equal(d.badge, 'official');
});

test('커뮤니티 출처는 표정·배지를 덮어쓰고 자세는 유지한다', () => {
  const d = decide({ id: 'x', title: 'Some Feature Is Being Retired', tier: 'community' });
  assert.equal(d.expression, 'skeptical');
  assert.equal(d.badge, 'community');
  assert.equal(d.pose, 'tumble');   // 내용의 성격(폐기)은 출처와 별개
});

test('영향 프로젝트 둘 이상이면 deepdive-dual', () => {
  assert.equal(decide({ id: 'x', title: 'y', evidence: ['a', 'b'] }).template, 'deepdive-dual');
  assert.equal(decide({ id: 'x', title: 'y', evidence: ['a'] }).template, 'deepdive');
});

test('규칙 미적용 구간은 confidence low — Claude 판단으로 넘긴다', () => {
  assert.equal(decide({ id: 'x', title: '무엇인지 알 수 없는 항목' }).confidence, 'low');
});

test('배지 스타일이 항상 붙는다', () => {
  const d = decide({ id: 'x', title: 'y' });
  assert.ok(d.badgeStyle && d.badgeStyle.label);
  assert.ok(Object.values(BADGES).includes(d.badgeStyle));
});

// ── gate() — 선별. decide 와 섞으면 how-to 가 전부 통과한다 (실측 43건 중 오탐 6건) ──

test('gate: eventType 확정 입력은 무조건 통과', () => {
  assert.equal(gate({ eventType: 'announced', title: 'Quip' }).pass, true);
});

test('gate: U-Turn 은 READ_RE(what…?)에 걸려도 철회 소식이라 통과', () => {
  const g = gate({ id: 'x', title: "What the Community Really Thinks About Salesforce's Permissions U-Turn" });
  assert.equal(g.pass, true);
});

test('gate: 타사 주체는 탈락 — Jack Dorsey 의 출시를 우리 GA 로 잡으면 안 된다', () => {
  assert.equal(gate({ id: 'x', title: "Jack Dorsey Launches Rival to Salesforce's Slack" }).pass, false);
});

test('gate: how-to·팁은 탈락', () => {
  assert.equal(gate({ id: 'x', title: 'How to Deploy Flows' }).pass, false);
  assert.equal(gate({ id: 'x', title: '10 Tips for Layoff-Proofing Your Career' }).pass, false);
});

test('gate: 강제 적용은 읽을거리 어휘가 섞여도 통과 — MFA Enforcement Checklist', () => {
  assert.equal(gate({ id: 'x', title: '5 Days to Go: MFA Enforcement Checklist' }).pass, true);
});

test('gate: 공식 GA 통과', () => {
  assert.equal(gate({ id: 'x', title: 'Salesforce Foundations now available' }).pass, true);
});
