# Détail d'un job

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «Détail d'un job» width=1600 height=900 layout="none" fill="$bg" clip=true x=1700 y=3000
  - frame «Scene 3D» width=1600 height=900 fill={"type": "image", "enabled": true, "url": "images/generated-4.png", "mode": "cover"} x=0 y=0
  - rectangle «Scene Shade» width=1600 height=900 fill={"type": "gradient", "gradientType": "radial", "enabled": true, "rotation": 0, "size": {"width": 1.5, "height": 1.5}, "colors": [{"color"... x=0 y=0
  - frame «Content» width=1600 height=778 gap=24 padding=[28, 32, 24, 32] x=0 y=76
    - frame «Briefing Column» width=620 height="fill_container" layout="vertical" gap=32
      - frame «Job Header» width="fill_container" layout="vertical" gap=12
        - frame «Title Block» layout="vertical" gap=6
          - frame «Status» gap=8 alignItems="center"
            - text «Status Text» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: Job passagers · J-20915
          - text «Title» fill="$text-primary" fontFamily="$font-display" fontSize=30 fontWeight="600"  TEXT: Nice → Rome-Fiumicino
        - text «Route Line» fill="$text-secondary" fontFamily="$font-ui" fontSize=16 fontWeight="normal"  TEXT: LFMN → LIRF · 254 NM · environ 1 h 30 de vol
        - frame «Contest Status» gap=10 padding=[8, 0, 0, 0] alignItems="center"
          - ref «Contesté» ref="KcypN"  (instance of «Badge/Contesté»)
          - text «Note» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="normal"  TEXT: Corsica Wings positionne un ATR 72 à Nice : prise estimée dans 6 min environ.
      - ref «Briefing Panel» width="fill_container" ref="bibzm" descendants={"uBW0Z": {"padding": [24, 28, 4, 28]}, "e0veVE": {"content": "Briefing"}, "A9Tx2K": {"content": "Carte", "enabled": false}, "q5ftx0": {"...  (instance of «Panel»)
  - ref «HUD Top» ref="a93UHQ" descendants={"Uth8f": {"stroke": "#00000000"}, "Ely3m": {"fill": "$text-tertiary"}, "wAYyl": {"stroke": "$text-primary"}, "VKGo6": {"fill": "$text-pr... x=0 y=0  (instance of «HUD/Top»)
  - ref «HUD Bottom» ref="t2yhjE" descendants={"D3kro/Mw53t": {"content": "Échap"}, "XuZbG": {"content": "Retour aux jobs"}, "msx5l/Mw53t": {"content": "Entrée"}, "sA5qV": {"content":... x=0 y=854  (instance of «HUD/Bottom»)
