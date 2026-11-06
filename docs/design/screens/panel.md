# Panel

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «Panel» width=440 layout="vertical" fill="$surface" stroke="$border" strokeWidth=1 cornerRadius=6 effect={"type": "background_blur", "radius": 24} reusable=true clip=true x=620 y=-1260
  - frame «Header» width="fill_container" gap=10 padding=[18, 22, 4, 22] alignItems="center"
    - rectangle «Tick» width=3 height=14 fill="$accent" x=16 y=14
    - text «Title» width="fill_container" fill="$text-primary" fontFamily="$font-display" fontSize=18 fontWeight="600"  TEXT: Vol en cours
    - text «Action» fill="$text-secondary" fontFamily="$font-ui" fontSize=13 fontWeight="500"  TEXT: Tout voir
  - rectangle «Divider» width="fill_container(440)" height=1 fill="$border" x=0 y=42
  - frame «Content» width="fill_container" height="fit_content(80)" layout="vertical" gap=14 padding=[14, 22, 22, 22]
