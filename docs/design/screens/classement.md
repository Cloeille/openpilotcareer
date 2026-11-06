# Classement

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «Classement» width=1600 height=900 layout="none" fill="$bg" clip=true x=0 y=6300
  - frame «Scene 3D» width=1600 height=900 fill={"type": "image", "enabled": true, "url": "images/generated-9.png", "mode": "cover"} x=0 y=0
  - rectangle «Scene Shade» width=1600 height=900 fill={"type": "gradient", "gradientType": "radial", "enabled": true, "rotation": 0, "size": {"width": 1.5, "height": 1.5}, "colors": [{"color"... x=0 y=0
  - frame «Content» width=1600 height=778 gap=56 padding=[28, 32, 24, 32] justifyContent="space_between" x=0 y=76
    - frame «Leaderboard Column» width=880 height="fill_container" layout="vertical" justifyContent="space_between"
      - frame «Title Block» width="fill_container" layout="vertical" gap=6
        - frame «Status» gap=8 alignItems="center"
          - text «Status Text» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: Saison de novembre · jour 5 sur 30 · remise à zéro le 1er décembre
        - text «Title» fill="$text-primary" fontFamily="$font-display" fontSize=30 fontWeight="600"  TEXT: Classement
      - frame «Table Group» width="fill_container" layout="vertical" gap=16
        - frame «Toolbar» width="fill_container" alignItems="center" justifyContent="space_between"
          - frame «Sort» gap=4 alignItems="center"
            - frame «Sort · Valeur nette» gap=8 padding=[8, 12] alignItems="center" fill="$surface-hover" cornerRadius=4
              - ref «Key» ref="T9v0n" descendants={"Mw53t": {"content": "1"}}  (instance of «Keycap»)
              - text «Label» fill="$text-primary" fontFamily="$font-ui" fontSize=15 fontWeight="500"  TEXT: Valeur nette
            - frame «Sort · Vols» gap=8 padding=[8, 12] alignItems="center" cornerRadius=4
              - ref «Key» ref="T9v0n" descendants={"Mw53t": {"content": "2"}}  (instance of «Keycap»)
              - text «Label» fill="$text-secondary" fontFamily="$font-ui" fontSize=15 fontWeight="500"  TEXT: Vols
            - frame «Sort · Réputation» gap=8 padding=[8, 12] alignItems="center" cornerRadius=4
              - ref «Key» ref="T9v0n" descendants={"Mw53t": {"content": "3"}}  (instance of «Keycap»)
              - text «Label» fill="$text-secondary" fontFamily="$font-ui" fontSize=15 fontWeight="500"  TEXT: Réputation
          - frame «Scope» gap=10 alignItems="center"
            - ref «Key» ref="T9v0n" descendants={"Mw53t": {"content": "Tab"}}  (instance of «Keycap»)
            - frame «Scope Toggle» gap=2 padding=2 alignItems="center" fill="$surface" stroke="$border" strokeWidth=1 cornerRadius=4 effect={"type": "background_blur", "radius": 28}
              - frame «Scope · Saison» padding=[6, 14] fill="$surface-hover" cornerRadius=3
                - text «Label» fill="$text-primary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: Saison
              - frame «Scope · Carrière» padding=[6, 14] cornerRadius=3
                - text «Label» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: Carrière
        - ref «Leaderboard» width="fill_container" ref="bibzm" descendants={"uBW0Z": {"enabled": false}, "e0veVE": {"content": "Classement général"}, "A9Tx2K": {"content": "24 compagnies", "fill": "$text-tertiary...  (instance of «Panel»)
    - frame «Selection Column» width=340 height="fill_container" layout="vertical" justifyContent="end"
      - ref «Selected Company» width="fill_container" ref="bibzm" descendants={"G3dgU": {"fill": "$info", "enabled": false}, "e0veVE": {"content": "Alpes Air Link", "fontSize": 20}, "A9Tx2K": {"content": "6e", "fill...  (instance of «Panel»)
  - ref «HUD Top» ref="a93UHQ" descendants={"Uth8f": {"stroke": {"type": "color", "color": "$text-primary", "enabled": false}}, "Ely3m": {"fill": "$text-tertiary"}, "Btj9I": {"stro... x=0 y=0  (instance of «HUD/Top»)
  - ref «HUD Bottom» ref="t2yhjE" descendants={"oFiTj": {"name": "Hint · Tableau de bord"}, "D3kro/Mw53t": {"content": "Échap"}, "XuZbG": {"content": "Tableau de bord"}, "qtpFg": {"na... x=0 y=854  (instance of «HUD/Bottom»)
