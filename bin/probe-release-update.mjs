/**
 * Release Update 실측 프로브 — scratch org 에서 켜보고 코드 영향을 확인한다 (2026-08-04)
 *
 *   node bin/probe-release-update.mjs <DeveloperName> [--devhub <alias>] [--keep]
 *     Dev Hub 기본값: SF_DEVHUB → 없으면 sf 기본 Dev Hub
 *
 * 하는 일 (사람 클릭 0회, 실측 5분 이내):
 *   1. 일회용 scratch org 생성 (--keep 없으면 끝에 삭제)
 *   2. Tooling API 로 대상 Release Update 존재·상태 확인
 *   3. Settings:* 전체를 받아 대응 필드 탐색 (실측 커버리지 ~25% — 없으면 그 사실이 결과)
 *   4. 대표 패턴 Apex 스위트 배포 → BEFORE 실행
 *   5. Settings 배포로 활성화 → Tooling 상태 전이 확인 (Invocable→Revocable)
 *   6. 같은 스위트 AFTER 실행 → 영향 판정
 *   7. content/org-evidence/<slug>/ 에 probe.json + report.html(사람 뷰) 저장
 *
 * 알아둘 것 (2026-08-04 실측):
 *   - 적용 여부의 정본은 Tooling Status 다. Setup 목록 카드 진행률은 스텝 카운트
 *     기준이라 Settings 경로 활성화가 안 보인다.
 *   - WHERE DurableId= 필터는 Tooling 서버 오류를 뱉는다 — 전체 조회 후 로컬 필터.
 *   - scratch 는 빈 org 다. "대표 패턴 실측"이지 고객 org 보증이 아니다.
 *   - Setup 화면 캡처가 필요하면 세션에서 puppeteer 스크립트를 따로 쓴다
 *     (frontdoor sid 는 발급 즉시 사용해야 한다).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = process.env.NEWSCARD_CONTENT_DIR ? resolve(process.env.NEWSCARD_CONTENT_DIR) : resolve(ROOT, 'content');
const OUT = process.env.NEWSCARD_OUT_DIR ? resolve(process.env.NEWSCARD_OUT_DIR) : resolve(ROOT, 'out');
const args = process.argv.slice(2);
const TARGET = args.find(a => !a.startsWith('--'));
if (!TARGET) { console.error('사용법: node bin/probe-release-update.mjs <DeveloperName> [--devhub <alias>] [--keep]'); process.exit(1); }
const DEVHUB = args.includes('--devhub') ? args[args.indexOf('--devhub') + 1] : (process.env.SF_DEVHUB || null);
const KEEP = args.includes('--keep');
const ALIAS = 'ru-probe';
const slug = TARGET.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
const EVID = resolve(CONTENT, 'org-evidence', slug);

const t0 = Date.now();
const secs = from => Math.round((Date.now() - from) / 1000);
const step = (msg, from) => console.log(`  ${msg}${from ? ` (${secs(from)}초)` : ''}`);

function sf(cmdArgs, opts = {}) {
  const out = execFileSync('sf', [...cmdArgs, '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: opts.timeout || 300000, stdio: ['ignore', 'pipe', 'ignore'] });
  const j = JSON.parse(out);
  if (j.status !== 0 && !opts.lenient) throw new Error(`sf ${cmdArgs[0]} ${cmdArgs[1] || ''} 실패: ${(j.message || '').slice(0, 200)}`);
  return j.result;
}

const queryRUs = org => sf(['data', 'query', '--use-tooling-api', '-o', org, '--query',
  'SELECT DeveloperName, Title, Status, StepStage, Category, ReleaseLabel, DueDate, SupportsRevoke, RecompileApexClasses FROM ReleaseUpdate']).records;

function runTests(org) {
  const r = sf(['apex', 'run', 'test', '--class-names', 'RepPatternProbeTest', '--result-format', 'json', '--synchronous', '-o', org], { lenient: true });
  const s = (r && r.summary) || {};
  return { outcome: s.outcome || 'Unknown', passing: s.passing ?? 0, ran: s.testsRan ?? 0, failing: s.failing ?? 0, ms: s.testExecutionTime || '' };
}

// DeveloperName 토큰으로 Settings enable 필드를 찾는다. 이름이 정확히 일치하지 않는
// 경우가 실측으로 있다 (ApexBlockPackagedExecAnon ↔ enableBlockPackagedApexExecAnon).
function findMapping(settingsDir, developerName) {
  const stem = developerName.replace(/(ReleaseUpdate|CriticalUpdate|Update)$/i, '');
  const tokens = stem.match(/[A-Z][a-z0-9]+|[A-Z]{2,}(?![a-z])/g) || [stem];
  const files = readdirSync(settingsDir).filter(f => f.endsWith('.xml'));
  let best = null;
  for (const f of files) {
    const xml = readFileSync(join(settingsDir, f), 'utf8');
    for (const m of xml.matchAll(/<([a-zA-Z0-9]+)>(true|false)<\/\1>/g)) {
      const field = m[1], lower = field.toLowerCase();
      const hits = tokens.filter(t => lower.includes(t.toLowerCase())).length;
      const full = lower.includes(stem.toLowerCase()) ? tokens.length + 1 : 0;
      const score = Math.max(hits, full);
      // 토큰 과반 미만은 우연 일치로 본다 (예: 'Apex' 하나만 겹치는 필드)
      if (score >= Math.max(2, Math.ceil(tokens.length * 0.6)) && (!best || score > best.score)) {
        best = { file: f, field, value: m[2], score };
      }
    }
  }
  return best;
}

function writeApexProbe(prjDir) {
  const cls = join(prjDir, 'force-app/main/default/classes');
  mkdirSync(cls, { recursive: true });
  const meta = '<?xml version="1.0" encoding="UTF-8"?>\n<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata">\n    <apiVersion>67.0</apiVersion>\n    <status>Active</status>\n</ApexClass>\n';
  writeFileSync(join(cls, 'RepPatternProbe.cls'), [
    '/** 대표 패턴 프로브 — Release Update 전후로 같은 스위트를 돌려 동작 차이를 잡는다. */',
    'public with sharing class RepPatternProbe {',
    '    public static Account insertAndRead(String name) {',
    "        Account acc = new Account(Name = name, Description = 'created');",
    '        insert acc;',
    '        return [SELECT Id, Name, Description FROM Account WHERE Id = :acc.Id];',
    '    }',
    '    public static Account updateAndRead(Id accId, String newName) {',
    '        update new Account(Id = accId, Name = newName);',
    '        return [SELECT Id, Name, Description FROM Account WHERE Id = :accId];',
    '    }',
    '}'
  ].join('\n'));
  writeFileSync(join(cls, 'RepPatternProbe.cls-meta.xml'), meta);
  writeFileSync(join(cls, 'RepPatternProbeTest.cls'), [
    '@IsTest',
    'private class RepPatternProbeTest {',
    '    @IsTest static void insertPatternHoldsSteady() {',
    "        Account acc = RepPatternProbe.insertAndRead('Probe-Insert');",
    "        Assert.areEqual('Probe-Insert', acc.Name);",
    "        Assert.areEqual('created', acc.Description);",
    '    }',
    '    @IsTest static void updatePatternHoldsSteady() {',
    "        Account acc = RepPatternProbe.insertAndRead('Probe-Before');",
    "        Account after = RepPatternProbe.updateAndRead(acc.Id, 'Probe-After');",
    "        Assert.areEqual('Probe-After', after.Name);",
    "        Assert.areEqual('created', after.Description);",
    '    }',
    '}'
  ].join('\n'));
  writeFileSync(join(cls, 'RepPatternProbeTest.cls-meta.xml'), meta);
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

