#!/usr/bin/env node
/**
 * Claude가 만든 card-brief.json을 GPT Image 2 세션용 입력으로 변환한다.
 * 이 스크립트는 모델을 호출하지 않는다 — 출력 내용을 Codex imagegen 세션에서 검수 후 사용한다.
 *
 * 프롬프트는 브리프의 스타일 문장(image.prompt)에 templates/card-layout.js가
 * 섹션 구성에서 파생한 캔버스·레이아웃·마스코트 문장을 합성해 만든다. 렌더러가
 * 같은 존 맵으로 텍스트를 얹으므로, 레이아웃 문장을 손으로 고치면 어긋난다.
 *
 *   node bin/prepare-gpt-image-prompt.mjs --brief out/card-brief.json
 *   node bin/prepare-gpt-image-prompt.mjs --brief out/card-brief.json --json
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { loadBrief } = require(resolve(ROOT, 'templates/card-brief.js'));
const { CANVAS, BOTTOM_LIMIT, computeLayout, composePrompt, composeNegativePrompt } = require(resolve(ROOT, 'templates/card-layout.js'));

export function buildPromptPayload(brief) {
  return {
    cardTitle: brief.card.title,
    assetPath: brief.image.assetPath,
    references: brief.image.references,
    size: `${CANVAS.width}x${CANVAS.height}`,
    layoutMode: brief.image.layoutMode || 'skin',
    stylePrompt: brief.image.prompt,
    prompt: composePrompt(brief),
    negativePrompt: composeNegativePrompt(brief)
  };
}

function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--brief');
  const briefPath = i >= 0 ? args[i + 1] : resolve(ROOT, 'out/card-brief.json');
  const brief = loadBrief(readFileSync, briefPath);
  // 넘치는 브리프로 프롬프트를 만들면 panels 모드에서 캔버스 밖 % 좌표를
  // GPT에 지시하게 된다 — 렌더·검증 게이트와 같은 기준으로 여기서도 막는다.
  // full 모드는 존 맵으로 텍스트를 얹지 않으므로 이 게이트를 타지 않는다.
  if ((brief.image.layoutMode || 'skin') !== 'full') {
    const layout = computeLayout(brief.card.sections);
    if (!layout.fits) {
      console.error(`✗ 섹션이 캔버스를 넘칩니다 — 예상 하단 ${layout.bottom}px > 허용 ${BOTTOM_LIMIT}px. 프롬프트를 만들지 않습니다.`);
      process.exit(1);
    }
  }
  const payload = buildPromptPayload(brief);
  if (args.includes('--json')) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  console.log(`카드: ${payload.cardTitle}`);
  console.log(`저장 대상: ${payload.assetPath}`);
  console.log(`크기: ${payload.size} · 레이아웃 모드: ${payload.layoutMode}`);
  console.log(`참조 이미지: ${payload.references.join(', ')}`);
  console.log('\n[GPT Image 2 prompt]\n' + payload.prompt);
  console.log('\n[negative prompt]\n' + payload.negativePrompt);
  console.log('\n모델 호출은 하지 않았습니다. 이 프롬프트를 검수한 뒤 Codex imagegen 세션에서 생성하세요.');
  if (payload.layoutMode === 'full') {
    console.log('⚠ full 모드: 이미지에 텍스트가 들어갑니다. 생성 후 반드시 브리프 원문과 글자 단위로 대조하세요 — audit-share는 픽셀 속 오타를 잡지 못합니다.');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
