import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeEntities, stripHtml, slug, nowKst } from '../bin/lib/text.mjs';
import { writeJson, readJson } from '../bin/lib/io.mjs';

test('decodeEntities — 숫자(10·16진)와 이름 엔티티', () => {
  assert.equal(decodeEntities('&#8217;s &#x27;x&#x27;'), '’s \'x\'');
  assert.equal(decodeEntities('A &amp; B &ldquo;q&rdquo;'), 'A & B "q"');
  assert.equal(decodeEntities('&unknown; 그대로'), '&unknown; 그대로');
});

test('stripHtml — 태그 제거 + 엔티티 + 공백 정리', () => {
  assert.equal(stripHtml('<td> Maps&nbsp;Mobile <span>App</span> </td>'), 'Maps Mobile App');
  assert.equal(stripHtml('a<br>b\n\nc'), 'a b c');
});

test('slug — 기존 수집기별 동작 보존', () => {
  // fetch-retirements / fetch-release-updates (max 72, 한글 제거)
  assert.equal(slug("Salesforce's Maps — Mobile App"), 'salesforces-maps-mobile-app');
  assert.equal(slug('A & B'), 'a-and-b');
  // fetch-events (max 64, 한글 유지)
  assert.equal(slug('세일즈포스 AI 데이', { max: 64, keepKorean: true }), '세일즈포스-ai-데이');
  assert.equal(slug('세일즈포스 데이', { max: 72 }), '');   // 한글 미허용이면 전부 떨어진다
  // max 절단
  assert.equal(slug('x'.repeat(100), { max: 90 }).length, 90);
  // 곱은 인용부호와 곧은 인용부호 둘 다 제거 — 키가 인용부호 표기에 흔들리지 않는다
  assert.equal(slug('Don’t'), slug("Don't"));
});

test('nowKst — 형태', () => {
  assert.match(nowKst(), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} KST$/);
});

test('writeJson — 원자적 쓰기: 본 파일 생성, tmp 잔여물 없음', () => {
  const dir = mkdtempSync(join(tmpdir(), 'newscard-io-'));
  const p = join(dir, 'sub', 'snap.json');
  writeJson(p, { a: 1 });
  assert.deepEqual(JSON.parse(readFileSync(p, 'utf8')), { a: 1 });
  assert.equal(existsSync(p + '.tmp'), false);
  assert.equal(readFileSync(p, 'utf8').endsWith('\n'), true);
  rmSync(dir, { recursive: true, force: true });
});

test('readJson — 없으면 fallback, 손상이면 크게 실패', () => {
  const dir = mkdtempSync(join(tmpdir(), 'newscard-io-'));
  const p = join(dir, 'x.json');
  assert.deepEqual(readJson(p, { items: {} }), { items: {} });
  writeFileSync(p, '{ 깨진 json');
  assert.throws(() => readJson(p, { items: {} }), /JSON 손상/);
  rmSync(dir, { recursive: true, force: true });
});
