# 제품 로고

`bin/compose-logos.mjs`·`bin/compose-logos-event.mjs`가 카드 위에 얹는 로고 SVG를 여기에 둡니다.
로고 파일은 각 사의 상표라 이 저장소에 넣지 않았습니다.

- `color/<슬러그>.svg` — 브랜드 원색이 들어 있는 다색 원본
- `mono/<슬러그>.svg` — 단색 경로. 다색 원본이 없을 때 `index.json`의 `brandHex`로 칠합니다.

슬러그와 색 설정은 `index.json`에 있습니다. 브리프의 `card.logos`는 이 파일에 있는 슬러그만 받습니다.
