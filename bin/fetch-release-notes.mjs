/**
 * 공식 릴리스 노트 본문 수집
 *
 *   node bin/fetch-release-notes.mjs
 *   → content/release-notes.json
 *
 * help.salesforce.com은 Aura SPA라서 HTML 셸에 본문이 없다. WebFetch·curl·
 * curl_cffi 격자(17회) 모두 셸만 받는다. Chrome의 --dump-dom으로 JS를 실행시킨 뒤
 * 렌더된 DOM에서 What/Where/When/Why/How 블록을 뽑는다.
 *
 * 카드용 본문은 여기서 받아 content/에 캐시한다. 원문 인용이므로 지어낸 문장이 없다.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openBrowser, mapPool } from './lib/chrome.mjs';
import { decodeEntities } from './lib/text.mjs';
import { writeJson } from './lib/io.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = process.env.NEWSCARD_CONTENT_DIR ? resolve(process.env.NEWSCARD_CONTENT_DIR) : resolve(ROOT, 'content');
const OUT = process.env.NEWSCARD_OUT_DIR ? resolve(process.env.NEWSCARD_OUT_DIR) : resolve(ROOT, 'out');
const BASE = 'https://help.salesforce.com/s/articleView?language=en_US&type=5&id=release-notes.';

const NOTES = [
  'rn_automate_flow_release_update_sort_apex_batch_action_result_by_request_order',
  'rn_sra_scqa',
  'rn_fieldservice_262_agentforce_email',
  'rn_automate_flow_builder_use_complex_type_configurator_for_apex_inputs',
  'rn_automate_flow_builder_persist_email_template_references_across_environments',
  'rn_email_streamline_permissions_for_agentforce'
];

function toLines(dom) {
  const s = decodeEntities(dom
    .replace(/<(script|style|template|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|section)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' '));
  return s.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(l => l.length > 2);
}

// "You are here:" 브레드크럼 다음이 본문, "Did this article solve" 앞까지
function extract(lines) {
  let start = lines.findIndex(l => /^You are here:/i.test(l));
  if (start < 0) start = 0;
  // 브레드크럼(Salesforce Help / Docs / …)을 지나 제목 다음 줄부터
  let i = start + 1;
  while (i < lines.length && lines[i].length < 60 && !/^(With|When|Where|Why|How|Currently|In )/i.test(lines[i])) i++;
  let end = lines.findIndex((l, j) => j > i && /Did this article solve/i.test(l));
  if (end < 0) end = Math.min(lines.length, i + 40);

  const body = lines.slice(i, end);
  const field = re => {
    const hit = body.find(l => re.test(l));
    if (!hit) return null;
    const at = body.indexOf(hit);
    let txt = hit;
    // 다음 필드 라벨이 나오기 전까지 이어 붙인다 (줄바꿈으로 쪼개져 있다)
    for (let k = at + 1; k < body.length; k++) {
      if (/^(Where|When|Why|How|Who):/i.test(body[k])) break;
      txt += ' ' + body[k];
    }
    return txt.replace(/\s+/g, ' ').trim();
  };

  const lead = body.slice(0, body.findIndex(l => /^(Where|When|Why|How|Who):/i.test(l)) < 0
    ? body.length : body.findIndex(l => /^(Where|When|Why|How|Who):/i.test(l))).join(' ');

  return {
    lead: lead.replace(/\s+/g, ' ').trim(),
    where: field(/^Where:/i),
    when: field(/^When:/i),
    why: field(/^Why:/i),
    how: field(/^How:/i)
  };
}

const out = {};

const B = await openBrowser({ concurrency: 4 });
const doms = await mapPool(NOTES, 4, id => B.dumpDom(BASE + id + '.htm').catch(e => e));
await B.close();
for (const [i, id] of NOTES.entries()) {
  const url = BASE + id + '.htm';
  process.stdout.write(`${id} … `);
  try {
    if (doms[i] instanceof Error) throw doms[i];
    const lines = toLines(doms[i]);
    const title = (lines.find(l => /\| Salesforce Help$/.test(l)) || '')
      .replace(/\s*\|\s*Salesforce Help$/, '').trim();
    const f = extract(lines);
    out[id] = { id, url, title, ...f };
    const got = ['lead', 'where', 'when', 'why', 'how'].filter(k => f[k]);
    console.log(`ok — ${title.slice(0, 52)}  [${got.join(',')}]`);
  } catch (e) {
    out[id] = { id, url, error: String(e.message || e).slice(0, 120) };
    console.log('FAIL');
  }
}

writeJson(resolve(CONTENT, 'release-notes.json'), out);
console.log('\ncontent/release-notes.json');
