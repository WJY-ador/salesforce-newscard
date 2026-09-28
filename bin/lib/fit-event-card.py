"""행사 카드를 인스타 4:5(1024x1280)로 맞춘다 — 내용은 한 글자도 잘리지 않는다 (2026-09-18 신설).

    python3 bin/lib/fit-event-card.py <카드.png>

왜 필요한가: 인스타 피드는 세로 4:5 가 상한이라 2:3 카드는 위아래가 잘린다
(2026-09-18 실측: 게시된 DAY 1 슬라이드 1024x1365 의 위아래 각 43px 이 피드에서 잘려
DAY 필·출처 줄이 날아갔다). 그래서 잘릴 것을 우리가 먼저 맞춘다.

왜 고정 중앙 크롭이 아닌가: 프롬프트에 "위·아래 128px 띠에는 아무것도 놓지 않는다"를
세 문단으로 써도 모델이 하단을 지키지 않는다 (2026-09-18 실측 2회: 7장 중 5장에서
푸터 결론 줄이 크롭에 잘렸다). 지시로 못 잡으니 코드가 잰다.

하는 일: 배경색과 다른 픽셀의 상하 경계를 찾아 내용 높이를 재고,
 - 1280 안에 들어가면 그 내용을 담는 1280 창을 잘라 낸다 (글자 크기 그대로).
 - 넘치면 비율을 유지한 채 1280 에 맞춰 줄이고 좌우를 같은 배경색으로 채운다
   (배경이 같은 색이라 여백은 보이지 않는다 — 잘리는 것보다 낫다).
상단은 로고 합성 슬롯(y 25~77)이 있어 가능하면 여백을 위쪽에 먼저 준다.
"""
import sys
from PIL import Image

OUT_W, OUT_H = 1024, 1280
TOP_PREF = 110      # 로고 슬롯(y 25~77)을 덮지 않도록 위쪽에 먼저 주는 여백
TOL = 14            # 배경으로 볼 색 차이


def main(path):
    im = Image.open(path).convert("RGB")
    W, H = im.size
    if (W, H) == (OUT_W, OUT_H):
        print(f"이미 {OUT_W}x{OUT_H} — 그대로 둡니다")
        return 0
    bg = im.load()[4, 4]
    px = im.load()

    def row_has_content(y):
        for x in range(0, W, 4):
            r, g, b = px[x, y]
            if abs(r - bg[0]) > TOL or abs(g - bg[1]) > TOL or abs(b - bg[2]) > TOL:
                return True
        return False

    top = next((y for y in range(H) if row_has_content(y)), 0)
    bot = next((y for y in range(H - 1, -1, -1) if row_has_content(y)), H - 1)
    content_h = bot - top + 1

    if content_h <= OUT_H:
        pad = OUT_H - content_h
        top_pad = min(pad, TOP_PREF)
        y0 = max(0, min(H - OUT_H, top - top_pad))
        im.crop((0, y0, W, y0 + OUT_H)).save(path)
        print(f"4:5 크롭 — 내용 y {top}~{bot} ({content_h}px) → 창 y {y0}~{y0 + OUT_H}, 배율 1.00")
        return 0

    scale = OUT_H / content_h
    body = im.crop((0, top, W, bot + 1)).resize(
        (max(1, round(W * scale)), OUT_H), Image.LANCZOS)
    canvas = Image.new("RGB", (OUT_W, OUT_H), bg)
    canvas.paste(body, ((OUT_W - body.size[0]) // 2, 0))
    canvas.save(path)
    print(f"4:5 축소 — 내용 {content_h}px 이 1280 을 넘어 배율 {scale:.3f} "
          f"(폭 {body.size[0]}px, 좌우 여백은 배경과 같은 색)")
    return 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("사용법: python3 bin/lib/fit-event-card.py <카드.png>", file=sys.stderr)
        sys.exit(1)
    sys.exit(main(sys.argv[1]))
