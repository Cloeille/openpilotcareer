# Historique · saisie manuelle d'un vol

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «Historique · saisie manuelle d'un vol» width=1600 height=900 layout="none" fill="$bg" clip=true
  - frame «Scene 3D» width=1600 height=900 fill={"type": "image", "enabled": true, "url": "images/generated-7.png", "mode": "cover"}
  - rectangle «Scene Shade» width=1600 height=900 fill={"type": "gradient", "gradientType": "radial", "enabled": true, "rotation": 0, "size": {"width": 1.5, "height": 1.5}, "colors": [{"color"...
  - frame «Content» width=1600 height=778 layout="vertical" gap=24 padding=[28, 32, 24, 32]
    - frame «Header» width="fill_container" layout="vertical" gap=12
      - frame «Title Block» layout="vertical" gap=6
        - frame «Status» gap=8 alignItems="center"
          - text «Status Text» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: Carnet de vol · nouveau vol
        - frame «Title Row» gap=16 alignItems="center"
          - text «Title» fill="$text-primary" fontFamily="$font-display" fontSize=30 fontWeight="600"  TEXT: Saisir un vol à la main
          - frame «Verdict» gap=8 alignItems="center"
            - ellipse «Dot» width=7 height=7 stroke="$text-secondary" strokeWidth=1.5
            - text «Label» fill="$text-primary" fontFamily="$font-ui" fontSize=16 fontWeight="normal"  TEXT: Non vérifié
      - text «Intro» width=600 fill="$text-secondary" fontFamily="$font-ui" fontSize=16 fontWeight="normal"  TEXT: Pour un vol fait sans le pont SimConnect. Rien n'est mesuré : le vol est enregistré comme non vérifié et payé à 60 % de son gain net.
    - frame «Body» width="fill_container" justifyContent="space_between"
      - ref «Flight Form» width=968 ref="bibzm" descendants={"e0veVE": {"content": "Vol à déclarer"}, "A9Tx2K": {"content": "Heures en UTC", "fill": "$text-tertiary"}, "q5ftx0": {"gap": 0, "padding...  (instance of «Panel»)
      - ref «Pay Preview» width=420 height="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Aperçu de la paie"}, "A9Tx2K": {"content": "Estimation", "fill": "$text-tertiary"}, "q5ftx0": {"gap": 18, "paddin...  (instance of «Panel»)
  - ref «HUD Top» ref="a93UHQ" descendants={"Uth8f": {"stroke": {"type": "color", "color": "$text-primary", "enabled": false}}, "Ely3m": {"fill": "$text-tertiary"}, "oRNeg": {"stro...  (instance of «HUD/Top»)
  - ref «HUD Bottom» ref="t2yhjE" descendants={"D3kro/Mw53t": {"content": "Échap"}, "XuZbG": {"content": "Annuler"}, "msx5l/Mw53t": {"content": "Tab"}, "sA5qV": {"content": "Champ sui...  (instance of «HUD/Bottom»)
