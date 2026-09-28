/**
 * 권한 표면 감시 — 화면에 안 그려지는 기능까지 관측한다 (2026-08-12)
 *
 *   node bin/fetch-permission-surfaces.mjs [--org-license <alias>] [--org-customer <alias>] [--org-dev <alias>] [--skip-customer] [--no-lookup]
 *     → content/permission-surfaces.json            org 별 사용자 권한 목록 스냅샷 (커밋)
 *     → out/pending-changes.json                    변화가 있으면 카드 후보로 누적
 *     → content/org-evidence/permission-pending-arrival/pending.json   미도착 목록
 *
 * 왜 UI 표면만으로는 부족한가 (실측 2026-08-12). `fetch-ui-surfaces.mjs` 는 **렌더된
 * 컨트롤**을 diff 한다. 그런데 사용자 권한으로 잠긴 기능은 세 트랙 어느 org 에서도
 * 안 그려진다 — 그 org 의 프로브 유저가 권한을 갖고 있지 않기 때문이다.
 * Agentforce Grid 가 그랬다: `Analyze with Grid` 버튼은 Account 의 List View Button
 * Layout 에 이미 들어 있는데, `PermissionsAIWorkbenchUser` 가 없으면 렌더 자체가 안 돼
 * 6면 전부 "변화 0"이었다. 화면은 못 봐도 **권한 필드의 존재**는 describe 에 뜬다.
 *
 * 세 상태를 가른다 (이 셋이 곧 카드 판정 재료다):
 *   ① 필드 없음                 = 아직 이 org 에 안 온 기능
 *   ② 필드 있음 + 유효 false    = 도착했지만 잠김 (게이트 후보 — 무엇이 있어야 열리나가 질문)
 *   ③ 필드 있음 + 유효 true     = 지금 쓸 수 있음
 *
 * 새 권한에는 역추적을 붙인다 — 그 권한을 주는 PermissionSet 과 그 세트의 라이선스를
 * 찾아 큐에 실어 보낸다. 루브릭의 "라이선스 명시 의무" 3종 중 ①SKU·②권한 세트가
 * 이 단계에서 채워진다 (셋 중 하나라도 미확인이면 발송하지 않는다).
 *
 * Chrome 을 쓰지 않는다. describe + SOQL 뿐이라 수 초에 끝나고 org 에 어떤 쓰기도 하지
 * 않는다. scratch 도 만들지 않는다 — 일일 한도를 UI 표면 감시 쪽에 남겨둔다.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergePending } from './lib/pending.mjs';
import { readJson, writeJson } from './lib/io.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = process.env.NEWSCARD_CONTENT_DIR ? resolve(process.env.NEWSCARD_CONTENT_DIR) : resolve(ROOT, 'content');
const OUT = process.env.NEWSCARD_OUT_DIR ? resolve(process.env.NEWSCARD_OUT_DIR) : resolve(ROOT, 'out');
const SNAP = resolve(CONTENT, 'permission-surfaces.json');
const PENDING = resolve(OUT, 'pending-changes.json');

const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);

// 트랙 셋은 UI 표면 감시와 같은 축이다 — 다만 scratch 대신 소 dev org 를 쓴다.
// scratch 는 매일 새로 만들어야 하는데 권한 목록은 에디션이 같으면 매일 같아서
// 한도를 태울 값어치가 없다. 소 dev org 는 고정이라 diff 기준선으로 더 낫다.
// 2026-08-11 교훈: org 2개로 "라이선스 게이트"라 단정하지 않는다 — 소 dev 를 하나 더 댄다.
const ALL_TRACKS = [
  { key: 'license', org: flag('--org-license', process.env.SF_TARGET_ORG || null), note: '라이선스 트랙 (게이트 기능이 보이는 org)' },
  { key: 'customer', org: flag('--org-customer', process.env.SF_CUSTOMER_ORG || null), note: '고객 org 급 기준선 (도착 여부 판정용)' },
  { key: 'dev', org: flag('--org-dev', process.env.SF_DEV_ORG || null), note: '소 Developer Edition (에디션 최소선)' }
];
// org 가 지정되지 않은 트랙은 건너뛴다 (기본값: SF_TARGET_ORG · SF_CUSTOMER_ORG · SF_DEV_ORG).
const TRACKS = ALL_TRACKS.filter(t => t.org && !args.includes(`--skip-${t.key}`));

const NO_LOOKUP = args.includes('--no-lookup');
// 역추적은 신규 권한 1건당 SOQL 2~3회다. 버스트 날 큐가 폭발하지 않게 상한을 두되,
// 잘린 사실을 반드시 로그로 남긴다 (루틴 원칙: 조용한 truncation 금지).
const LOOKUP_CAP = Number(flag('--lookup-cap', '12'));

function sf(cmdArgs, opts = {}) {
  const out = execFileSync('sf', [...cmdArgs, '--json'], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    timeout: opts.timeout || 180000, stdio: ['ignore', 'pipe', 'ignore']
  });
  const j = JSON.parse(out);
  if (j.status !== 0 && !opts.lenient) throw new Error(`sf ${cmdArgs.slice(0, 2).join(' ')} 실패: ${(j.message || '').slice(0, 160)}`);
  return j.result;
}

/** org 에 존재하는 사용자 권한 = describe 의 Permissions* 필드. 라벨도 같이 받는다
 *  (권한 API 명은 영어라 언어 무관이지만, 라벨은 카드 문구에 쓸 한국어가 나온다). */
