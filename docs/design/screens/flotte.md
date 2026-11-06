# Flotte

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «Flotte» width=1600 height=900 layout="none" fill="$bg" clip=true x=0 y=4100
  - frame «Scene 3D» width=1600 height=900 fill={"type": "image", "enabled": true, "url": "images/generated-6.png", "mode": "cover"} x=0 y=0
  - rectangle «Scene Shade» width=1600 height=900 fill={"type": "gradient", "gradientType": "radial", "enabled": true, "rotation": 0, "size": {"width": 1.5, "height": 1.5}, "colors": [{"color"... x=0 y=0
  - frame «Content» width=1600 height=778 padding=[28, 32, 24, 32] justifyContent="space_between" x=0 y=76
    - frame «Left Column» width=720 height="fill_container" layout="vertical" gap=28
      - frame «Page Header» width="fill_container" alignItems="end" justifyContent="space_between"
        - frame «Title Block» layout="vertical" gap=6
          - frame «Status» gap=8 alignItems="center"
            - text «Status Text» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: Azur Régional · AZR
          - text «Title» fill="$text-primary" fontFamily="$font-display" fontSize=30 fontWeight="600"  TEXT: Flotte
        - frame «Fleet Stats» padding=[0, 0, 6, 0]
          - text «Fleet Summary» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="normal"  TEXT: 6 appareils · 3 disponibles
      - ref «Roster Panel» width="fill_container" ref="bibzm" descendants={"G3dgU": {"enabled": false}, "e0veVE": {"content": "Appareils"}, "A9Tx2K": {"content": "Trier par immatriculation", "fill": "$text-terti...  (instance of «Panel»)
      - frame «Fleet Actions» width="fill_container" gap=12 alignItems="center"
        - ref «Btn · Acheter un avion» ref="Im067" descendants={"h8MyJ": {"content": "Acheter un avion"}, "zU1n6": {"content": "A"}}  (instance of «Button/Primary»)
        - ref «Btn · Acheter un hub» ref="v6he7" descendants={"RU69u": {"enabled": false}, "BxHlG": {"content": "Acheter un hub"}}  (instance of «Button/Secondary»)
        - frame «Spacer» width="fill_container" height=1
        - frame «Capacity Note» layout="vertical" gap=3 alignItems="end"
          - text «Label» fill="$text-tertiary" fontFamily="$font-ui" fontSize=12 fontWeight="normal"  TEXT: Parkings libres
          - text «Value» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="normal"  TEXT: 4 sur 10 · LFKB complet
    - frame «Right Column» width=410 height="fill_container" layout="vertical" gap=14
      - ref «Detail Panel» width="fill_container" ref="bibzm" descendants={"uBW0Z": {"enabled": false}, "e0veVE": {"content": "Appareil sélectionné"}, "A9Tx2K": {"content": "Fiche technique"}, "q5ftx0": {"paddin...  (instance of «Panel»)
  - ref «HUD Top» ref="a93UHQ" descendants={"Uth8f": {"stroke": {"type": "color", "color": "$text-primary", "enabled": false}}, "Ely3m": {"fill": "$text-tertiary"}, "K11dL": {"stro... x=0 y=0  (instance of «HUD/Top»)
  - ref «HUD Bottom» ref="t2yhjE" descendants={"vdllS": {"type": "frame", "id": "zU7JZ", "name": "Hints", "slot": ["T9v0n"], "gap": 22, "alignItems": "center", "children": [{"type": "... x=0 y=854  (instance of «HUD/Bottom»)
