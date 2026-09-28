import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergePending } from '../bin/lib/pending.mjs';

const tmpQueue = () => join(mkdtempSync(join(tmpdir(), 'pending-')), 'pending-changes.json');
const read = p => JSON.parse(readFileSync(p, 'utf8'));

test('새 항목은 firstSeen 과 함께 쌓인다', () => {
  const p = tmpQueue();
  const r = mergePending(p, [
    { key: 'maps-mobile', source: 'retirements', type: 'added', data: { name: 'Maps Mobile' } },
    { key: 'icu-locale', source: 'release-updates', type: 'added', data: { name: 'ICU' } }
  ]);
  assert.equal(r.added, 2);
  assert.equal(r.total, 2);
  const q = read(p);
  const item = q.items['retirements::added::maps-mobile'];
  assert.equal(item.data.name, 'Maps Mobile');
  assert.match(item.firstSeen, /KST$/);
});

test('같은 키 재감지는 firstSeen 을 지키고 data 만 갱신한다', () => {
  const p = tmpQueue();
  mergePending(p, [{ key: 'a', source: 'retirements', type: 'added', data: { timing: 'old' } }]);
  const before = read(p).items['retirements::added::a'].firstSeen;
  const r = mergePending(p, [{ key: 'a', source: 'retirements', type: 'added', data: { timing: 'new' } }]);
  assert.equal(r.added, 0);
  assert.equal(r.refreshed, 1);
  const after = read(p).items['retirements::added::a'];
  assert.equal(after.firstSeen, before);
  assert.equal(after.data.timing, 'new');
});

test('같은 키라도 type 이 다르면 다른 항목이다 — added 와 changed 공존', () => {
  const p = tmpQueue();
  const r = mergePending(p, [
    { key: 'a', source: 'retirements', type: 'added', data: {} },
    { key: 'a', source: 'retirements', type: 'changed', data: {} }
  ]);
  assert.equal(r.total, 2);
});

test('루틴이 소비(삭제)한 항목은 다음 merge 에도 살아나지 않는다 — 단 재감지되면 새 항목', () => {
  const p = tmpQueue();
  mergePending(p, [{ key: 'a', source: 'behavior-changes', type: 'added', data: {} }]);
  const q = read(p);
  delete q.items['behavior-changes::added::a'];   // 루틴의 소비를 흉내
  writeFileSync(p, JSON.stringify(q, null, 2));
  const r = mergePending(p, [{ key: 'b', source: 'behavior-changes', type: 'added', data: {} }]);
  assert.equal(r.total, 1);
  assert.equal(read(p).items['behavior-changes::added::a'], undefined);
});

test('깨진 큐는 .corrupt 로 보존하고 새 큐로 시작한다', () => {
  const p = tmpQueue();
  writeFileSync(p, '{broken json');
  const r = mergePending(p, [{ key: 'a', source: 'retirements', type: 'added', data: {} }]);
  assert.equal(r.total, 1);
  assert.ok(existsSync(p + '.corrupt'));
  assert.equal(readFileSync(p + '.corrupt', 'utf8'), '{broken json');
});

test('빈 entries 도 큐 파일은 만든다 — 루틴이 파일 부재와 빈 큐를 구분할 필요 없다', () => {
  const p = tmpQueue();
  const r = mergePending(p, []);
  assert.equal(r.total, 0);
  assert.deepEqual(read(p).items, {});
});
