/**
 * Release Update 감시 — "안 하면 자동 적용되는 변경"
 *
 *   node bin/fetch-release-updates.mjs
 *   → content/release-updates.json         지금 스냅샷
 *   → content/release-updates.prev.json    직전 스냅샷
 *   → content/release-update-changes.json  이번에 감지한 변화
 *
 * Release Update 는 관리자가 아무것도 안 하면 정해진 릴리스에 자동 적용되는 동작
 * 변경이다. 기존 org를 깨뜨릴 수 있어서 Salesforce가 별도로 관리하고, 관리자는
 * Setup ▸ Release Updates 에서 미리 켜서 영향을 확인할 수 있다.
 *
 * 소스는 릴리스 노트 인덱스다. rn_ru.htm("Release Updates" 허브)을 직접 긁어봤지만
 * 사이드바 트리 때문에 인덱스와 같은 3.6MB가 나와 본문을 분리할 수 없었다.
 * 대신 인덱스에서 제목이 "(Release Update)" 로 끝나는 링크를 뽑는다 — 이게 깨끗하다.
 * Summer '26 기준 7건.
 *
 * 폐기 목록(bin/fetch-retirements.mjs)과 두 가지가 다르다.
 *
 *   1. 시점이 목록에 없다. 폐기 목록은 표에 (제품, 시점)이 한 행으로 있지만
 *      인덱스에는 제목과 링크뿐이다. 그래서 diff로 새로 추가된 항목만 상세
 *      페이지를 긁어 강제 시점을 얻는다. 보통 0~2건이라 비용이 작다.
 *
 *   2. 삭제가 뉴스가 아니다. 폐기 목록에서 행이 사라지면 철회지만, Release Update 는
 *      강제 적용이 끝나거나 릴리스가 넘어가면 자연히 목록에서 빠진다. 그걸 철회로
 *      보내면 오보다. 그래서 removed 는 기록만 하고 카드로 만들지 않는다.
 *
 * 폐기 목록과 겹치는 항목이 있다. "Salesforce to Salesforce Is Being Retired
 * (Release Update)" 는 폐기 목록에도 `Salesforce-to-Salesforce` 로 있다.
 * 같은 사건이 두 카드로 나가지 않게 겹침을 표시해서 뺀다.
 */
import { existsSync, readFileSync, renameSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergePending } from './lib/pending.mjs';
import { openBrowser, mapPool } from './lib/chrome.mjs';
import { nowKst, slug as slugBase, stripHtml as strip } from './lib/text.mjs';
import { readJson, writeJson } from './lib/io.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = process.env.NEWSCARD_CONTENT_DIR ? resolve(process.env.NEWSCARD_CONTENT_DIR) : resolve(ROOT, 'content');
const OUT = process.env.NEWSCARD_OUT_DIR ? resolve(process.env.NEWSCARD_OUT_DIR) : resolve(ROOT, 'out');
const BASE = 'https://help.salesforce.com/s/articleView?language=en_US&type=5&id=';
// release 파라미터를 붙이지 않는다. 기본값이 현재 릴리스라서 사이클이 넘어가면
// 자동으로 따라간다 (실측: 파라미터 없이 요청했더니 결과에 release=262 가 붙었다).
const INDEX_ID = 'release-notes.salesforce_release_notes.htm';

const CUR = resolve(CONTENT, 'release-updates.json');
const PREV = resolve(CONTENT, 'release-updates.prev.json');
const CHANGES = resolve(CONTENT, 'release-update-changes.json');
const RETIREMENTS = resolve(CONTENT, 'retirements.json');
const PENDING = resolve(OUT, 'pending-changes.json');

const args = process.argv.slice(2);
const has = k => args.includes(k);

// 기존 스냅샷·발송 이력(ru::…) 키가 이 절단 길이로 만들어져 있다 — 바꾸지 말 것
const slug = s => slugBase(s, { max: 72 });

