# Détail d'un vol · calcul du gain

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «Détail d'un vol · calcul du gain» width=1600 height=900 layout="none" fill="$bg" clip=true
  - frame «Scene 3D» width=1600 height=900 fill={"type": "image", "enabled": true, "url": "images/generated-8.png", "mode": "cover"}
  - rectangle «Scene Shade» width=1600 height=900 fill={"type": "gradient", "gradientType": "radial", "enabled": true, "rotation": 0, "size": {"width": 1.5, "height": 1.5}, "colors": [{"color"...
  - frame «Content» width=1600 height=778 layout="vertical" gap=28 padding=[40, 64, 32, 64]
    - frame «Header» width="fill_container" alignItems="end" justifyContent="space_between"
      - frame «Title Block» layout="vertical" gap=10
        - text «Overline» fill="$text-secondary" fontFamily="$font-ui" fontSize=15 fontWeight="normal"  TEXT: Calcul du gain · job J-20794
        - frame «Title Row» gap=20 alignItems="center"
          - text «Title» fill="$text-primary" fontFamily="$font-display" fontSize=52 fontWeight="600"  TEXT: AZR 4122
          - frame «Verdict» gap=8 alignItems="center"
            - ellipse «Dot» width=7 height=7 fill="$success"
            - text «Label» fill="$text-secondary" fontFamily="$font-ui" fontSize=16 fontWeight="normal"  TEXT: Vérifié
        - text «Subline» fill="$text-secondary" fontFamily="$font-ui" fontSize=16 fontWeight="normal"  TEXT: Lyon-Saint-Exupéry → Nice Côte d'Azur · ATR 72-600 F-HAZR · bloc 1 h 04
      - frame «Views» gap=32 alignItems="center"
        - frame «View · Télémétrie» gap=10 padding=[0, 0, 10, 0] alignItems="center" stroke="#00000000" strokeWidth={"bottom": 2}
          - text «Label» fill="$text-secondary" fontFamily="$font-ui" fontSize=16 fontWeight="500"  TEXT: Télémétrie
          - ref «Key» ref="T9v0n" descendants={"Mw53t": {"content": "G"}}  (instance of «Keycap»)
        - frame «View · Calcul du gain» gap=10 padding=[0, 0, 10, 0] alignItems="center" stroke="$text-primary" strokeWidth={"bottom": 2}
          - text «Label» fill="$text-primary" fontFamily="$font-ui" fontSize=16 fontWeight="500"  TEXT: Calcul du gain
    - frame «Body» width="fill_container" height="fill_container" justifyContent="space_between"
      - ref «Statement Panel» width=680 height="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Relevé du gain"}, "A9Tx2K": {"content": "Crédité le 4 nov. à 21:19Z", "fill": "$text-tertiary"}, "q5ftx0": {"gap"...  (instance of «Panel»)
      - ref «Pay Rules Panel» width=420 height="fit_content" ref="bibzm" descendants={"e0veVE": {"content": "Vérification et paie"}, "A9Tx2K": {"enabled": false}, "q5ftx0": {"gap": 22, "padding": [14, 22, 24, 22], "height"...  (instance of «Panel»)
  - ref «HUD Top» ref="a93UHQ" descendants={"Uth8f": {"stroke": "#00000000"}, "Ely3m": {"fill": "$text-tertiary"}, "oRNeg": {"stroke": "$text-primary"}, "ZLZNH": {"fill": "$text-pr...  (instance of «HUD/Top»)
  - ref «HUD Bottom» ref="t2yhjE" descendants={"D3kro/Mw53t": {"content": "Échap"}, "XuZbG": {"content": "Retour au carnet"}, "msx5l/Mw53t": {"content": "Z"}, "sA5qV": {"content": "Vo...  (instance of «HUD/Bottom»)
