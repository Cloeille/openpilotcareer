# Job board · aucun job disponible

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «Job board · aucun job disponible» width=1600 height=900 layout="none" fill="$bg" clip=true x=5100 y=3000
  - frame «Scene 3D» width=1600 height=900 fill={"type": "image", "enabled": true, "url": "images/generated-3.png", "mode": "cover"} x=0 y=0
  - rectangle «Scene Shade» width=1600 height=900 fill={"type": "gradient", "gradientType": "radial", "enabled": true, "rotation": 0, "size": {"width": 1.5, "height": 1.5}, "colors": [{"color"... x=0 y=0
  - frame «Content» width=1600 height=778 gap=20 padding=[28, 32, 24, 32] x=0 y=76
    - frame «Board Column» width=1000 height="fill_container" layout="vertical" gap=28
      - frame «Title Row» width="fill_container" alignItems="end" justifyContent="space_between"
        - frame «Title Block» layout="vertical" gap=6
          - frame «Status» gap=8 alignItems="center"
            - text «Status Text» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: Au départ de LFKC · mis à jour il y a 12 s
          - text «Title» fill="$text-primary" fontFamily="$font-display" fontSize=30 fontWeight="600"  TEXT: Jobs disponibles
        - frame «SimBrief Entry» gap=10 padding=[0, 0, 4, 0] alignItems="center"
          - ref «Key» ref="T9v0n" descendants={"Mw53t": {"content": "I"}}  (instance of «Keycap»)
          - text «Label» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: Importer un plan SimBrief
      - ref «Jobs Panel» width="fill_container" height="fit_content" ref="bibzm" descendants={"uBW0Z": {"enabled": false}, "e0veVE": {"content": "Offres disponibles"}, "A9Tx2K": {"content": "Tri : gain estimé ↓"}, "q5ftx0": {"padd...  (instance of «Panel»)
  - ref «HUD Top» ref="a93UHQ" descendants={"Uth8f": {"stroke": "#00000000"}, "Ely3m": {"fill": "$text-tertiary"}, "wAYyl": {"stroke": "$text-primary"}, "VKGo6": {"fill": "$text-pr... x=0 y=0  (instance of «HUD/Top»)
  - ref «HUD Bottom» ref="t2yhjE" descendants={"D3kro/Mw53t": {"content": "Échap"}, "XuZbG": {"content": "Tableau de bord"}, "msx5l/Mw53t": {"content": "Entrée"}, "sA5qV": {"content":... x=0 y=854  (instance of «HUD/Bottom»)
