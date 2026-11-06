# Réglages

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «Réglages» width=1600 height=900 layout="none" fill="$bg" clip=true
  - frame «Scene 3D» width=1600 height=900 fill={"type": "image", "enabled": true, "url": "images/generated-1.png", "mode": "cover"}
  - rectangle «Scene Shade» width=1600 height=900 fill={"type": "gradient", "gradientType": "radial", "enabled": true, "rotation": 0, "size": {"width": 1.5, "height": 1.5}, "colors": [{"color"...
  - frame «Content» width=1600 height=778 gap=64 padding=[28, 32, 24, 32]
    - frame «Settings Nav» width=220 layout="vertical" gap=28
      - frame «Title Block» layout="vertical" gap=6
        - frame «Status» gap=8 alignItems="center"
          - text «Status Text» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: Compte lmoreau · serveur global
        - text «Title» fill="$text-primary" fontFamily="$font-display" fontSize=30 fontWeight="600"  TEXT: Réglages
      - frame «Nav List» width="fill_container" layout="vertical"
        - frame «Nav · Clés API» width="fill_container" padding=[11, 16] stroke="$text-primary" strokeWidth={"left": 2}
          - text «Label» fill="$text-primary" fontFamily="$font-ui" fontSize=15 fontWeight="500"  TEXT: Clés API
        - frame «Nav · Compte et données» width="fill_container" padding=[11, 16] stroke="$border-strong" strokeWidth={"left": 2}
          - text «Label» fill="$text-secondary" fontFamily="$font-ui" fontSize=15 fontWeight="500"  TEXT: Compte et données
    - frame «Keys Column» width=760 height="fill_container" layout="vertical"
      - ref «Panel · Clés API» width="fill_container" ref="bibzm" descendants={"uBW0Z": {"padding": [26, 28, 0, 28]}, "e0veVE": {"content": "Clés API du pont simulateur", "fontSize": 20}, "A9Tx2K": {"content": "4 su...  (instance of «Panel»)
  - ref «HUD Top» ref="a93UHQ" descendants={"Uth8f": {"stroke": {"type": "color", "color": "$text-primary", "enabled": false}}, "Ely3m": {"fill": "$text-tertiary"}, "fE3Q9": {"stro...  (instance of «HUD/Top»)
  - ref «HUD Bottom» ref="t2yhjE" descendants={"D3kro/Mw53t": {"content": "Échap"}, "XuZbG": {"content": "Retour"}, "msx5l/Mw53t": {"content": "N"}, "sA5qV": {"content": "Nouvelle clé...  (instance of «HUD/Bottom»)
