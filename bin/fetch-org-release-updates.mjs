/**
 * Org 실물 Release Update 수집 — 카드 검증의 두 번째 다리 (2026-08-04)
 *
 *   node bin/fetch-org-release-updates.mjs                  수집 + diff
 *   node bin/fetch-org-release-updates.mjs --grep triple    항목 검증 조회 (수집 없이)
 *   node bin/fetch-org-release-updates.mjs -o <alias>       다른 org 로 (없으면 SF_TARGET_ORG → sf 기본 org)
 *
 *   → content/org-release-updates.json        스냅샷 (커밋)
 *   → content/org-release-updates.prev.json   직전 스냅샷 (ignore)
 *
 * 왜 필요한가. 기존 검증은 전부 help.salesforce.com 문서 쪽이다 — 문서가 말하는
 * 것과 org 에 실제로 와 있는 것은 다를 수 있다 (연기·조기 적용·org 별 차이).
 * 카드에 실을 시점·강제 여부를 릴리스 노트 문구가 아니라 연결된 dev org 의
 * Tooling API ReleaseUpdate 로 대조한다. 부수 효과로 SupportsRevoke(되돌릴 수
 * 있나) 처럼 문서에 잘 없는 메타데이터가 로컬에 쌓여 재활용된다.
 *
 * Chrome 이 필요 없다 — sf CLI 인증(VS Code 가 관리)으로 즉시 조회된다.
 * 스냅샷 규칙은 다른 fetcher 와 같다: 수집 시각을 넣지 않는다. 항목이 변할 때만
 * 파일이 변해야 git 히스토리가 곧 org 쪽 변천사가 된다.
 */
import { execFileSync } from 'node:child_process';
import { renameSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson } from './lib/io.mjs';
import { mergePending } from './lib/pending.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = process.env.NEWSCARD_CONTENT_DIR ? resolve(process.env.NEWSCARD_CONTENT_DIR) : resolve(ROOT, 'content');
const OUT = process.env.NEWSCARD_OUT_DIR ? resolve(process.env.NEWSCARD_OUT_DIR) : resolve(ROOT, 'out');
const CUR = resolve(CONTENT, 'org-release-updates.json');
const PREV = resolve(CONTENT, 'org-release-updates.prev.json');
const MANIFEST = resolve(ROOT, 'assets/editorial/infographic/manifest.json');
const PENDING = resolve(OUT, 'pending-changes.json');

const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : null; };
const ORG = opt('-o') || opt('--target-org') || process.env.SF_TARGET_ORG || null;
const GREP = opt('--grep');

const FIELDS = [
  'DeveloperName', 'Title', 'Status', 'StepStage', 'Category',
  'ReleaseLabel', 'ReleaseDate', 'DueDate', 'IsReleased', 'ApiVersion',
  'NumSteps', 'NumReqSteps', 'NumCompSteps', 'SupportsRevoke',
  'AutoEnforceOnSandboxOnly', 'RecompileApexClasses', 'Description'
];

function query() {
  const cmd = ['data', 'query', '--use-tooling-api', '--json',
    '--query', `SELECT ${FIELDS.join(', ')} FROM ReleaseUpdate ORDER BY DeveloperName`];
  if (ORG) cmd.push('-o', ORG);
  const out = execFileSync('sf', cmd, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 60000 });
  const parsed = JSON.parse(out);
  if (parsed.status !== 0) throw new Error(parsed.message || 'sf data query 실패');
  return parsed.result.records || [];
}

function orgInfo() {
  const cmd = ['org', 'display', '--json'];
  if (ORG) cmd.push('-o', ORG);
  const j = JSON.parse(execFileSync('sf', cmd, { encoding: 'utf8', timeout: 30000 }));
  return { id: j.result.id, alias: j.result.alias || j.result.username };
}

const shape = r => ({
  title: r.Title,
  status: r.Status,
  stepStage: r.StepStage || null,
  category: r.Category || null,
  releaseLabel: r.ReleaseLabel || null,
  releaseDate: r.ReleaseDate || null,
  dueDate: r.DueDate || null,
  isReleased: !!r.IsReleased,
  apiVersion: r.ApiVersion ?? null,
  steps: { total: r.NumSteps ?? 0, required: r.NumReqSteps ?? 0, completed: r.NumCompSteps ?? 0 },
  supportsRevoke: !!r.SupportsRevoke,
  autoEnforceOnSandboxOnly: !!r.AutoEnforceOnSandboxOnly,
  recompileApexClasses: !!r.RecompileApexClasses,
  // 재활용 목적의 원문 보존 — 카드 문구는 여기서 베끼지 말고 요약해 쓴다
  description: r.Description || null
});

// ── 실행 ───────────────────────────────────────────────
const records = query();

