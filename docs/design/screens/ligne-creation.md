# Ligne · création

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «Ligne · création» width=1600 height=900 layout="none" fill="$bg" clip=true
  - frame «Scene 3D» width=1600 height=900 fill={"type": "image", "enabled": true, "url": "images/generated-3.png", "mode": "cover"}
  - rectangle «Scene Shade» width=1600 height=900 fill={"type": "gradient", "gradientType": "radial", "enabled": true, "rotation": 0, "size": {"width": 1.5, "height": 1.5}, "colors": [{"color"...
  - frame «Content» width=1600 height=778 layout="vertical" gap=20 padding=[24, 32, 20, 32]
    - frame «Header» width="fill_container" alignItems="end" justifyContent="space_between"
      - frame «Title Block» layout="vertical" gap=6
        - text «Kicker» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="normal"  TEXT: Nouvelle ligne autonome · Azur Régional
        - text «Title» fill="$text-primary" fontFamily="$font-display" fontSize=34 fontWeight="600"  TEXT: Nice → Barcelone
        - text «Subtitle» fill="$text-tertiary" fontFamily="$font-ui" fontSize=14 fontWeight="normal"  TEXT: 262 NM · 1 h 20 de vol · première rotation possible lun. 9 novembre
      - frame «Route Picker» gap=8 alignItems="end"
        - frame «Field · Départ» layout="vertical" gap=7
          - text «Label» fill="$text-secondary" fontFamily="$font-ui" fontSize=13 fontWeight="500"  TEXT: Départ
          - frame «Box» width=270 height=48 gap=12 padding=[0, 12, 0, 8] alignItems="center" fill="$surface-sunken" stroke="$border-strong" strokeWidth=1 cornerRadius=3
            - ref «Sign» ref="pirBQ" descendants={"OYKAu": {"content": "LFMN"}}  (instance of «Sign/Location»)
            - text «Airport» width="fill_container" fill="$text-primary" fontFamily="$font-ui" fontSize=15 fontWeight="500"  TEXT: Nice Côte d'Azur
            - icon «Chevron» width=16 height=16 fill="$text-tertiary" icon="chevron-down"
        - frame «Swap» width=40 height=48 alignItems="center" justifyContent="center"
          - icon «Swap Icon» width=18 height=18 fill="$text-secondary" icon="arrow-left-right"
        - frame «Field · Arrivée» layout="vertical" gap=7
          - text «Label» fill="$text-secondary" fontFamily="$font-ui" fontSize=13 fontWeight="500"  TEXT: Arrivée
          - frame «Box» width=270 height=48 gap=12 padding=[0, 12, 0, 8] alignItems="center" fill="$surface-sunken" stroke="$border-strong" strokeWidth=1 cornerRadius=3
            - ref «Sign» ref="pirBQ" descendants={"OYKAu": {"content": "LEBL"}}  (instance of «Sign/Location»)
            - text «Airport» width="fill_container" fill="$text-primary" fontFamily="$font-ui" fontSize=15 fontWeight="500"  TEXT: Barcelone-El Prat
            - icon «Chevron» width=16 height=16 fill="$text-tertiary" icon="chevron-down"
    - frame «Body» width="fill_container" height="fill_container" gap=20
      - ref «Schedule Builder» width="fill_container" height="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Programme de la ligne"}, "A9Tx2K": {"content": "Reprendre le programme d'une autre ligne"}, "q5ftx0": {"height": ...  (instance of «Panel»)
      - ref «Requirements & Forecast» width=380 height="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Ce que ça demande"}, "A9Tx2K": {"enabled": false}, "q5ftx0": {"height": "fill_container", "gap": 14, "children": ...  (instance of «Panel»)
  - ref «HUD Top» ref="a93UHQ" descendants={"Uth8f": {"stroke": "#00000000"}, "Ely3m": {"fill": "$text-tertiary"}, "zg3vi": {"stroke": "$text-primary"}, "O6CMm": {"fill": "$text-pr...  (instance of «HUD/Top»)
  - ref «HUD Bottom» ref="t2yhjE" descendants={"XuZbG": {"content": "Annuler"}, "msx5l/Mw53t": {"content": "Souris"}, "sA5qV": {"content": "Glisser un vol"}, "T7rBqn": {"content": "Ou...  (instance of «HUD/Bottom»)
