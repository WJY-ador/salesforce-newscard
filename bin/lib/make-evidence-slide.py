"""이미지를 Instagram 슬라이드(3:4)로 만든다 — 설명을 얹을 수도 있다 (2026-09-15 신설).

왜 3:4 인가: 프로필 그리드 셀이 **3:4 세로형**이고 `object-fit: cover` 로 채운다
(2026-09-15 실측: 셀 262.6x350.2). 1:1 을 넣으면 좌우가 잘려 제목 양끝이 날아가고,
2:3 을 넣으면 위아래가 잘린다. 셀과 같은 비율이면 잘릴 것이 없다. 캐러셀도 첫 슬라이드
비율로 전체를 표시하므로 모든 슬라이드를 같은 3:4 로 맞춘다.

왜 설명을 그려 넣나: 캐러셀 캡션은 **게시물당 하나**다. 슬라이드를 넘겨도 설명이 바뀌지
않는다(2026-09-15 사용자 지시 "넘겼을 때 해당하는 내용이 설명으로 나와야 할 것").
Slack 은 스레드 코멘트가 그 자리를 대신하지만 Instagram 에는 그런 자리가 없다.

    python3 bin/lib/make-evidence-slide.py <이미지.png> <출력.png> [설명텍스트]

설명이 없으면 이미지를 3:4 틀에 비율 그대로 넣기만 한다(카드 슬라이드). 설명이 있으면
위에 제목, 가운데 캡처, 아래 본문으로 배치한다 — Slack 코멘트 양식을 그대로 받는다.
"""
import sys
import textwrap
from PIL import Image, ImageDraw, ImageFont

W_OUT, H_OUT = 1024, 1365      # 3:4 — 프로필 그리드 셀과 같은 비율
PAD = 48
BG = (253, 252, 248)      # 카드 배경(크림)과 같은 계열
INK = (31, 41, 55)
MUTED = (91, 103, 122)
FONT_PATH = "/System/Library/Fonts/AppleSDGothicNeo.ttc"


def font(size, index=2):
    # AppleSDGothicNeo.ttc 는 여러 굵기를 담고 있다 — 2=Regular, 4=Bold 부근
    try:
        return ImageFont.truetype(FONT_PATH, size, index=index)
    except Exception:
        return ImageFont.truetype(FONT_PATH, size)