// 검증 조회 모드 — 스냅샷을 건드리지 않고 매칭 항목만 보여준다.
// 브리프 작성 전 "이 항목이 org 에 실제로 와 있나, 시점·상태가 문서와 맞나"를 본다.
if (GREP) {
  const re = new RegExp(GREP, 'i');
  const hits = records.filter(r => re.test(r.DeveloperName) || re.test(r.Title || ''));
  if (!hits.length) {
    console.log(`매칭 없음 — org 에 "${GREP}" 항목이 없습니다. 문서에만 있고 org 에 아직 안 온 변경일 수 있습니다 (그 사실 자체를 카드 검증에 쓰세요).`);
    process.exit(0);
  }
  for (const r of hits) {
    const s = shape(r);
    console.log(`■ ${r.DeveloperName}`);
    console.log(`  ${s.title}`);
    console.log(`  status ${s.status}${s.stepStage ? ' · stage ' + s.stepStage : ''} · 강제 ${s.dueDate || '(미정)'} · 릴리스 ${s.releaseLabel || '-'}${s.isReleased ? ' (릴리스됨)' : ''}`);
    console.log(`  되돌리기 ${s.supportsRevoke ? '가능' : '불가'} · 단계 ${s.steps.completed}/${s.steps.total}(필수 ${s.steps.required}) · Apex 재컴파일 ${s.recompileApexClasses ? '있음' : '없음'}`);
    if (s.description) console.log(`  ${String(s.description).replace(/\s+/g, ' ').slice(0, 160)}…`);
  }
  process.exit(0);
}

const org = orgInfo();
const items = {};
for (const r of records) items[r.DeveloperName] = shape(r);
const count = Object.keys(items).length;

// 실측 스냅샷은 수십 건이다. 0건은 org 연결·권한 문제로 본다 — 빈 스냅샷을
// 저장하면 다음 실행이 전부 added 로 보인다 (다른 fetcher 가드와 같은 이유).
if (count === 0) {
  console.error('ReleaseUpdate 가 0건입니다 — org 연결이나 Tooling API 권한을 확인하세요.');
  console.error('스냅샷을 갱신하지 않았습니다.');
  process.exit(1);
}

const prev = readJson(CUR, null);

// 다른 org 스냅샷 위에 덮으면 diff 전체가 노이즈가 된다 — org 가 다르면 멈춘다.
if (prev && prev.org && prev.org.id !== org.id && !args.includes('--force-org')) {
  console.error(`스냅샷의 org(${prev.org.alias})와 지금 org(${org.alias})가 다릅니다.`);
  console.error('의도한 전환이면 --force-org 를 붙이세요. 스냅샷을 갱신하지 않았습니다.');
  process.exit(1);
}

if (prev) {
  renameSync(CUR, PREV);
  const pi = prev.items || {};
  const added = Object.keys(items).filter(k => !pi[k]);
  const removed = Object.keys(pi).filter(k => !items[k]);
  const changed = Object.keys(items).filter(k => pi[k] && (
    pi[k].status !== items[k].status || pi[k].dueDate !== items[k].dueDate || pi[k].stepStage !== items[k].stepStage
  ));
  console.log(`org ${org.alias} — ${count}건 (신규 ${added.length} · 사라짐 ${removed.length} · 상태변화 ${changed.length})`);
  for (const k of added) console.log(`  + ${k} · ${items[k].status} · 강제 ${items[k].dueDate || '미정'}`);
  for (const k of removed) console.log(`  - ${k} (직전: ${pi[k].status})`);

  // 사라짐은 대개 자연 소멸(적용 완료·릴리스 이동)이라 큐에 안 넣는다. 단 **우리가 카드로 냈거나
  // 큐에 들고 있는 항목**이 사라진 것은 뉴스다 — 그 카드의 근거가 없어진 것이라 정정·hold 판정이
  // 필요하다. 실측: 발송한 카드의 근거 항목이 사라졌는데 로그 한 줄에만 찍히고 지나간 적이 있다.
  // manifest 의 developerName 과 큐 본문에서 이름을 찾는다.
  if (removed.length) {
    const manifestText = JSON.stringify(readJson(MANIFEST, []));
    const queueText = JSON.stringify(readJson(PENDING, { items: {} }));
    const watched = removed.filter(k => manifestText.includes(k) || queueText.includes(k));
    if (watched.length) {
      const q = mergePending(PENDING, watched.map(k => ({
        key: `ru-vanished-${k}`, source: 'org-release-updates', type: 'removed',
        data: { developerName: k, previous: pi[k], org: org.alias, note: '발송 카드 또는 큐 항목의 근거 Release Update 가 org 에서 사라짐 — 철회·병합·연기 1차 원문 확인 전엔 hold, 확인되면 정정 카드' }
      })));
      console.log(`  ! 발송·큐 관련 항목 소멸 ${watched.length}건 → 대기 큐 +${q.added} (총 ${q.total})`);
    }
  }
  for (const k of changed) {
    const b = pi[k], a = items[k];
    console.log(`  ~ ${k}: ${b.status}${b.dueDate ? '·' + b.dueDate : ''} → ${a.status}${a.dueDate ? '·' + a.dueDate : ''}`);
  }
} else {
  console.log(`org ${org.alias} — ${count}건 · 첫 스냅샷 (다음 실행부터 diff)`);
}

writeJson(CUR, { org, count, items });
console.log('content/org-release-updates.json');