// 겹침 판정용 정규화 — 하이픈·대소문자 차이를 지운다.
// 폐기 목록의 `Salesforce-to-Salesforce` 와 Release Update 제목의
// `Salesforce to Salesforce Is Being Retired` 를 맞추기 위한 것이다.
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const RETIRE_RE = /retire|retirement|deprecat|removal|removed|end[-_ ]?of[-_ ]?life|sunset/i;

/**
 * 인덱스에서 제목이 "(Release Update)" 로 끝나는 링크만 뽑는다.
 * 카테고리 묶음 페이지("Flow and Process Release Updates", "Lightning Components
 * Release Updates")는 접미사 형태가 달라서 자연히 걸러진다 — 개별 항목만 남는다.
 */
function parseIndex(dom) {
  const items = {};
  const re = /<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(dom))) {
    const href = m[1].replace(/&amp;/g, '&');
    const title = strip(m[2]);
    if (!/\(Release Update\)\s*$/i.test(title)) continue;
    const id = (href.match(/id=(release-notes\.[a-z0-9_.]+)/) || [])[1];
    if (!id) continue;
    const name = title.replace(/\s*\(Release Update\)\s*$/i, '').trim();
    if (!name) continue;
    items[slug(name)] = { name, id, url: BASE + id };
  }
  return items;
}

/**
 * 본문만 남긴다. 사이드바 네비게이션 트리가 DOM에 그대로 들어 있어서
 * 페이지 전체를 훑으면 남의 항목 제목을 본문으로 착각한다 — 실측으로
 * "enforc" 검색이 "Enforcing No-Argument Constructor on Apex Classes…" 같은
 * 사이드바 링크를 잡았다. fetch-release-notes.mjs 와 같은 방식으로
 * "You are here:" 브레드크럼 다음부터 "Did this article solve" 앞까지만 쓴다.
 */
