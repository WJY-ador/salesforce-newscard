/**
 * 공용 텍스트 유틸 — fetch 계열이 제각기 들고 있던 복사본을 모았다.
 *
 * 복사본마다 엔티티 처리 폭이 달랐다 (blog 는 숫자 엔티티 전부, retirements 는
 * 수기 목록, behavior-changes 는 4종뿐). 그 드리프트가 곧 잠재 버그라 가장 넓은
 * 구현(blog 의 decode)으로 통일했다. 커밋된 스냅샷 전부에 미해제 엔티티가 0건임을
 * 확인하고 바꿨다 — 기존 키·값이 달라지지 않는다 (2026-08-10 실측).
 *
 * slug 는 통일하지 않는다. 파일마다 최대 길이(90/72/64)와 한글 허용이 달랐고,
 * 그 결과가 커밋된 스냅샷 키와 발송 이력 키에 박혀 있다 — 동작을 바꾸면 기존
 * 항목 전부가 added 로 보여 없는 소식이 나간다. 그래서 옵션으로 보존한다.
 */

const NAMED = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  hellip: '…', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’',
  ldquo: '"', rdquo: '"', middot: '·', rarr: '→'
};

/** HTML 엔티티 해제 — 숫자(10·16진) 전부 + 자주 나오는 이름 엔티티 */
export const decodeEntities = s => String(s)
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);

/** 태그 제거 + 엔티티 해제 + 공백 정리 — 수집기들의 strip()/decode() 자리 */
export const stripHtml = s =>
  decodeEntities(String(s).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/**
 * 제목 → 항목 키. max·keepKorean 은 호출자의 기존 값을 그대로 준다 —
 * 스냅샷·발송 이력 키가 이 함수 출력에 걸려 있어 기본값을 바꾸면 안 된다.
 */
export function slug(s, { max = 72, keepKorean = false } = {}) {
  const drop = keepKorean ? /[^a-z0-9가-힣]+/g : /[^a-z0-9]+/g;
  return String(s).toLowerCase()
    .replace(/[’'"]/g, '').replace(/&/g, ' and ')
    .replace(drop, '-').replace(/^-|-$/g, '').slice(0, max);
}

/** 수집 시각 표기 — "YYYY-MM-DD HH:mm:ss KST" */
export const nowKst = () =>
  new Date(Date.now() + 9 * 3600e3).toISOString().replace('T', ' ').slice(0, 19) + ' KST';
