/**
 * 이스케이프 드리프트 가드 — 템플릿들은 UMD 모듈이라 esc 를 공용 모듈로 뽑는 대신
 * 각 파일에 동일 구현을 두기로 했다 (브라우저 로딩 경로에 스크립트를 하나 더
 * 끼우는 비용이 중복 비용보다 크다는 판단, 2026-08-11). 이 테스트가 그 결정의
 * 안전장치다: 어느 파일의 esc 가 다시 좁아지면(예: 인용부호 누락) 여기서 걸린다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const FILES = [
  'bin/render-cards.mjs',
  'bin/demo-director.mjs',
  'templates/card.js',
  'templates/gpt-directed-card.js',
  'templates/editorial-infographic.js',
  'templates/editorial-infographic-dynamic.js',
  'design/editorial-illustration.js'
];

// 완전 셋: & < > " ' 다섯 문자 전부
const REQUIRED = ['&amp;', '&lt;', '&gt;', '&quot;', '&#39;'];

for (const f of FILES) {
  test(`escape 완전 셋 — ${f}`, () => {
    const src = readFileSync(resolve(ROOT, f), 'utf8');
    for (const ent of REQUIRED) {
      assert.ok(src.includes(ent), `${f} 의 이스케이프에 ${ent} 치환이 없다`);
    }
  });
}