function writeReport(p) {
  mkdirSync(EVID, { recursive: true });
  writeFileSync(join(EVID, 'probe.json'), JSON.stringify(p, null, 2) + '\n');
  const verdictKo = {
    'no-impact': '영향 없음 — 대표 패턴 통과', impact: '⚠ 영향 감지 — 테스트 결과가 갈렸다',
    unmapped: 'Settings 매핑 없음 — Setup UI 경로 필요', 'not-in-org': 'org 에 이 항목이 없다'
  }[p.verdict];
  const rows = p.apexProbe
    ? `<tr><td>대표 패턴 스위트 (DML+SOQL)</td><td>${p.apexProbe.before.outcome} ${p.apexProbe.before.passing}/${p.apexProbe.before.ran}</td><td>${p.apexProbe.after.outcome} ${p.apexProbe.after.passing}/${p.apexProbe.after.ran}</td></tr>`
    : '';
  writeFileSync(join(EVID, 'report.html'), `<meta charset="utf-8">
<title>RU 실측 — ${esc(p.target)}</title>
<style>
 body{font-family:-apple-system,'Apple SD Gothic Neo',sans-serif;max-width:960px;margin:24px auto;padding:0 20px;color:#16325c;line-height:1.5}
 h1{font-size:23px} .v{display:inline-block;padding:4px 14px;border-radius:16px;font-weight:800;margin:6px 0}
 .ok{background:#e6f5ec;color:#2e844a} .bad{background:#fdeeee;color:#ba0517} .warn{background:#fff4e5;color:#a86403}
 .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:14px 0}
 .col{border:1px solid #d8dde6;border-radius:10px;padding:12px 16px} .big{font-size:21px;font-weight:800}
 table{border-collapse:collapse;width:100%;font-size:14px;margin:10px 0} td,th{border:1px solid #d8dde6;padding:6px 10px;text-align:left} th{background:#f4f6fb}
 .muted{color:#5c6b8a;font-size:13px}
</style>
<h1>Release Update 실측 — ${esc(p.title || p.target)}</h1>
<p class="muted"><code>${esc(p.target)}</code> · ${esc(p.ranAt)} · 일회용 scratch org · 사람 클릭 0회 · 총 ${p.totalSec}초</p>
<div class="v ${p.verdict === 'impact' ? 'bad' : p.verdict === 'no-impact' ? 'ok' : 'warn'}">${verdictKo}</div>
${p.statusTransition ? `<div class="grid">
 <div class="col"><b>BEFORE</b><div class="big">${esc(p.statusTransition.before)}</div><div class="muted">적용 전</div></div>
 <div class="col"><b>AFTER</b><div class="big">${esc(p.statusTransition.after)}</div><div class="muted">${esc(p.enablePath || '')}</div></div>
</div>` : ''}
${rows ? `<table><tr><th></th><th>BEFORE</th><th>AFTER</th></tr>${rows}</table>` : ''}
<table>
 <tr><th>항목 정보</th><td>${esc(p.detail || '-')}</td></tr>
 <tr><th>강제 시점</th><td>${esc(p.dueDate || '미정')} ${p.releaseLabel ? '(' + esc(p.releaseLabel) + ')' : ''}</td></tr>
 <tr><th>되돌리기</th><td>${p.supportsRevoke ? '가능' : '불가'}</td></tr>
 <tr><th>Settings 매핑</th><td>${p.mapping ? `<code>${esc(p.mapping.field)}</code> (${esc(p.mapping.file)})` : '없음 — Setup UI 경로 필요'}</td></tr>
</table>
<p class="muted">한계: scratch 는 빈 org 다 — 대표 패턴 실측이지 고객 org 보증이 아니다. 적용 여부의 정본은 Tooling Status (Setup 목록 진행률은 스텝 카운트 기준).</p>
`);
}