function collectPermissions(org) {
  const d = sf(['sobject', 'describe', '-s', 'UserPermissionAccess', '-o', org]);
  const out = {};
  for (const f of d.fields || []) {
    if (f.name.startsWith('Permissions')) out[f.name] = f.label || f.name;
  }
  return out;
}

/** 유효 권한 — "이 org 의 프로브 유저가 지금 쓸 수 있나". 필드가 많아 조각내 묻는다
 *  (SOQL 문자열 길이 상한에 걸리면 전량이 실패한다). */
function effectivePermissions(org, names) {
  const result = {};
  for (let i = 0; i < names.length; i += 80) {
    const chunk = names.slice(i, i + 80);
    try {
      const q = sf(['data', 'query', '-o', org, '-q', `SELECT ${chunk.join(', ')} FROM UserPermissionAccess`], { lenient: true });
      const rec = q && q.records && q.records[0];
      if (rec) for (const n of chunk) result[n] = rec[n] === true;
    } catch {
      // 유효 권한을 못 읽어도 존재 여부(describe)는 이미 확보했다 — 그 사실만 비운다
    }
  }
  return result;
}

/**
 * 이 권한을 주는 권한 세트와 그 세트의 라이선스를 찾는다.
 * LicenseId 는 polymorphic (PermissionSetLicense | UserLicense) 이라 둘 다 조회한다.
 * 실측 2026-08-12: Agentforce Grid 의 유일한 권한 세트는 LicenseId 가
 * PermissionSetLicense 가 아니라 UserLicense(Cloud Integration User)였고,
 * 그래서 사람 유저에게 할당하면 FIELD_INTEGRITY_EXCEPTION 이 난다 — 관리자가
 * 셀프로 못 켜는 기능이라는 뜻이고, 카드에 반드시 들어가야 할 사실이다.
 */
