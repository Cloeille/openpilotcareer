# Classement · nouvelle saison

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «Classement · nouvelle saison» width=1600 height=900 layout="none" fill="$bg" clip=true x=6800 y=6300
  - frame «Scene 3D» width=1600 height=900 fill={"type": "image", "enabled": true, "url": "images/generated-9.png", "mode": "cover"} x=0 y=0
  - rectangle «Scene Shade» width=1600 height=900 fill={"type": "gradient", "gradientType": "radial", "enabled": true, "rotation": 0, "size": {"width": 1.5, "height": 1.5}, "colors": [{"color"... x=0 y=0
  - frame «Content» width=1600 height=778 gap=56 padding=[28, 32, 24, 32] justifyContent="space_between" x=0 y=76
    - frame «Leaderboard Column» width=880 height="fill_container" layout="vertical" justifyContent="space_between"
      - frame «Title Block» width="fill_container" layout="vertical" gap=6
        - frame «Status» gap=8 alignItems="center"
          - text «Status Text» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: Saison de décembre · jour 1 sur 31 · remise à zéro le 1er janvier
        - text «Title» fill="$text-primary" fontFamily="$font-display" fontSize=30 fontWeight="600"  TEXT: Classement
      - frame «Table Group» width="fill_container" layout="vertical" gap=16
        - frame «Toolbar» width="fill_container" alignItems="center" justifyContent="space_between"
          - frame «Sort» gap=4 alignItems="center"
            - frame «Sort · Gain de saison» gap=8 padding=[8, 12] alignItems="center" fill="$surface-hover" cornerRadius=4
              - ref «Key» ref="T9v0n" descendants={"Mw53t": {"content": "1"}}  (instance of «Keycap»)
              - text «Label» fill="$text-primary" fontFamily="$font-ui" fontSize=15 fontWeight="500"  TEXT: Gain de saison
            - frame «Sort · Vols» gap=8 padding=[8, 12] alignItems="center" cornerRadius=4
              - ref «Key» ref="T9v0n" descendants={"Mw53t": {"content": "2"}}  (instance of «Keycap»)
              - text «Label» fill="$text-secondary" fontFamily="$font-ui" fontSize=15 fontWeight="500"  TEXT: Vols
            - frame «Sort · Valeur nette» gap=8 padding=[8, 12] alignItems="center" cornerRadius=4
              - ref «Key» ref="T9v0n" descendants={"Mw53t": {"content": "3"}}  (instance of «Keycap»)
              - text «Label» fill="$text-secondary" fontFamily="$font-ui" fontSize=15 fontWeight="500"  TEXT: Valeur nette
          - frame «Scope» gap=10 alignItems="center"
            - ref «Key» ref="T9v0n" descendants={"Mw53t": {"content": "Tab"}}  (instance of «Keycap»)
            - frame «Scope Toggle» gap=2 padding=2 alignItems="center" fill="$surface" stroke="$border" strokeWidth=1 cornerRadius=4 effect={"type": "background_blur", "radius": 28}
              - frame «Scope · Saison» padding=[6, 14] fill="$surface-hover" cornerRadius=3
                - text «Label» fill="$text-primary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: Saison
              - frame «Scope · Carrière» padding=[6, 14] cornerRadius=3
                - text «Label» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: Carrière
        - ref «Leaderboard» width="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Tout le monde repart de zéro"}, "A9Tx2K": {"content": "Valeur nette carrière, pour référence", "fill": "$text-ter...  (instance of «Panel»)
    - frame «Selection Column» width=340 height="fill_container" layout="vertical" justifyContent="end"
      - ref «Selected Company» width="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Ibérica Sol", "fontSize": 20}, "A9Tx2K": {"content": "2e en novembre", "fill": "$text-tertiary", "fontFamily": "$...  (instance of «Panel»)
  - ref «HUD Top» ref="a93UHQ" descendants={"Uth8f": {"stroke": {"type": "color", "color": "$text-primary", "enabled": false}}, "Ely3m": {"fill": "$text-tertiary"}, "Btj9I": {"stro... x=0 y=0  (instance of «HUD/Top»)
  - ref «HUD Bottom» ref="t2yhjE" descendants={"xYqJx": {"content": "Saison de décembre"}, "N4OGhY": {"content": "encore 30 jours"}, "oFiTj": {"name": "Hint · Tableau de bord"}, "D3kr... x=0 y=854  (instance of «HUD/Bottom»)