def red_box(im):
    """캡처에 주입된 빨간 주석 네모(#ea001e)의 경계를 찾는다.
    capture-annotated.mjs · capture-docpage.mjs 가 `6px solid #ea001e` 로 그린다."""
    W, H = im.size
    px = im.load()
    xs, ys = [], []
    step = max(1, min(W, H) // 700)      # 큰 캡처에서 훑는 비용을 줄인다
    for y in range(0, H, step):
        for x in range(0, W, step):
            r, g, b = px[x, y]
            if r > 190 and g < 70 and b < 80:
                xs.append(x)
                ys.append(y)
    if not xs:
        return None
    return min(xs), min(ys), max(xs), max(ys)


def fit_shot(im, box_w, box_h):
    """캡처를 슬라이드 자리에 넣는다.

    **가로는 자르지 않는다.** 화면 캡처는 가로가 넓은데 슬라이드 자리는 세로로 길어서,
    자리를 꽉 채우려고 좌우를 깎으면 왼쪽 메뉴와 오른쪽 끝이 잘려 화면이 토막 나 보인다
    (2026-09-15 실측·사용자 지적). 세로만 빨간 주석 네모(#ea001e) 둘레로 줄여 관련 없는
    부분을 덜어내고, 가로 폭에 맞춰 넣는다. 남는 세로 공간은 글자가 쓴다.
    """
    W, H = im.size
    keep_h = H
    rb = red_box(im)
    max_ratio_h = int(W * box_h / box_w)          # 이 높이를 넘으면 세로가 남아돈다
    if H > max_ratio_h:
        keep_h = max_ratio_h
        if rb:
            cy = (rb[1] + rb[3]) // 2
            # 빨간 네모가 다 들어가게 잡되, 그보다 좁힐 수는 없다
            keep_h = max(keep_h, rb[3] - rb[1] + 80)
            keep_h = min(keep_h, H)
            y0 = max(0, min(H - keep_h, cy - keep_h // 2))
        else:
            y0 = (H - keep_h) // 2
        im = im.crop((0, y0, W, y0 + keep_h))
    scale = min(box_w / im.size[0], box_h / im.size[1])
    return im.resize((max(1, int(im.size[0] * scale)), max(1, int(im.size[1] * scale))), Image.LANCZOS)


def wrap(draw, text, fnt, width, first_width=None):
    """픽셀 폭 기준 줄바꿈. **띄어쓰기 우선**으로 끊는다 — 글자 단위로만 끊으면
    'Develop / er', '붙입니 / 다' 처럼 단어 중간이 갈라진다(2026-09-15 사용자 지적).
    한 덩어리가 통째로 안 들어가는 경우에만 글자 단위로 쪼갠다.
    first_width 는 첫 줄만 좁게 쓸 때 — Instagram 이 오른쪽 위에 슬라이드 번호(2/3)를
    겹쳐 그려서 그 자리를 비워 둬야 한다."""
    out = []
    for para in text.split("\n"):
        para = para.strip()
        if not para:
            continue
        line = ""
        for token in para.split(" "):
            limit = first_width if (first_width and not out and not line) else width
            probe = token if not line else line + " " + token
            if draw.textlength(probe, font=fnt) <= limit:
                line = probe
                continue
            if line:
                out.append(line)
                line = ""
            # 토큰 하나가 한 줄보다 길면 그때만 글자 단위로 자른다
            limit = width
            for ch in token:
                if draw.textlength(line + ch, font=fnt) > limit and line:
                    out.append(line)
                    line = ch
                else:
                    line += ch
        if line:
            out.append(line)
    return out


def main(shot_path, out_path, caption):
    src = Image.open(shot_path).convert("RGB")

    # 설명이 없으면 = 카드 슬라이드. 3:4 틀에 비율 그대로 넣는다(잘라내지 않는다).
    if not caption.strip():
        bg = src.load()[4, 4]
        sw, sh = src.size
        scale = min(W_OUT / sw, H_OUT / sh)
        fitted = src.resize((int(sw * scale), int(sh * scale)), Image.LANCZOS)
        canvas = Image.new("RGB", (W_OUT, H_OUT), bg)
        canvas.paste(fitted, ((W_OUT - fitted.size[0]) // 2, (H_OUT - fitted.size[1]) // 2))
        canvas.save(out_path)
        print(f"카드 슬라이드 — {sw}x{sh} → {fitted.size[0]}x{fitted.size[1]} (3:4 틀)")
        return 0

    canvas = Image.new("RGB", (W_OUT, H_OUT), BG)
    draw = ImageDraw.Draw(canvas)

    lines = [l.strip() for l in caption.split("\n") if l.strip()]
    head = lines[0] if lines else ""
    body = lines[1:]

    inner = W_OUT - PAD * 2
    BADGE = 150          # 오른쪽 위 슬라이드 번호가 가리는 폭

    # 글자 크기를 줄여 가며 "텍스트가 다 들어가고 캡처 자리도 남는" 조합을 찾는다.
    # 줄 수를 잘라내면 문장이 중간에서 끊긴다 — 자르지 않고 맞춘다.
    for head_size, body_size in ((34, 26), (32, 24), (30, 22), (28, 20), (26, 18)):
        f_head, f_body = font(head_size, index=4), font(body_size, index=2)
        head_lh, body_lh = int(head_size * 1.34), int(body_size * 1.42)
        head_lines = wrap(draw, head, f_head, inner, first_width=inner - BADGE)
        body_lines = []
        for b in body:
            body_lines += wrap(draw, b, f_body, inner - 24)
        text_h = len(head_lines) * head_lh + len(body_lines) * body_lh
        shot_h = H_OUT - PAD * 3 - text_h
        if shot_h >= H_OUT * 0.38:
            break

    # 블록 전체를 세로 가운데로 — 캡처가 가로 폭에 먼저 걸리면 아래가 휑하게 남는다
    shot_preview = fit_shot(src, inner, shot_h)
    block_h = len(head_lines) * head_lh + PAD // 2 + shot_preview.size[1] + PAD // 2 + len(body_lines) * body_lh
    y = max(PAD, (H_OUT - block_h) // 2)
    for l in head_lines:
        draw.text((PAD, y), l, font=f_head, fill=INK)
        y += head_lh

    # 캡처는 머리말 아래, 본문 위. 남은 자리를 꽉 채우도록 빨간 네모 기준으로 잘라 넣는다
    shot = fit_shot(src, inner, shot_h)
    sx = (W_OUT - shot.size[0]) // 2
    sy = y + PAD // 2
    canvas.paste(shot, (sx, sy))
    draw.rectangle([sx, sy, sx + shot.size[0] - 1, sy + shot.size[1] - 1], outline=(214, 218, 226), width=2)

    y = sy + shot.size[1] + PAD // 2
    # 이어지는 줄은 글머리 기호 폭만큼 들여 쓴다 — 항목 경계가 눈에 들어온다
    hang = int(draw.textlength("•  ", font=f_body))
    for l in body_lines:
        draw.text((PAD if l.startswith("•") else PAD + hang, y), l, font=f_body, fill=MUTED)
        y += body_lh

    canvas.save(out_path)
    print(f"증거 슬라이드 — 제목 {len(head_lines)}줄 · 본문 {len(body_lines)}줄 · 캡처 {shot.size[0]}x{shot.size[1]}")
    return 0


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("사용법: python3 bin/lib/make-evidence-slide.py <이미지.png> <출력.png> [설명]", file=sys.stderr)
        sys.exit(1)
    sys.exit(main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else ""))
