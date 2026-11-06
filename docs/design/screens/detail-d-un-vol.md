# Détail d'un vol

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «Détail d'un vol» width=1600 height=900 layout="none" fill="$bg" clip=true x=1700 y=5200
  - frame «Scene 3D» width=1600 height=900 fill={"type": "image", "enabled": true, "url": "images/generated-8.png", "mode": "cover"} x=0 y=0
  - rectangle «Scene Shade» width=1600 height=900 fill={"type": "gradient", "gradientType": "radial", "enabled": true, "rotation": 0, "size": {"width": 1.5, "height": 1.5}, "colors": [{"color"... x=0 y=0
  - frame «Content» width=1600 height=778 layout="vertical" gap=28 padding=[40, 64, 32, 64] x=0 y=76
    - frame «Header» width="fill_container" alignItems="end" justifyContent="space_between"
      - frame «Title Block» layout="vertical" gap=10
        - text «Overline» fill="$text-secondary" fontFamily="$font-ui" fontSize=15 fontWeight="normal"  TEXT: Rapport de télémétrie · 4 nov. 2026
        - frame «Title Row» gap=20 alignItems="center"
          - text «Title» fill="$text-primary" fontFamily="$font-display" fontSize=52 fontWeight="600"  TEXT: AZR 4122
          - frame «Verdict» gap=8 alignItems="center"
            - ellipse «Dot» width=7 height=7 fill="$success"
            - text «Label» fill="$text-secondary" fontFamily="$font-ui" fontSize=16 fontWeight="normal"  TEXT: Vérifié
        - text «Subline» fill="$text-secondary" fontFamily="$font-ui" fontSize=16 fontWeight="normal"  TEXT: Lyon-Saint-Exupéry → Nice Côte d'Azur · ATR 72-600 F-HAZR · bloc 1 h 04
      - frame «Views» gap=32 alignItems="center"
        - frame «View · Télémétrie» gap=10 padding=[0, 0, 10, 0] alignItems="center" stroke="$text-primary" strokeWidth={"bottom": 2}
          - text «Label» fill="$text-primary" fontFamily="$font-ui" fontSize=16 fontWeight="500"  TEXT: Télémétrie
        - frame «View · Calcul du gain» gap=10 padding=[0, 0, 10, 0] alignItems="center" stroke="#00000000" strokeWidth={"bottom": 2}
          - text «Label» fill="$text-secondary" fontFamily="$font-ui" fontSize=16 fontWeight="500"  TEXT: Calcul du gain
          - ref «Key» ref="T9v0n" descendants={"Mw53t": {"content": "G"}}  (instance of «Keycap»)
    - frame «Middle» width="fill_container" height="fill_container" justifyContent="space_between"
      - ref «Landing Panel» width=440 height="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Atterrissage"}, "A9Tx2K": {"content": "Nice · piste 04R · 21:10Z", "fill": "$text-tertiary"}, "q5ftx0": {"gap": 0...  (instance of «Panel»)
      - ref «Anti-Cheat Panel» width=420 height="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Contrôles anti-triche"}, "A9Tx2K": {"content": "6 sur 6 réussis", "fill": "$text-secondary"}, "q5ftx0": {"gap": 1...  (instance of «Panel»)
    - ref «Timeline Panel» width="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Phases du vol"}, "A9Tx2K": {"content": "Décollage 20:19Z · toucher 21:10Z", "fill": "$text-tertiary"}, "q5ftx0": ...  (instance of «Panel»)
  - ref «HUD Top» ref="a93UHQ" descendants={"Uth8f": {"stroke": "#00000000"}, "Ely3m": {"fill": "$text-tertiary"}, "oRNeg": {"stroke": "$text-primary"}, "ZLZNH": {"fill": "$text-pr... x=0 y=0  (instance of «HUD/Top»)
  - ref «HUD Bottom» ref="t2yhjE" descendants={"D3kro/Mw53t": {"content": "Échap"}, "XuZbG": {"content": "Retour au carnet"}, "msx5l/Mw53t": {"content": "R"}, "sA5qV": {"content": "Re... x=0 y=854  (instance of «HUD/Bottom»)
