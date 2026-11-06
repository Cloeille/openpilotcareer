# Location · contrat

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «Location · contrat» width=1600 height=900 layout="none" fill="$bg" clip=true
  - frame «Scene 3D» width=1600 height=900 fill={"type": "image", "enabled": true, "url": "images/generated-5.png", "mode": "cover"}
  - rectangle «Scene Shade» width=1600 height=900 fill={"type": "gradient", "gradientType": "radial", "enabled": true, "rotation": 0, "size": {"width": 1.5, "height": 1.5}, "colors": [{"color"...
  - frame «Content» width=1600 height=778 padding=[28, 32, 24, 32] justifyContent="space_between"
    - frame «Contract Column» width=640 height="fill_container" layout="vertical" gap=28
      - frame «Title Block» width="fill_container" layout="vertical" gap=6
        - frame «Status» gap=8 alignItems="center"
          - text «Status Text» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: Catalogue d'avions · location
        - text «Title» fill="$text-primary" fontFamily="$font-display" fontSize=30 fontWeight="600"  TEXT: DHC-6 Twin Otter 400
        - text «Sub» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="normal"  TEXT: Loué par Viking Air Leasing · occasion de 2015 · 6 840 h de vol · F-HAZG
      - ref «Duration Panel» width="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Durée du contrat"}, "A9Tx2K": {"content": "Plus long, loyer plus bas", "fill": "$text-tertiary"}, "q5ftx0": {"lay...  (instance of «Panel»)
      - ref «Terms Panel» width="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Ce que prévoit le contrat"}, "A9Tx2K": {"content": "Viking Air Leasing", "fill": "$text-tertiary"}, "q5ftx0": {"p...  (instance of «Panel»)
    - frame «Summary Column» width=420 height="fill_container" layout="vertical"
      - ref «Summary Panel» width="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Récapitulatif"}, "A9Tx2K": {"content": "Étape 2 sur 2", "fill": "$text-tertiary"}, "q5ftx0": {"padding": [16, 24,...  (instance of «Panel»)
  - ref «HUD Top» ref="a93UHQ" descendants={"Uth8f": {"stroke": {"type": "color", "color": "$text-primary", "enabled": false}}, "Ely3m": {"fill": "$text-tertiary"}, "K11dL": {"stro...  (instance of «HUD/Top»)
  - ref «HUD Bottom» ref="t2yhjE" descendants={"vdllS": {"type": "frame", "id": "OnzXn", "name": "Hints", "gap": 22, "alignItems": "center", "children": [{"type": "frame", "id": "r8u8...  (instance of «HUD/Bottom»)