function lookupGrantors(org, perm) {
  const sets = [];
  try {
    const q = sf(['data', 'query', '-o', org, '-q',
      `SELECT Id, Name, Label, LicenseId, IsOwnedByProfile FROM PermissionSet WHERE ${perm} = true LIMIT 10`], { lenient: true });
    for (const r of (q && q.records) || []) {
      sets.push({ name: r.Name, label: r.Label, licenseId: r.LicenseId, ownedByProfile: r.IsOwnedByProfile });
    }
  } catch { return { sets: [], licenses: [] }; }

  const ids = [...new Set(sets.map(s => s.licenseId).filter(Boolean))];
  const licenses = [];
  for (const [obj, field] of [['PermissionSetLicense', 'MasterLabel'], ['UserLicense', 'MasterLabel']]) {
    if (!ids.length) break;
    try {
      const q = sf(['data', 'query', '-o', org, '-q',
        `SELECT Id, ${field} FROM ${obj} WHERE Id IN ('${ids.join("','")}')`], { lenient: true });
      for (const r of (q && q.records) || []) licenses.push({ id: r.Id, kind: obj, name: r[field] });
    } catch { /* 한쪽 타입에 없으면 다른 쪽이 답이다 */ }
  }
  return { sets, licenses };
}

/** 권한 세트가 사람에게 할당 가능한가 — UserLicense 로 묶인 세트는 내부 서비스용이라
 *  관리자가 못 켠다. 이 판정이 "관리자 조치 가능"과 "Salesforce 프로비저닝 대기"를 가른다. */
function assignabilityNote(licenses) {
  if (!licenses.length) return '라이선스 제약 없음 (일반 권한 세트로 부여 가능)';
  const kinds = [...new Set(licenses.map(l => l.kind))];
  if (kinds.includes('UserLicense') && !kinds.includes('PermissionSetLicense')) {
    return '사람 유저에게 직접 할당 불가 — 해당 UserLicense 를 가진 유저만 (관리자 셀프 활성화 불가)';
  }
  return `PermissionSetLicense 필요: ${licenses.filter(l => l.kind === 'PermissionSetLicense').map(l => l.name).join(', ')}`;
}

/**
 * --explain <키워드> — 후보 하나를 org 별로 진단한다. 아무것도 쓰지 않는다.
 *
 * 감지(매일 diff)와 진단(필요할 때)은 성격이 다르다. 역추적을 신규 권한 루프 안에만
 * 두면 **이미 스냅샷에 있는 권한은 영영 진단할 수 없다** — 2026-08-12 실측: Agentforce
 * Grid 는 diff 가 아니라 사용자 제보로 왔고, 그 권한은 이미 기준선에 있어서 added 에
 * 안 잡혔다. 그래서 그날 진단을 전부 손으로 SOQL 두드려 했다. 후보가 어느 레인에서
 * 오든(제보·블로그·릴리스 노트) 같은 답을 뽑을 수 있어야 한다.
 *
 * **트랙마다 라벨 언어가 다르다 (2026-09-16 실측).** Organization.LanguageLocaleKey 가
 * 라이선스 트랙 org 는 `ko`, 고객·dev 트랙 org 는 `en_US` 였다. 그래서 라벨 부분 문자열로만
 * 찾으면 같은 권한이 트랙에 따라 걸리고 안 걸린다 — 실측: `--explain "Send Email"` 은
 * license 트랙을 **"해당 권한 없음 — 아직 안 온 기능"** 으로 찍었는데, `"이메일 전송"` 으로
 * 던지니 ③ 사용 가능이었다(둘 다 PermissionsEmailSingle). 언어 미스매치를 **미도착으로
 * 오보**한 것이고, 그 판정은 후보를 접점 탈락시킨다.
 *
 * 그래서 두 단계로 찾는다: ① 트랙별 키워드 매칭 → ② 거기서 나온 **API 명의 합집합**으로
 * 전 트랙을 다시 조회한다. API 명은 언어를 안 타므로 교차 조회가 항상 성립한다.
 * 키워드로는 안 걸렸는데 API 명으로 있으면 그 사실(`라벨 언어 차이`)을 같이 찍는다.
 */
