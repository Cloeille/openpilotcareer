# Opérations · centre 24/7

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «Opérations · centre 24/7» width=1600 height=900 layout="none" fill="$bg" clip=true
  - frame «Scene 3D» width=1600 height=900 fill={"type": "image", "enabled": true, "url": "images/generated-7.png", "mode": "cover"}
  - rectangle «Scene Shade» width=1600 height=900 fill={"type": "gradient", "gradientType": "radial", "enabled": true, "rotation": 0, "size": {"width": 1.5, "height": 1.5}, "colors": [{"color"...
  - frame «Content» width=1600 height=778 layout="vertical" gap=22 padding=[28, 32, 24, 32]
    - frame «Ops Header» width="fill_container" alignItems="end" justifyContent="space_between"
      - frame «Title Block» layout="vertical" gap=6
        - frame «Status» gap=8 alignItems="center"
          - ellipse «Live Dot» width=7 height=7 fill="$success"
          - text «Status Text» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: Exploitation automatique · 4 avions sur 6 en service
        - text «Title» fill="$text-primary" fontFamily="$font-display" fontSize=30 fontWeight="600"  TEXT: Centre des opérations
      - frame «Clock Group» gap=28 alignItems="end"
        - frame «Auto Ops» gap=10 padding=[0, 0, 9, 0] alignItems="center"
          - ref «Auto Ops Switch» ref="IPgaP"  (instance of «Switch»)
          - text «Auto Ops Label» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="normal"  TEXT: Exploitation 24/7
        - rectangle «Clock Divider» width=1 height=48 fill="$border-strong"
        - frame «Simulated Clock» layout="vertical" alignItems="end"
          - text «Clock Label» fill="$text-tertiary" fontFamily="$font-ui" fontSize=12 fontWeight="normal"  TEXT: Horloge simulée · ven. 6 novembre
          - text «Clock Time» fill="$text-primary" fontFamily="$font-display" fontSize=40 fontWeight="500"  TEXT: 17:58Z
    - frame «Ops Body» width="fill_container" height="fill_container" gap=20
      - ref «Panel · Tableau des vols» width="fill_container" height="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Tableau des vols"}, "A9Tx2K": {"content": "Planning complet"}, "q5ftx0": {"height": "fill_container", "gap": 18, ...  (instance of «Panel»)
  - ref «HUD Top» ref="a93UHQ" descendants={"Uth8f": {"stroke": "#00000000"}, "Ely3m": {"fill": "$text-tertiary"}, "zg3vi": {"stroke": "$text-primary"}, "O6CMm": {"fill": "$text-pr...  (instance of «HUD/Top»)
  - ref «HUD Bottom» ref="t2yhjE"  (instance of «HUD/Bottom»)
