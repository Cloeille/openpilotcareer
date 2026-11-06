# Achat · fonds insuffisants

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «Achat · fonds insuffisants» width=1600 height=900 layout="none" fill="$bg" clip=true x=5100 y=4100
  - frame «Scene 3D» width=1600 height=900 fill={"type": "image", "enabled": true, "url": "images/generated-5.png", "mode": "cover"} x=0 y=0
  - rectangle «Scene Shade» width=1600 height=900 fill={"type": "gradient", "gradientType": "radial", "enabled": true, "rotation": 0, "size": {"width": 1.5, "height": 1.5}, "colors": [{"color"... x=0 y=0
  - frame «Content» width=1600 height=778 padding=[28, 32, 24, 32] justifyContent="space_between" x=0 y=76
    - frame «Options Column» width=640 height="fill_container" layout="vertical" gap=28
      - frame «Title Block» width="fill_container" layout="vertical" gap=6
        - frame «Status» gap=8 alignItems="center"
          - ellipse «Status Dot» width=7 height=7 fill="$danger"
          - text «Status Text» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: Fonds insuffisants pour un achat comptant
        - text «Title» fill="$text-primary" fontFamily="$font-display" fontSize=30 fontWeight="600"  TEXT: DHC-6 Twin Otter 400
        - text «Sub» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="normal"  TEXT: Occasion de 2015 · 6 840 h de vol · immatriculation F-HAZG
      - ref «Options Panel» width="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Comment financer cet achat ?"}, "A9Tx2K": {"content": "2 solutions", "fill": "$text-tertiary"}, "q5ftx0": {"paddi...  (instance of «Panel»)
      - text «Credit Note» fill="$text-tertiary" fontFamily="$font-ui" fontSize=13 fontWeight="normal"  TEXT: Durée et apport restent modifiables à l'étape suivante, de 36 à 120 mois et de 20 à 50 %.
    - frame «Summary Column» width=420 height="fill_container" layout="vertical"
      - ref «Summary Panel» width="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Récapitulatif"}, "A9Tx2K": {"content": "Achat comptant", "fill": "$text-tertiary"}, "q5ftx0": {"padding": [16, 24...  (instance of «Panel»)
  - ref «HUD Top» ref="a93UHQ" descendants={"Uth8f": {"stroke": {"type": "color", "color": "$text-primary", "enabled": false}}, "Ely3m": {"fill": "$text-tertiary"}, "K11dL": {"stro... x=0 y=0  (instance of «HUD/Top»)
  - ref «HUD Bottom» ref="t2yhjE" descendants={"vdllS": {"type": "frame", "id": "NY9dd", "name": "Hints", "gap": 22, "alignItems": "center", "children": [{"type": "frame", "id": "nNpk... x=0 y=854  (instance of «HUD/Bottom»)