function bodyLines(dom) {
  const lines = String(dom)
    .replace(/<(script|style|template|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|section)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .split('\n').map(l => strip(l)).filter(l => l.length > 2);
  let start = lines.findIndex(l => /^You are here:/i.test(l));
  if (start < 0) start = 0;
  let end = lines.findIndex((l, i) => i > start && /Did this article solve/i.test(l));
  if (end < 0) end = lines.length;
  return lines.slice(start + 1, end);
}

// 능동·수동 둘 다 나온다 (실측).
//   "Salesforce enforces this update in Summer ’26."   ← Sort Apex Batch
//   "This update is enforced in Spring '27."
// 곱은 인용부호(’)를 쓰는 경우가 있어 둘 다 받는다.
const ENFORCED_RE = /enforce[sd]?\s+(?:this\s+update\s+)?(?:in|on|beginning|starting)?\s*((?:Spring|Summer|Winter)\s*[’']?\s*\d{2}|[A-Z][a-z]+\s+\d{1,2},?\s*\d{4}|[A-Z][a-z]+\s+\d{4})/i;

/**
 * 상세 페이지에서 강제 시점을 찾는다. 새로 추가된 항목에만 쓴다.
 *
 * 시점을 억지로 채우지 않는다. 릴리스 노트가 When: 에 시점을 안 적는 경우가
 * 실제로 있다 — ICU Locale Formats 는 "To get the major release upgrade date for
 * your instance, go to Trust Status…" 라고만 적혀 있다. 그걸 시점으로 카드에
 * 실으면 사외 채널에 나가는 오보가 된다.
 *
 * @returns {{enforcedIn: string|null, whenNote: string|null}}
 *   enforcedIn  릴리스명·날짜가 명확히 잡힌 경우만
 *   whenNote    공식 When: 필드 원문 (시점이 아닐 수도 있다)
 */
async function fetchEnforcement(item) {
  const body = bodyLines(item.url ? await B.dumpDom(item.url) : '');

  // 시점은 When: 필드 안에서만 찾는다. 본문 전체를 훑으면 과거 이력 문구를 잡는다 —
  // 실측: ICU Locale Formats 는 When: 에 시점이 없는데 본문 다른 곳의 "Spring '26"을
  // 잡아서 마치 그때 강제되는 것처럼 보였다. 이미 지난 릴리스였다.
  const whenLine = body.find(l => /^When:/i.test(l));
  const whenNote = whenLine ? whenLine.replace(/^When:\s*/i, '').trim() : null;

  const m = whenNote ? whenNote.match(ENFORCED_RE) : null;
  const enforcedIn = m ? m[1].replace(/\s+/g, ' ').trim() : null;

  return { enforcedIn, whenNote: whenNote ? whenNote.slice(0, 220) : null };
}

/**
 * 폐기 목록과 같은 사건인지. Release Update 제목에 폐기 어휘가 없으면 겹칠 수
 * 없으므로 먼저 걸러 오탐을 줄인다. 짧은 제품명("Quip")이 무관한 제목에
 * 우연히 들어가는 걸 막으려고 8자 이상만 부분 일치로 본다.
 */
function retirementOverlap(name) {
  if (!RETIRE_RE.test(name)) return null;
  let ret = {};
  try { ret = JSON.parse(readFileSync(RETIREMENTS, 'utf8')).items || {}; } catch { return null; }
  const t = norm(name);
  for (const [k, v] of Object.entries(ret)) {
    const n = norm(v.name);
    if (n.length >= 8 && t.includes(n)) return { key: k, name: v.name, timing: v.timing };
  }
  return null;
}

function diff(prev, cur) {
  const pk = Object.keys(prev), ck = Object.keys(cur);
  let added = ck.filter(k => !prev[k]).map(k => ({ key: k, ...cur[k] }));
  // 강제 적용이 끝나거나 릴리스가 넘어가면 자연히 빠진다. 기록만 하고 카드로
  // 만들지 않는다 — 철회로 보내면 오보다.
  let removed = pk.filter(k => !cur[k]).map(k => ({ key: k, ...prev[k] }));
  // 제목 변경(같은 릴리스 노트 id 가 added·removed 양쪽) 은 신규가 아니라 "바뀐 항목"이다 —
  // 본문(When) 도 같이 바뀐 경우가 있어 기발송 데둡으로 지우면 안 된다. behavior-changes 와 같은 처리.
  const byId = new Map(removed.map(r => [r.id, r]));
  const renamed = added.filter(a => byId.has(a.id))
    .map(a => ({ ...a, previousName: byId.get(a.id).name, previousKey: byId.get(a.id).key }));
  if (renamed.length) {
    const ids = new Set(renamed.map(r => r.id));
    added = added.filter(a => !ids.has(a.id));
    removed = removed.filter(r => !ids.has(r.id));
  }
  return { added, removed, renamed };
}

// ── 실행 ───────────────────────────────────────────────
process.stdout.write('릴리스 노트 인덱스 수집 (Chrome) … ');
const B = await openBrowser({ concurrency: 4 });
const items = parseIndex(await B.dumpDom(BASE + INDEX_ID));
const count = Object.keys(items).length;

// 파싱이 깨지면 0건이 나온다. 스냅샷을 비우면 다음 실행이 전부 added 로 보고
// 없는 소식을 보낸다.
if (count === 0) {
  console.log('실패');
  await B.close();
  console.error('\nRelease Update 항목이 0건입니다 — 인덱스 구조가 바뀐 것으로 봅니다.');
  console.error('스냅샷을 갱신하지 않았습니다. parseIndex() 를 확인하세요.');
  process.exit(1);
}
console.log(`ok — ${count}건`);

const snapshot = { source: BASE + INDEX_ID, count, items };
const prevSnap = readJson(CUR, null);
const prevAt = prevSnap ? statSync(CUR).mtime.toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : null;

let changes;
if (!prevSnap) {
  changes = { comparedAt: nowKst(), baseline: true, added: [], removed: [] };
  console.log('\n첫 실행 — baseline 저장. 다음 실행부터 변화를 비교합니다.');
} else {
  const d = diff(prevSnap.items || {}, items);
  renameSync(CUR, PREV);

  // 새로 추가된 항목만 상세 페이지를 긁는다. 목록에는 시점이 없기 때문이다.
  // --no-detail 은 검증용 — Chrome 호출을 건너뛴다.
  if (d.added.length && !has('--no-detail')) {
    console.log(`\n신규 ${d.added.length}건의 강제 시점 수집 (동시 4)`);
    const enf = await mapPool(d.added, 4, a => fetchEnforcement(a).catch(() => null));
    for (const [i, a] of d.added.entries()) {
      process.stdout.write(`  ${a.name.slice(0, 42)} … `);
      const e = enf[i];
      if (!e) { a.enforcedIn = null; a.whenNote = null; console.log('실패'); continue; }
      a.enforcedIn = e.enforcedIn;
      a.whenNote = e.whenNote;
      console.log(e.enforcedIn
        ? `강제 ${e.enforcedIn}`
        : '(릴리스 노트에 시점 문구 없음 — 카드에 시점을 쓰지 않는다)');
    }
  }

  // 폐기 목록과 겹치는 항목을 표시한다. 카드 생성 쪽에서 이걸 보고 뺀다.
  for (const a of d.added) {
    const ov = retirementOverlap(a.name);
    if (ov) {
      a.retirementOverlap = ov;
      console.log(`  ⚠ 폐기 목록과 같은 사건 — ${a.name.slice(0, 40)} ↔ ${ov.name} (${ov.timing})`);
    }
  }

  changes = { comparedAt: nowKst(), baseline: false, prevFetchedAt: prevAt, ...d };

  const nNew = d.added.filter(a => !a.retirementOverlap).length;
  if (!d.added.length && !d.removed.length) {
    console.log(`\n변화 없음 (직전 수집: ${prevAt})`);
  } else {
    console.log(`\n변화 (직전 수집: ${prevAt})`);
    for (const a of d.added) {
      console.log(`  + 신규 강제 변경  ${a.name}${a.retirementOverlap ? '  [폐기 목록과 중복 — 카드 제외]' : ''}`);
    }
    for (const r of d.removed) {
      console.log(`  - 목록에서 빠짐   ${r.name}  (적용 완료 또는 릴리스 이동 — 카드로 만들지 않는다)`);
    }
    console.log(`  카드 대상: ${nNew}건`);
  }
}

await B.close();
writeJson(CUR, snapshot);
writeJson(CHANGES, changes);

// 주말에 낀 added 가 다음 실행에 덮어써지지 않게 대기 큐에 누적한다.
// removed 는 넣지 않는다 — 적용 완료·릴리스 이동이라 카드가 아니다 (위 diff 주석 참고).
// retirementOverlap 표시는 data 에 그대로 실려서 루틴이 보고 뺀다.
if (!changes.baseline && (changes.added.length || (changes.renamed || []).length)) {
  const q = mergePending(PENDING, [
    ...changes.added.map(a => ({ key: a.key, source: 'release-updates', type: 'added', data: a })),
    ...(changes.renamed || []).map(a => ({ key: a.key, source: 'release-updates', type: 'changed', data: { ...a, note: '제목 변경 — 기발송이어도 삭제 전 본문(When·Where) 대조 필수' } }))
  ]);
  if (q.added) console.log(`대기 큐 +${q.added}건 (총 ${q.total}건) — out/pending-changes.json`);
  for (const r of changes.renamed || []) console.log(`  ~ [제목 변경] ${r.previousName.slice(0, 60)} → ${r.name.slice(0, 60)}`);
}

console.log(`\ncontent/release-updates.json (${count}건)`);
console.log('content/release-update-changes.json');
