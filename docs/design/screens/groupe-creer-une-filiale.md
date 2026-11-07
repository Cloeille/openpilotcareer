# Groupe · créer une filiale

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «Groupe · créer une filiale» width=1600 height=900 layout="none" fill="$bg" clip=true
  - frame «Scene 3D» width=1600 height=900 fill={"type": "image", "enabled": true, "url": "images/generated-3.png", "mode": "cover"}
  - rectangle «Scene Shade» width=1600 height=900 fill={"type": "gradient", "gradientType": "radial", "enabled": true, "rotation": 0, "size": {"width": 1.5, "height": 1.5}, "colors": [{"color"...
  - frame «Content» width=1600 height=778 layout="vertical" gap=24 padding=[28, 32, 24, 32]
    - frame «Header» width="fill_container" alignItems="end"
      - frame «Title Block» layout="vertical" gap=8
        - frame «Status» gap=10 alignItems="center"
          - ref «Sign · LFKJ» ref="pirBQ" descendants={"OYKAu": {"content": "LFKJ"}}  (instance of «Sign/Location»)
          - text «Status Text» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: Nouvelle filiale d'Azur Régional · base d'Ajaccio
        - text «Title» fill="$text-primary" fontFamily="$font-display" fontSize=30 fontWeight="600"  TEXT: Corse Navette
    - frame «Body» width="fill_container" height="fill_container" gap=24
      - ref «Panel · Identité» width=340 height="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Identité"}, "A9Tx2K": {"enabled": false}, "q5ftx0": {"height": "fill_container", "gap": 18, "padding": [14, 22, 2...  (instance of «Panel»)
      - ref «Panel · Dotation de départ» width="fill_container" height="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Dotation de départ"}, "A9Tx2K": {"content": "Ce qu'Azur Régional lui apporte", "fill": "$text-tertiary", "fontWei...  (instance of «Panel»)
      - ref «Panel · Effet sur les soldes» width=360 height="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Effet sur les deux sociétés"}, "A9Tx2K": {"enabled": false}, "q5ftx0": {"height": "fill_container", "gap": 0, "pa...  (instance of «Panel»)
  - ref «HUD Top» ref="a93UHQ" descendants={"Uth8f": {"stroke": "#00000000"}, "Ely3m": {"fill": "$text-tertiary"}, "daIvj": {"stroke": "$text-primary"}, "cXwn0": {"fill": "$text-pr...  (instance of «HUD/Top»)
  - ref «HUD Bottom» ref="t2yhjE" descendants={"XuZbG": {"content": "Annuler"}, "msx5l/Mw53t": {"content": "← →"}, "sA5qV": {"content": "Modifier le montant ou le choix"}, "T7rBqn": {...  (instance of «HUD/Bottom»)
