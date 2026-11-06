# HUD/Bottom

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «HUD/Bottom» width=1600 height=46 padding=[0, 32] alignItems="center" justifyContent="space_between" fill={"type": "gradient", "gradientType": "linear", "enabled": true, "rotation": 0, "size": {"height": 1}, "colors": [{"color": "#000000F0", "... reusable=true
  - frame «Status» gap=28 alignItems="center"
    - frame «Bridge» gap=8 alignItems="center"
      - ellipse «Bridge Dot» width=7 height=7 fill="$success"
      - text «Bridge Label» fill="$text-secondary" fontFamily="$font-ui" fontSize=12 fontWeight="500"  TEXT: Pont SimConnect
      - text «Bridge Value» fill="$text-tertiary" fontFamily="$font-ui" fontSize=12  TEXT: Connecté · MSFS 2024
    - frame «Season» gap=8 alignItems="center"
      - icon «Season Icon» width=14 height=14 fill="$text-tertiary" icon="calendar-clock"
      - text «Season Label» fill="$text-secondary" fontFamily="$font-ui" fontSize=12 fontWeight="500"  TEXT: Saison de novembre
      - text «Season Value» fill="$text-tertiary" fontFamily="$font-ui" fontSize=12  TEXT: encore 25 jours
  - frame «Hints» gap=22 alignItems="center"
    - frame «Hint · RETOUR» gap=8 alignItems="center"
      - ref «Key» ref="T9v0n" descendants={"Mw53t": {"content": "Échap"}}  (instance of «Keycap»)
      - text «Hint Label» fill="$text-secondary" fontFamily="$font-ui" fontSize=12  TEXT: RETOUR
    - frame «Hint · FILTRES» gap=8 alignItems="center"
      - ref «Key» ref="T9v0n" descendants={"Mw53t": {"content": "Tab"}}  (instance of «Keycap»)
      - text «Hint Label» fill="$text-secondary" fontFamily="$font-ui" fontSize=12  TEXT: FILTRES
    - frame «Hint · SÉLECTIONNER» gap=8 alignItems="center"
      - ref «Key» ref="T9v0n" descendants={"Mw53t": {"content": "Entrée"}}  (instance of «Keycap»)
      - text «Hint Label» fill="$text-secondary" fontFamily="$font-ui" fontSize=12  TEXT: SÉLECTIONNER
    - frame «Hint · AIDE» gap=8 alignItems="center"
      - ref «Key» ref="T9v0n" descendants={"Mw53t": {"content": "F1"}}  (instance of «Keycap»)
      - text «Hint Label» fill="$text-secondary" fontFamily="$font-ui" fontSize=12  TEXT: Aide
