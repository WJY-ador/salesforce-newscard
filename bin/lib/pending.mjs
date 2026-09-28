/**
 * 카드 후보 대기 큐 — out/pending-changes.json
 *
 * diff 파일(*-changes.json, behavior-change-diff.json)은 하루 창이다. 수집이
 * 주말에도 돌면 토요일 added가 일요일 실행에 덮어써져서 월요일 루틴이 못 본다.
 * 그래서 수집기 셋(retirements · release-updates · behavior-changes)이 added/changed를
 * 여기에 누적하고, 평일 루틴이 판정(카드 발송 또는 탈락)한 항목만 지운다.
 *
 * blog · events · 폐기 임박(soon D-30)은 넣지 않는다 — 목록 전체 + out/sent.json
 * 데둡 방식이라 발송 전까지 원본 목록에 계속 남아 있어 유실이 없다.
 *
 * 같은 키가 다시 감지되면 firstSeen은 지키고 data만 갱신한다 — 큐 체류 기간이
 * "묵은 후보" 판정(루브릭: 7일)의 근거이기 때문이다.
 */
import { existsSync, readFileSync, renameSync } from 'node:fs';
import { writeJson } from './io.mjs';

const nowKst = () =>
  new Date(Date.now() + 9 * 3600e3).toISOString().replace('T', ' ').slice(0, 19) + ' KST';

/**
 * @param {string} path  out/pending-changes.json 절대 경로 (호출자가 ROOT 기준으로 준다)
 * @param {Array<{key: string, source: string, type: string, data: object}>} entries
 *   key    항목 슬러그 (수집기의 기존 key 그대로)
 *   source 'retirements' | 'release-updates' | 'behavior-changes'
 *   type   'added' | 'changed' | 'removed'
 * @returns {{added: number, refreshed: number, total: number}}
 */
export function mergePending(path, entries) {
  let queue = { note: '루틴이 판정하기 전까지 누적되는 카드 후보 큐. 수집기가 쓰고, 평일 루틴이 판정한 항목을 지운다.', items: {} };
  if (existsSync(path)) {
    // 깨진 큐를 조용히 빈 큐로 덮으면 누적분이 사라진다 — diff 덮어쓰기와 같은 사고다.
    // 원본 바이트를 .corrupt 로 밀어두고 경고한 뒤 새로 시작한다 (수집 자체는 계속).
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      if (parsed && typeof parsed.items === 'object') queue = parsed;
    } catch {
      renameSync(path, path + '.corrupt');
      console.error(`대기 큐 파싱 실패 — ${path}.corrupt 로 보존하고 새 큐로 시작합니다.`);
    }
  }

  let added = 0, refreshed = 0;
  for (const e of entries) {
    const qk = `${e.source}::${e.type}::${e.key}`;
    if (queue.items[qk]) {
      queue.items[qk].data = e.data;
      refreshed += 1;
    } else {
      queue.items[qk] = { source: e.source, type: e.type, key: e.key, firstSeen: nowKst(), data: e.data };
      added += 1;
    }
  }

  writeJson(path, queue);   // 원자적 — 쓰다 죽어도 누적 큐가 반쪽으로 깨지지 않는다
  return { added, refreshed, total: Object.keys(queue.items).length };
}