function explain(keyword) {
  const needle = keyword.toLowerCase();
  console.log(`■ 권한 진단 — "${keyword}" (조회 전용 · 스냅샷·큐 안 건드림)\n`);

  // ① 트랙별 수집 + 키워드 매칭
  const loaded = [];
  for (const t of TRACKS) {
    try {
      loaded.push({ t, perms: collectPermissions(t.org) });
    } catch (e) {
      console.log(`  ${t.key} (${t.org}): 조회 실패 — ${String(e.message).slice(0, 100)}\n`);
    }
  }
  const matched = new Map();   // track.key → Set(API 명)
  for (const { t, perms } of loaded) {
    matched.set(t.key, new Set(Object.keys(perms).filter(p =>
      p.toLowerCase().includes(needle) || (perms[p] || '').toLowerCase().includes(needle))));
  }

  // ② API 명 합집합 — 라벨 언어가 다른 트랙은 여기서 구제된다
  const targets = [...new Set(loaded.flatMap(({ t }) => [...matched.get(t.key)]))].sort().slice(0, 5);
  if (!targets.length) {
    console.log('  어느 트랙에도 없다. 키워드를 줄이거나(예: Workbench) 라벨 일부로 다시 시도한다.');
    console.log('  라벨은 트랙마다 언어가 다르다 — 기능명이 0건이면 **API 명 조각**으로 던지는 것이 가장 확실하다.');
    process.exit(0);
  }

  for (const { t, perms } of loaded) {
    const here = targets.filter(p => p in perms);
    if (!here.length) {
      // 라벨이 아니라 필드 자체가 없다 — 이때만 미도착이다
      console.log(`  ${t.key} (${t.org}): 해당 권한 없음 — 이 org 에는 아직 안 온 기능\n`);
      continue;
    }
    const viaApiOnly = here.filter(p => !matched.get(t.key).has(p));
    console.log(`  ${t.key} (${t.org})`);
    if (viaApiOnly.length) {
      console.log(`    ⓘ 키워드로는 안 걸렸고 API 명 교차 조회로 찾았다 (라벨 언어 차이): ${viaApiOnly.join(', ')}`);
    }
    const eff = effectivePermissions(t.org, here);
    for (const p of here) {
      const usable = eff[p] === true;
      console.log(`    ${p} (${perms[p]})`);
      console.log(`      상태: ${usable ? '③ 사용 가능' : '② 도착했지만 잠김'}`);
      if (NO_LOOKUP) { console.log(''); continue; }
      const g = lookupGrantors(t.org, p);
      if (!g.sets.length) {
        console.log(`      권한 세트: 없음 — 이 org 에서 이 권한을 주는 세트가 하나도 없다`);
      } else {
        for (const s of g.sets) console.log(`      권한 세트: ${s.name}${s.ownedByProfile ? ' (프로필 소유)' : ''}`);
        console.log(`      라이선스: ${g.licenses.length ? g.licenses.map(l => `${l.name} [${l.kind}]`).join(', ') : '연결 없음'}`);
        console.log(`      ⚑ ${assignabilityNote(g.licenses)}`);
      }
      console.log('');
    }
  }
  process.exit(0);
}

// ── 실행 ───────────────────────────────────────────────
if (args.includes('--explain')) explain(flag('--explain', ''));

console.log(`■ 권한 표면 감시 — ${TRACKS.length}트랙 (조회 전용 · Chrome 불필요)`);

const prev = readJson(SNAP, null) || { tracks: {} };
const prevTracks = prev.tracks || {};
const tracks = {};
const fresh = {};      // 이번 실행에서 실제로 수집한 트랙만 — 미도착 판별의 재료
let exitCode = 0;
let totalChanges = 0;

