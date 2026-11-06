# Catalogue d'avions

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «Catalogue d'avions» width=1600 height=900 layout="none" fill="$bg" clip=true x=1700 y=4100
  - frame «Scene 3D» width=1600 height=900 fill={"type": "image", "enabled": true, "url": "images/generated-5.png", "mode": "cover"} x=0 y=0
  - rectangle «Scene Shade» width=1600 height=900 fill={"type": "gradient", "gradientType": "radial", "enabled": true, "rotation": 0, "size": {"width": 1.5, "height": 1.5}, "colors": [{"color"... x=0 y=0
  - frame «Content» width=1600 height=778 padding=[28, 32, 24, 32] justifyContent="space_between" x=0 y=76
    - frame «Catalogue Column» width=780 height="fill_container" layout="vertical" gap=28
      - frame «Page Header» width="fill_container" alignItems="end" justifyContent="space_between"
        - frame «Title Block» layout="vertical" gap=6
          - frame «Status» gap=8 alignItems="center"
            - text «Status Text» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: Flotte · acheter un avion
          - text «Title» fill="$text-primary" fontFamily="$font-display" fontSize=30 fontWeight="600"  TEXT: Catalogue d'avions
        - frame «Catalogue Stats» padding=[0, 0, 6, 0]
          - text «Catalogue Summary» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="normal"  TEXT: 2 547 types OACI · 412 avec données réelles
      - ref «Catalogue Panel» width="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Types d'appareils"}, "A9Tx2K": {"content": "Trier par pertinence", "fill": "$text-tertiary"}, "q5ftx0": {"padding...  (instance of «Panel»)
    - frame «Purchase Column» width=420 height="fill_container" layout="vertical" gap=20 justifyContent="space_between"
      - ref «Purchase Panel» width="fill_container" stroke="$border" ref="bibzm" descendants={"uBW0Z": {"enabled": false}, "G3dgU": {"fill": "$accent"}, "e0veVE": {"content": "Type sélectionné"}, "A9Tx2K": {"content": "Étape 1 sur...  (instance of «Panel»)
      - ref «Custom Aircraft Panel» width="fill_container" height="fit_content" ref="bibzm" descendants={"e0veVE": {"content": "Ajouter un avion d'addon"}, "A9Tx2K": {"content": "Saisir un type OACI", "enabled": false}, "q5ftx0": {"padding":...  (instance of «Panel»)
  - ref «HUD Top» ref="a93UHQ" descendants={"Uth8f": {"stroke": {"type": "color", "color": "$text-primary", "enabled": false}}, "Ely3m": {"fill": "$text-tertiary"}, "K11dL": {"stro... x=0 y=0  (instance of «HUD/Top»)
  - ref «HUD Bottom» ref="t2yhjE" descendants={"vdllS": {"type": "frame", "id": "um7HS", "name": "Hints", "slot": ["T9v0n"], "gap": 22, "alignItems": "center", "children": [{"type": "... x=0 y=854  (instance of «HUD/Bottom»)
