/**
 * 오늘 루틴을 어느 모델로 돌릴지 — 판단이 아니라 계산으로 (2026-09-11 신설)
 *
 * 왜 계산인가. "오늘은 어려운 날이니 큰 모델을 써야겠다"를 모델이 스스로 판단하게 하면
 * 안 된다 — **막힌 줄 모르는 것이 정확히 낮은 모델의 실패 양상**이다. 그래서 수집 결과와
 * 큐 상태에서 기계적으로 뽑는다. 모델은 결과를 읽기만 한다.
 *
 * 기본은 sonnet 이다. 2026-09-11 관찰: 이 루틴에서 모델이 실제로 일하는 구간은
 * ① 큐 판정 ② 교정 게이트(이미지 판독) ③ 이례 사건의 원인 규명 셋뿐이고, 나머지(수집·검증·
 * 발송·커밋)는 이미 스크립트다. ①③ 이 없는 조용한 날은 sonnet 으로 충분하다.
 *
 * 아래 신호가 하나라도 켜지면 opus 다. 전부 "규칙 대조로는 못 끝나고 판단이 필요한" 사건이다.
 *
 * 한계 — 이 계산이 못 잡는 것 (루틴 프롬프트가 따로 명시한다):
 *   - **사용자 제보·이의**. 2026-09-11 로그인 기본값 건이 그랬다. 사람이 말을 걸면 무조건 opus.
 *   - **교정 게이트**. 조용한 날에도 카드는 나가고 오타는 거기서 난다(실측: "태스트"는 1024폭
 *     전체 뷰에서 안 보였고 2배 확대에서 잡혔다). 이 구간이 모델에 가장 민감한데 신호로 못 가른다.
 *   - **폐기 `soon` 중 미발송**. 데둡 앵커가 kbId·developerName 인데 retirements 쪽 key 는
 *     manifest 파일명과 규칙이 달라(실측: `marketing-cloud-engagement-mce-user-domain` vs
 *     `mce-user-domain-retirement-full-card.png`) 문자열 대조가 오탐한다. 매일 opus 로 고정되면
 *     계산의 뜻이 없으므로 폐기는 **목록 변동(added/changed/removed)** 만 신호로 쓴다.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p, fallback) => {
  try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : fallback; }
  catch { return fallback; }   // 계산이 수집을 막지 않는다 — 손상이면 신호 없음으로 본다
};

/** 정정 판단을 요구하는 큐 항목인가 — 낸 카드가 무효화됐을 수 있다는 뜻이다 */
const isCorrection = (key, item) =>
  item.source === 'sent-drift' || item.type === 'removed' || item.type === 'changed';

/**
 * @param {{root: string, results?: object}} args
 *   root    레포 루트 절대 경로
 *   results collect-all 의 수집기별 결과 (없으면 수집 실패 신호를 건너뛴다)
 * @returns {{model: 'opus'|'sonnet', reasons: string[], counts: object}}
 */
export function assessEscalation({ root, results = null }) {
  const reasons = [];

  // ① 수집 실패 — 어느 소스를 이번 판단에서 뺄지, 재시도할지 결정해야 한다
  if (results) {
    const bad = Object.entries(results)
      .filter(([, r]) => /fail|timeout/.test(String(r.status)))
      .map(([n]) => n);
    if (bad.length) reasons.push(`수집 실패 ${bad.length}건 (${bad.join(', ')})`);
  }

  // ②~⑤ 큐 — verdict 없는 항목만 본다. hold 는 이미 판정이 끝났고,
  //        매일 다시 켜지면 opus 로 고정돼 계산의 뜻이 없어진다.
  const queue = read(resolve(root, 'out/pending-changes.json'), { items: {} });
  const entries = Object.entries(queue.items || {});
  const unjudged = entries.filter(([, v]) => !v.verdict);

  if (unjudged.length >= 3) reasons.push(`미판정 신규 ${unjudged.length}건`);

  const corrections = unjudged.filter(([k, v]) => isCorrection(k, v));
  if (corrections.length) reasons.push(`정정 판단 ${corrections.length}건 (낸 카드 무효화 여부)`);

  const meta = unjudged.filter(([, v]) => v.source === 'metadata-coverage');
  if (meta.length) reasons.push(`metadata 능력 신규 ${meta.length}건 (도시에 입장 판정)`);

  const alerts = unjudged.filter(([, v]) => v.source === 'help-alerts');
  if (alerts.length) reasons.push(`공지 배너 신규 ${alerts.length}건 (1차 원문 추적 필요)`);

  // ⑥ 폐기 목록 변동 — 행이 사라지면 철회다. soon 은 신호로 쓰지 않는다(위 한계 참조)
  const ret = read(resolve(root, 'content/retirement-changes.json'), {});
  const retMoved = (ret.added?.length || 0) + (ret.changed?.length || 0) + (ret.removed?.length || 0);
  if (retMoved) reasons.push(`폐기 목록 변동 ${retMoved}건`);

  // ⑦ 보안 정책 KB changeLog 신규 — on hold·resume·moved to 가 우리 카드를 무효화한다
  const sec = read(resolve(root, 'content/security-kb-changes.json'), {});
  if (sec.events?.length) reasons.push(`보안 KB 변경 이력 ${sec.events.length}건`);

  // ⑧ 보안 KB 한국 임박 중 미발송 — 데둡 앵커가 kbId 라 여기선 대조가 정확하다
  const manifestText = existsSync(resolve(root, 'assets/editorial/infographic/manifest.json'))
    ? readFileSync(resolve(root, 'assets/editorial/infographic/manifest.json'), 'utf8') : '';
  const koreaDue = (sec.korea || []).filter(k =>
    k.dday >= 0 && k.dday <= 30 && k.kbId && !manifestText.includes(k.kbId));
  if (koreaDue.length) reasons.push(`보안 KB 한국 임박 미발송 ${koreaDue.length}건 (최우선 레인)`);

  return {
    model: reasons.length ? 'opus' : 'sonnet',
    reasons,
    counts: {
      queueTotal: entries.length,
      unjudged: unjudged.length,
      corrections: corrections.length,
    },
  };
}