// ── 실행 ───────────────────────────────────────────────
console.log(`■ Release Update 실측: ${TARGET}`);
const probe = { target: TARGET, ranAt: new Date(Date.now() + 9 * 3600e3).toISOString().replace('T', ' ').slice(0, 16) + ' KST', org: `scratch (${DEVHUB || 'default'} DevHub, disposable)` };
let t = Date.now();
sf(['org', 'create', 'scratch', '--edition', 'developer', '--alias', ALIAS, '--duration-days', '1', '--wait', '15', ...(DEVHUB ? ['-v', DEVHUB] : [])], { timeout: 900000 });
step('scratch 생성', t);

let prj = null;
try {
  const target = queryRUs(ALIAS).find(r => r.DeveloperName === TARGET);
  if (!target) {
    probe.verdict = 'not-in-org';
    probe.totalSec = secs(t0);
    writeReport(probe);
    console.log(`  org 에 없음 — 문서에만 있고 아직 안 온 변경일 수 있다 (그 자체가 검증 결과)`);
  } else {
    Object.assign(probe, {
      title: target.Title, detail: target.Category || '', dueDate: target.DueDate,
      releaseLabel: target.ReleaseLabel, supportsRevoke: !!target.SupportsRevoke
    });
    step(`대상 확인: ${target.Title} · Status ${target.Status}`);

    prj = mkdtempSync(join(tmpdir(), 'ru-probe-'));
    writeFileSync(join(prj, 'sfdx-project.json'), JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }], sourceApiVersion: '67.0', name: 'ru-probe' }, null, 2));
    mkdirSync(join(prj, 'force-app/main/default'), { recursive: true });
    t = Date.now();
    execFileSync('sf', ['project', 'retrieve', 'start', '-m', 'Settings:*', '-o', ALIAS, '--json'], { cwd: prj, encoding: 'utf8', stdio: ['ignore', 'ignore', 'ignore'], timeout: 300000 });
    const settingsDir = join(prj, 'force-app/main/default/settings');
    const mapping = findMapping(settingsDir, TARGET);
    step(`Settings 매핑 탐색: ${mapping ? mapping.field + ' = ' + mapping.value : '없음'}`, t);
    probe.mapping = mapping ? { file: mapping.file, field: mapping.field } : null;

    if (!mapping) {
      probe.verdict = 'unmapped';
      probe.statusTransition = { before: target.Status, after: target.Status };
    } else {
      t = Date.now();
      writeApexProbe(prj);
      execFileSync('sf', ['project', 'deploy', 'start', '-d', 'force-app/main/default/classes', '-o', ALIAS, '--json'], { cwd: prj, encoding: 'utf8', stdio: ['ignore', 'ignore', 'ignore'], timeout: 300000 });
      const before = runTests(ALIAS);
      step(`Apex 프로브 배포 + BEFORE: ${before.outcome} ${before.passing}/${before.ran}`, t);

      t = Date.now();
      const sPath = join(settingsDir, mapping.file);
      writeFileSync(sPath, readFileSync(sPath, 'utf8').replace(`<${mapping.field}>${mapping.value}</${mapping.field}>`, `<${mapping.field}>true</${mapping.field}>`));
      execFileSync('sf', ['project', 'deploy', 'start', '-m', 'Settings:' + mapping.file.replace('.settings-meta.xml', ''), '-o', ALIAS, '--json'], { cwd: prj, encoding: 'utf8', stdio: ['ignore', 'ignore', 'ignore'], timeout: 300000 });
      const after = queryRUs(ALIAS).find(r => r.DeveloperName === TARGET);
      step(`활성화 배포: Status ${target.Status} → ${after.Status}`, t);
      probe.statusTransition = { before: target.Status, after: after.Status };
      probe.enablePath = `${mapping.field} true 배포`;

      t = Date.now();
      const afterTests = runTests(ALIAS);
      step(`AFTER: ${afterTests.outcome} ${afterTests.passing}/${afterTests.ran}`, t);
      probe.apexProbe = { before, after: afterTests };
      probe.verdict = (before.outcome === afterTests.outcome && before.passing === afterTests.passing) ? 'no-impact' : 'impact';
    }
    probe.totalSec = secs(t0);
    writeReport(probe);
  }
} finally {
  if (prj) rmSync(prj, { recursive: true, force: true });
  if (!KEEP) {
    try { sf(['org', 'delete', 'scratch', '-o', ALIAS, '--no-prompt']); step('scratch 삭제'); }
    catch { console.error('  scratch 삭제 실패 — sf org delete scratch -o ' + ALIAS + ' 로 직접 삭제하세요'); }
  }
}
console.log(`\n판정: ${probe.verdict} · 총 ${probe.totalSec}초`);
console.log(`증거: content/org-evidence/${slug}/ (report.html · probe.json)`);