for (const t of TRACKS) {
  let perms;
  try {
    perms = collectPermissions(t.org);
  } catch (e) {
    // 한 트랙이 죽어도 나머지는 돈다 — 스냅샷은 직전 값을 보존한다
    // (수집 실패 ≠ 권한이 사라짐. UI 표면 감시의 실패 표면 처리와 같은 원칙).
    console.error(`  ${t.key} (${t.org}): 수집 실패 — ${String(e.message).slice(0, 120)}`);
    if (prevTracks[t.key]) tracks[t.key] = prevTracks[t.key];
    exitCode = 3;
    continue;
  }

  const names = Object.keys(perms).sort();
  const before = prevTracks[t.key] ? Object.keys(prevTracks[t.key].permissions || {}) : null;
  console.log(`  ${t.key}: ${t.org} — 권한 ${names.length}개`);

  tracks[t.key] = { org: t.org, note: t.note, count: names.length, permissions: perms };
  fresh[t.key] = tracks[t.key];

  if (!before) { console.log(`  = ${t.key}: 첫 스냅샷 (기준선)`); continue; }

  const prevSet = new Set(before);
  const curSet = new Set(names);
  const added = names.filter(n => !prevSet.has(n));
  const removed = before.filter(n => !curSet.has(n));

  // 개명 감시 (2026-09-13 신설). 라벨은 처음부터 스냅샷에 담겼는데
  // diff 가 **키 집합만** 봐서 "같은 권한, 다른 이름"이 안 보였다. Salesforce 는 표시
  // 이름을 조용히 바꾸고 실무자는 옛 이름으로 기억한다 — 추가 조회 없이 공짜로 잡힌다.
  const prevPerms = (prevTracks[t.key] || {}).permissions || {};
  const renamed = names
    .filter(n => prevSet.has(n) && prevPerms[n] && prevPerms[n] !== perms[n])
    .map(n => ({ permission: n, from: prevPerms[n], to: perms[n] }));

  // 대량 개명은 개명이 아니라 조회 유저의 언어·로캘 변경이다 (전부 한꺼번에 달라진다).
  const massRename = renamed.length > names.length * 0.2;
  if (massRename) {
    console.log(`  ⚠ ${t.key}: 라벨 변경 ${renamed.length}/${names.length}건 — 20% 초과라 **org 유저 언어·로캘 변경**을 의심한다.`);
    console.log('       개별 개명으로 보고하지 않는다. Language 확인 후 의도된 변경이면 스냅샷을 재기준화한다.');
  } else if (renamed.length) {
    console.log(`  ✎ ${t.key}: 권한 라벨 변경 ${renamed.length}건`);
    for (const r of renamed.slice(0, 12)) console.log(`       ${r.permission}: "${r.from}" → "${r.to}"`);
    if (renamed.length > 12) console.log(`       … 외 ${renamed.length - 12}건`);
  }

  if (!added.length && !removed.length && !renamed.length) continue;
  if (renamed.length && !massRename) totalChanges += 1;
  if (!added.length && !removed.length) continue;

  totalChanges += 1;
  console.log(`  ! ${t.key}: +${added.length} / -${removed.length}`);

  // 신규 권한만 유효 여부를 묻는다 — 매일 1,300개를 다 묻는 건 낭비다
  const eff = added.length ? effectivePermissions(t.org, added) : {};
  if (added.length > LOOKUP_CAP) {
    console.log(`      (역추적 상한 ${LOOKUP_CAP}건 — 신규 ${added.length}건 중 나머지는 다음 실행에서 본다)`);
  }

  const entries = [];
  for (const [i, perm] of added.entries()) {
    const grant = (!NO_LOOKUP && i < LOOKUP_CAP) ? lookupGrantors(t.org, perm) : { sets: [], licenses: [] };
    const state = eff[perm] === true ? '사용 가능' : '도착했지만 잠김';
    console.log(`      + ${perm} (${perms[perm]}) — ${state}`);
    if (grant.licenses.length) console.log(`         ⚑ ${assignabilityNote(grant.licenses)}`);
    entries.push({
      key: `${t.key}-${perm.replace(/^Permissions/, '').toLowerCase()}`,
      source: 'permission-surfaces', type: 'added',
      data: {
        permission: perm, label: perms[perm], track: t.key, org: t.org,
        effective: eff[perm] === true, state,
        grantedBy: grant.sets, licenses: grant.licenses,
        assignability: grant.licenses.length ? assignabilityNote(grant.licenses) : null
      }
    });
  }
  for (const perm of removed) console.log(`      - ${perm}`);

  if (entries.length) {
    const q = mergePending(PENDING, entries);
    if (q.added) console.log(`      대기 큐 +${q.added} (총 ${q.total})`);
  }
}

