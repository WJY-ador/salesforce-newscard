import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { loadEditorialDataUri, loadEditorialIllustration, renderEditorialIllustration } = require(resolve(ROOT, 'design/editorial-illustration.js'));

test('PNG data URI를 히어로용 이미지 태그로 렌더한다', () => {
  const html = renderEditorialIllustration('data:image/png;base64,AA==', '3D <마스코트>');
  assert.match(html, /class="editorial-illustration"/);
  assert.match(html, /alt="3D &lt;마스코트&gt;"/);
});

test('PNG와 WebP 외 URI는 렌더하지 않는다', () => {
  assert.equal(renderEditorialIllustration('https://example.test/a.png', 'x'), '');
  assert.equal(renderEditorialIllustration('data:image/svg+xml;base64,AA==', 'x'), '');
});

test('검수 자산을 읽지 못하면 빈 문자열을 돌려 SVG 폴백을 허용한다', () => {
  const unreadable = () => { throw new Error('EACCES'); };
  assert.equal(loadEditorialIllustration(unreadable, '/unreadable.png', 'x'), '');
});

test('검수 PNG를 배경용 data URI로 읽는다', () => {
  const uri = loadEditorialDataUri(() => Buffer.from([0, 1, 2]), '/asset.png');
  assert.equal(uri, 'data:image/png;base64,AAEC');
});
