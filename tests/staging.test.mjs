import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { planStaging, availableSlots, SIZE_PX, BAND_PX } = require(resolve(ROOT, 'design/staging.js'));

test('마리 수는 배열 길이다 — 0마리도 3마리도 된다', () => {
  assert.equal(planStaging([]).items.length, 0);
  assert.equal(planStaging(undefined).items.length, 0);
  const three = planStaging([
    { at: 'hero', pose: 'alert', expr: 'wide', size: 'lg' },
    { at: 'compare', side: 'mid', pose: 'lean', expr: 'look', size: 'sm' },
    { at: 'band', pose: 'wave', expr: 'wink' }
  ]);
  assert.equal(three.items.length, 3);
});

test('같은 자리에 1마리면 tight, 2마리 이상이면 공통 viewBox', () => {
  const one = planStaging([{ at: 'hero', pose: 'alert', expr: 'wide', size: 'lg' }]);
  assert.equal(one.items[0].tight, true);

  const two = planStaging([
    { at: 'cols', side: 'left', pose: 'base', expr: 'look', size: 'sm' },
    { at: 'cols', side: 'right', pose: 'lean', expr: 'wink', size: 'sm' }
  ]);
  assert.equal(two.items[0].tight, false);
  assert.equal(two.items[1].tight, false);
});

test('band 는 size 를 무시하고 72px 고정이다', () => {
  const r = planStaging([{ at: 'band', pose: 'wave', expr: 'wink', size: 'lg' }]);
  assert.equal(r.items[0].px, BAND_PX);
  assert.equal(r.items[0].size, 'band');
});

test('big 자세는 sm 으로 못 간다 — md 로 올리고 경고를 남긴다', () => {
  const r = planStaging([{ at: 'figure', pose: 'jump', expr: 'happy', size: 'sm' }]);
  assert.equal(r.items[0].size, 'md');
  assert.equal(r.items[0].px, SIZE_PX.md);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /jump/);
});

test('없는 블록을 가리키면 그 항목만 버리고 경고를 남긴다 — 나머지는 산다', () => {
  const r = planStaging(
    [{ at: 'figure', pose: 'point', expr: 'look', size: 'md' },
     { at: 'hero', pose: 'alert', expr: 'wide', size: 'lg' }],
    ['hero', 'compare', 'band']
  );
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].at, 'hero');
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /figure/);
});

test('모르는 자리 이름도 버린다', () => {
  const r = planStaging([{ at: 'nowhere', pose: 'base', expr: 'neutral' }]);
  assert.equal(r.items.length, 0);
  assert.equal(r.warnings.length, 1);
});

test('side 기본값은 right, size 기본값은 md', () => {
  const r = planStaging([{ at: 'hero', pose: 'base', expr: 'neutral' }]);
  assert.equal(r.items[0].side, 'right');
  assert.equal(r.items[0].size, 'md');
});

test('availableSlots — figure 가 있으면 compare 는 없다', () => {
  assert.deepEqual(
    availableSlots({ figure: { kind: 'timeline' } }).sort(),
    ['band', 'figure', 'hero']
  );
  assert.deepEqual(
    availableSlots({ before: {}, after: {} }).sort(),
    ['band', 'compare', 'hero']
  );
});

test('availableSlots — cols 는 editions 나 todo 가 있을 때만, warn 은 warn 이 있을 때만', () => {
  const s = availableSlots({ before: {}, after: {}, todo: ['a'], warn: { text: 'x' } }).sort();
  assert.deepEqual(s, ['band', 'cols', 'compare', 'hero', 'warn']);
});
