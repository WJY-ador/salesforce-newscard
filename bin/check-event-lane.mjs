#!/usr/bin/env node
/**
 * 연례 행사 레인 감지기 — 오늘 이벤트 카드를 만들 날인지 기계적으로 판정한다 (2026-09-18 신설).
 *
 *   node bin/check-event-lane.mjs [--notify] [--json]
 *   → out/event-lane-status.json · exit 0 = 활성 · exit 1 = 비활성(오늘 할 일 없음)
 *
 * 왜 이게 필요한가: Dreamforce 는 1년에 한 번이고 사흘이면 끝난다. 그 사흘을 사람이 기억해
 * 세션을 열어야 한다면 매년 놓친다 — 실제로 2026 회차는 행사가 끝난 뒤에야 손으로 시작했다.
 * 날짜 판정만이라도 기계가 하면 "오늘 DAY 2 창이 닫혔고 재료 11건 있다"가 아침에 슬랙에 뜬다.
 *
 * ── 어디까지 무인인가 (글로벌 원칙: 구독 CLI 무인 실행은 기계적 작업만) ──────────────
 *   무인 O  날짜 판정 · 창 계산 · 재료 수집·집계 · 슬랙 알림     ← 이 스크립트
 *   무인 X  초안 문장 작성 · 카드 생성 · 교정 · 발송              ← 세션에서 사람과
 * 판별·큐레이션이 무인으로 넘어가면 틀린 카드가 사람 눈을 거치지 않고 공개 계정에 올라간다.
 * 이 스크립트는 "재료가 여기 있다"까지만 말하고 멈춘다.
 *
 * ── 창(window) 정의 ────────────────────────────────────────────────────────
 * 피드 날짜 = 수집한 날. 내용 = 그 전날 UTC 00:00~24:00 게시분.
 * 행사가 PDT 로 도는데 우리는 KST 아침에 모으므로, 아침 수집은 늘 "지난 UTC 하루"를 덮는다.
 * 이 정의를 쓰는 이유: "행사 N 일차에 무슨 일이 있었나"로 묶으면 어느 소스도 그렇게 분류해
 * 주지 않아 보류가 난다(2025 회차에서 Day 2 가 통째로 비었다). 게시일로 묶으면 매일 찬다.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const NOTIFY = args.includes('--notify');
const AS_JSON = args.includes('--json');

// 연례 행사 등록부. key 는 content/events.json 의 key 와 맞춘다.
// days 는 행사 길이(일). lookaheadDays 는 개막 전 INTRO 카드를 띄울 시점이다.
const ANNUAL = {
  dreamforce: { label: "Dreamforce", days: 3, lookaheadDays: 2, palette: 'dreamforce-26', tz: 'America/Los_Angeles' }
};

const kstNow = () => new Date(Date.now() + 9 * 3600e3);
const ymd = d => d.toISOString().slice(0, 10);

function loadEvents() {
  const p = resolve(ROOT, 'content/events.json');
  if (!existsSync(p)) return [];
  try { return JSON.parse(readFileSync(p, 'utf8')).events || []; } catch (_) { return []; }
}

// 행사 기간 안에서 오늘이 무엇을 정리할 날인지. 아침 수집은 늘 "어제 게시분"을 덮으므로
// 개막 다음 날 아침이 DAY 1 이다.
function phaseOf(startISO, days, lookaheadDays) {
  const start = new Date(startISO);
  const today = new Date(ymd(kstNow()) + 'T00:00:00+09:00');
  const diff = Math.round((today - start) / 86400e3);
  if (diff < -lookaheadDays) return null;                       // 아직 멀었다
  if (diff <= 0) return { phase: 'pre', key: 'pre', label: 'INTRO' };
  // 덮는 창은 행사 시작일에서 세는 게 아니라 **어제 UTC 하루**다. 아침 수집이 늘 그렇기 때문이고,
  // startISO 가 KST 자정(=UTC 전날 15:00)이라 시작일 기준으로 더하면 하루가 당겨진다(실측).
  if (diff <= days) return { phase: 'day', key: `day${diff}`, label: `DAY ${diff}`,
                             coversUTC: ymd(new Date(Date.now() - 86400e3)) };
  return null;                                                  // 끝났다
}

// 재료 집계 — 이미 수집된 스냅샷만 읽는다. 여기서 새로 크롤하지 않는다(수집기는 따로 돈다).
function countMaterial(utcDay, label) {
  const out = { sfben: [], newsroom: [] };
  try {
    const d = JSON.parse(readFileSync(resolve(ROOT, 'content/sfben.json'), 'utf8'));
    const list = Array.isArray(d.items) ? d.items : Object.values(d.items || {}).flat();
    out.sfben = list.filter(a => a.date === utcDay && /dreamforce/i.test(a.title + ' ' + (a.categories || '')))
                    .map(a => ({ title: a.title, url: a.url }));
  } catch (_) {}
  try {
    const x = execFileSync('curl', ['-sL', '--max-time', '20', '-A',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0 Safari/537.36',
      'https://www.salesforce.com/news/feed/'], { encoding: 'utf8', maxBuffer: 8e6 });
    for (const m of x.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const g = t => { const r = m[1].match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)); return r ? r[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : ''; };
      const iso = new Date(g('pubDate')).toISOString();
      if (iso.slice(0, 10) === utcDay) out.newsroom.push({ title: g('title'), url: g('link'), at: iso.slice(0, 16) });
    }
  } catch (_) {}
  return out;
}

const events = loadEvents();
const hits = [];
for (const [key, cfg] of Object.entries(ANNUAL)) {
  const ev = events.find(e => e.key === key);
  if (!ev || !ev.startISO) continue;
  const ph = phaseOf(ev.startISO, cfg.days, cfg.lookaheadDays);
  if (!ph) continue;
  const material = ph.coversUTC ? countMaterial(ph.coversUTC, cfg.label) : { sfben: [], newsroom: [] };
  hits.push({ key, label: cfg.label, palette: cfg.palette, startISO: ev.startISO, ...ph, material,
              total: material.sfben.length + material.newsroom.length });
}

const status = { checkedAt: kstNow().toISOString().slice(0, 16).replace('T', ' ') + ' KST', active: hits.length > 0, hits };
mkdirSync(resolve(ROOT, 'out'), { recursive: true });
writeFileSync(resolve(ROOT, 'out/event-lane-status.json'), JSON.stringify(status, null, 2) + '\n');

if (AS_JSON) console.log(JSON.stringify(status, null, 2));
else if (!status.active) console.log('— 오늘은 연례 행사 레인이 아닙니다.');
else for (const h of hits) {
  console.log(`● ${h.label} — ${h.label2 || h.key.toUpperCase()} · 창 ${h.coversUTC || '개막 전'} · 재료 ${h.total}건`);
  h.material.newsroom.forEach(a => console.log(`   사실 ${a.at}  ${a.title}`));
  h.material.sfben.forEach(a => console.log(`   반응              ${a.title}`));
}

// 슬랙 알림 — 사람을 부르는 것이 이 스크립트의 마지막 일이다. 카드를 만들지 않는다.
if (NOTIFY && status.active) {
  const tokFile = process.env.SLACK_TOKEN_FILE
    || resolve(process.env.HOME || '', '.config/sf-release/slack-token');
  const tok = readFileSync(tokFile, 'utf8').trim();
  // 공개본: 채널 ID 기본값을 두지 않는다.
  const ch = process.env.SLACK_CHANNEL;
  if (!ch) { console.error('SLACK_CHANNEL 이 없습니다 — --notify 에 필요합니다.'); process.exit(1); }
  for (const h of hits) {
    const lines = [
      `:calendar: *연례 행사 레인 열림* · ${h.label} — ${h.label} ${h.key.toUpperCase()}`,
      h.coversUTC ? `창 = UTC ${h.coversUTC} 게시분 · 재료 *${h.total}건* (사실 ${h.material.newsroom.length} · 반응 ${h.material.sfben.length})`
                  : `개막 전 — INTRO 카드를 만들 때입니다.`,
      ...h.material.newsroom.slice(0, 6).map(a => `· 사실 ${a.at} — <${a.url}|${a.title}>`),
      ...h.material.sfben.slice(0, 8).map(a => `· 반응 — <${a.url}|${a.title}>`),
      '',
      '_초안·생성·교정·발송은 세션에서 사람과 합니다 — 이 알림은 재료가 모였다는 신호까지입니다._'
    ].join('\n');
    execFileSync('curl', ['-s', '-X', 'POST', 'https://slack.com/api/chat.postMessage',
      '-H', `Authorization: Bearer ${tok}`, '-H', 'Content-Type: application/json; charset=utf-8',
      '-d', JSON.stringify({ channel: ch, text: lines, unfurl_links: false })], { encoding: 'utf8' });
    console.log(`  → 슬랙 알림 게시 (${h.key})`);
  }
}

process.exit(status.active ? 0 : 1);
