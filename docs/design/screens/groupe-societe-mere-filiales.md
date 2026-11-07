# Groupe · société mère & filiales

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «Groupe · société mère & filiales» width=1600 height=900 layout="none" fill="$bg" clip=true
  - frame «Scene 3D» width=1600 height=900 fill={"type": "image", "enabled": true, "url": "images/generated-2.png", "mode": "cover"}
  - rectangle «Scene Shade» width=1600 height=900 fill={"type": "gradient", "gradientType": "radial", "enabled": true, "rotation": 0, "size": {"width": 1.5, "height": 1.5}, "colors": [{"color"...
  - frame «Content» width=1600 height=778 layout="vertical" gap=24 padding=[28, 32, 24, 32]
    - frame «Header» width="fill_container" alignItems="end" justifyContent="space_between"
      - frame «Title Block» layout="vertical" gap=6
        - text «Status Text» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: Azur Régional · 1 filiale · siège à Nice
        - text «Title» fill="$text-primary" fontFamily="$font-display" fontSize=30 fontWeight="600"  TEXT: Société mère et filiales
      - ref «Button · Comptes détaillés» ref="n9Pulf" descendants={"RUCj0": {"content": "Comptes détaillés"}}  (instance of «Button/Ghost»)
    - frame «Body» width="fill_container" height="fill_container" gap=24
      - ref «Panel · Structure du groupe» width="fill_container" height="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Structure du groupe"}, "A9Tx2K": {"content": "Comptes au 6 novembre", "fill": "$text-tertiary", "fontWeight": "no...  (instance of «Panel»)
      - ref «Panel · Flux internes» width=420 height="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Flux internes de novembre"}, "A9Tx2K": {"content": "Au 6 nov.", "fill": "$text-tertiary", "fontWeight": "normal"}...  (instance of «Panel»)
  - ref «HUD Top» ref="a93UHQ" descendants={"Uth8f": {"stroke": "#00000000"}, "Ely3m": {"fill": "$text-tertiary"}, "daIvj": {"stroke": "$text-primary"}, "cXwn0": {"fill": "$text-pr...  (instance of «HUD/Top»)
  - ref «HUD Bottom» ref="t2yhjE" descendants={"XuZbG": {"content": "Retour"}, "msx5l/Mw53t": {"content": "↑ ↓"}, "sA5qV": {"content": "Changer de société"}, "T7rBqn": {"content": "Ou...  (instance of «HUD/Bottom»)
