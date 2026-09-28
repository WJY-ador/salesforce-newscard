/**
 * 커밋된 브리프 파일 ↔ 스키마 드리프트 가드.
 * card-brief.test.mjs 는 스키마 규칙 자체를 검증한다. 여기는 반대 방향 —
 * 저장소에 실재하는 브리프(재생성·이력 근거로 커밋됨)와 예제가 현행 스키마를
 * 계속 통과하는지 본다. 스키마를 조이면 여기서 깨진 파일이 바로 드러난다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { loadBrief } = require(resolve(ROOT, 'templates/card-brief.js'));

const files = [
  resolve(ROOT, 'content/card-brief.example.json'),
  ...readdirSync(resolve(ROOT, 'content/briefs'))
    .filter(f => f.endsWith('.json'))
    .map(f => resolve(ROOT, 'content/briefs', f))
];

for (const f of files) {
  test(`브리프 스키마 통과 — ${f.split('/').slice(-2).join('/')}`, () => {
    const brief = loadBrief(readFileSync, f);
    assert.ok(brief.card && brief.card.title, 'card.title 이 없다');
  });
}