// 미도착 목록 — 라이선스 org 에는 있고 고객 org 급에는 아직 없는 권한.
// UI 표면 감시의 ui-pending-arrival 과 같은 축이다: **도착하는 날이 카드 후보**다.
// 되살린 옛 스냅샷으로 판별하면 "어제 없던 게 오늘 도착"을 오늘 값과 어제 값의
// 차이로 착각한다 — 이번 실행에서 실제로 수집한 트랙(fresh)만 쓴다.
if (fresh.license && fresh.customer) {
  const cust = new Set(Object.keys(fresh.customer.permissions));
  const dev = fresh.dev ? new Set(Object.keys(fresh.dev.permissions)) : null;
  const items = Object.keys(fresh.license.permissions)
    .filter(p => !cust.has(p))
    .map(p => ({
      permission: p, label: fresh.license.permissions[p],
      // 소 dev org 에도 있으면 라이선스가 아니라 org 종류·롤아웃 차이다
      // (2026-08-11 Grid 오판의 교훈 — org 2개로 단정하지 않는다)
      alsoInPlainDev: dev ? dev.has(p) : null
    }));
  const gated = items.filter(i => i.alsoInPlainDev === false).length;
  console.log(`\n  미도착 판별: ${items.length}개 — ${fresh.license.org} 에는 있고 ${fresh.customer.org} 에는 없다`);
  console.log(`     그중 소 dev org 에도 없는 것 ${gated}개 (라이선스 게이트 가능성 높음)`);
  items.slice(0, 8).forEach(i => console.log(`     · ${i.permission} (${i.label})${i.alsoInPlainDev ? ' — 소 dev 에도 있음' : ''}`));

  const evid = resolve(CONTENT, 'org-evidence', 'permission-pending-arrival');
  mkdirSync(evid, { recursive: true });
  writeFileSync(resolve(evid, 'pending.json'), JSON.stringify({
    note: '라이선스 org 에는 있고 고객 org 급에는 아직 없는 사용자 권한. 도착하는 날이 카드 후보다. alsoInPlainDev=false 면 라이선스 게이트일 가능성이 높다.',
    licenseOrg: fresh.license.org, customerOrg: fresh.customer.org,
    devOrg: fresh.dev ? fresh.dev.org : null, items
  }, null, 2) + '\n');
}

// --skip-* 로 건너뛴 트랙은 직전 스냅샷을 그대로 살린다. 안 그러면 다음 실행이
// 그 트랙을 "첫 스냅샷"으로 리셋해 그 사이의 변화를 영영 못 본다 (2026-08-12 실측:
// --skip-customer --skip-dev 로 한 번 돌렸더니 두 트랙이 스냅샷에서 사라졌다).
for (const t of ALL_TRACKS) {
  if (!tracks[t.key] && prevTracks[t.key]) tracks[t.key] = prevTracks[t.key];
}

writeJson(SNAP, {
  note: 'org 별 사용자 권한(Permissions*) 목록 — 화면에 안 그려지는 잠긴 기능까지 잡는 표면. 트랙 차집합이 도착 여부 판별기다.',
  tracks
});
const summary = Object.entries(tracks).map(([k, v]) => `${k} ${v.count}개`).join(' · ');
console.log(`\ncontent/permission-surfaces.json (${summary} · 변화 ${totalChanges}트랙)`);
process.exit(exitCode);
