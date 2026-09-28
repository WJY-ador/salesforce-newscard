/**
 * JSON 파일 입출력 공용 — 스냅샷·diff 파일이 전부 이걸 쓴다.
 *
 * writeJson 은 원자적이다 (tmp 에 쓰고 rename). 수집기가 쓰는 도중 죽으면
 * 반쪽 JSON 이 남고, 다음 실행이 그걸 기준선 삼아 가짜 added 를 무더기로
 * 만든다 — out/sent.json 이 이미 쓰는 패턴을 스냅샷 전체로 넓힌 것이다.
 *
 * readJson 은 파일이 없을 때만 fallback 을 준다. 손상 JSON 은 조용히
 * fallback 으로 덮지 않고 크게 실패한다 — 손상을 빈 스냅샷으로 넘기면
 * 기존 항목 전부가 added 로 보여 없는 소식이 나간다 (send-to-slack 이
 * 손상 sent.json 에서 중단하는 것과 같은 원칙).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function writeJson(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  renameSync(tmp, path);
}

export function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`${path} 를 읽을 수 없습니다(JSON 손상): ${e.message}\n` +
      '손으로 고치거나 지운 뒤 다시 실행하세요 — 빈 값으로 넘기면 전 항목이 신규로 오보됩니다.');
  }
}
