# Réglages · compte & données

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «Réglages · compte & données» width=1600 height=900 layout="none" fill="$bg" clip=true x=3400 y=800
  - frame «Scene 3D» width=1600 height=900 fill={"type": "image", "enabled": true, "url": "images/generated-1.png", "mode": "cover"} x=0 y=0
  - rectangle «Scene Shade» width=1600 height=900 fill={"type": "gradient", "gradientType": "radial", "enabled": true, "rotation": 0, "size": {"width": 1.5, "height": 1.5}, "colors": [{"color"... x=0 y=0
  - frame «Content» width=1600 height=778 gap=64 padding=[28, 32, 24, 32] x=0 y=76
    - frame «Settings Nav» width=220 layout="vertical" gap=28
      - frame «Title Block» layout="vertical" gap=6
        - frame «Status» gap=8 alignItems="center"
          - text «Status Text» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: Compte lmoreau · serveur global
        - text «Title» fill="$text-primary" fontFamily="$font-display" fontSize=30 fontWeight="600"  TEXT: Réglages
      - frame «Nav List» width="fill_container" layout="vertical"
        - frame «Nav · Clés API» width="fill_container" padding=[11, 16] stroke="$border-strong" strokeWidth={"left": 2}
          - text «Label» fill="$text-secondary" fontFamily="$font-ui" fontSize=15 fontWeight="500"  TEXT: Clés API
        - frame «Nav · Compte et données» width="fill_container" padding=[11, 16] stroke="$text-primary" strokeWidth={"left": 2}
          - text «Label» fill="$text-primary" fontFamily="$font-ui" fontSize=15 fontWeight="500"  TEXT: Compte et données
    - frame «Center Column» width=620 height="fill_container" layout="vertical" justifyContent="space_between"
      - ref «Panel · Export» width="fill_container" ref="bibzm" descendants={"uBW0Z": {"padding": [26, 28, 0, 28]}, "e0veVE": {"content": "Exporter tes données", "fontSize": 20}, "A9Tx2K": {"content": "JSON · CSV"...  (instance of «Panel»)
      - ref «Panel · Suppression du compte» width="fill_container" stroke="$border" ref="bibzm" descendants={"uBW0Z": {"padding": [26, 28, 0, 28]}, "G3dgU": {"fill": "$danger"}, "e0veVE": {"content": "Supprimer le compte", "fontSize": 20}, "A9Tx...  (instance of «Panel»)
    - frame «Account Column» width=400 height="fill_container" layout="vertical"
      - ref «Panel · Serveur» width="fill_container" ref="bibzm" descendants={"uBW0Z": {"padding": [26, 28, 0, 28]}, "e0veVE": {"content": "Serveur", "fontSize": 20}, "A9Tx2K": {"content": "Changer", "fontSize": 14...  (instance of «Panel»)
  - ref «HUD Top» ref="a93UHQ" descendants={"Uth8f": {"stroke": {"type": "color", "color": "$text-primary", "enabled": false}}, "Ely3m": {"fill": "$text-tertiary"}, "fE3Q9": {"stro... x=0 y=0  (instance of «HUD/Top»)
  - ref «HUD Bottom» ref="t2yhjE" descendants={"D3kro/Mw53t": {"content": "Échap"}, "XuZbG": {"content": "Retour"}, "msx5l/Mw53t": {"content": "Tab"}, "sA5qV": {"content": "Section su... x=0 y=854  (instance of «HUD/Bottom»)
