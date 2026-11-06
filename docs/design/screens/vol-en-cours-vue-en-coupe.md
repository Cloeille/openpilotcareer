# Vol en cours · vue en coupe

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «Vol en cours · vue en coupe» width=1600 height=900 layout="none" fill="$bg" clip=true
  - frame «Backdrop» width=1600 height=900 fill=["#07090C", {"type": "gradient", "gradientType": "radial", "enabled": true, "rotation": 0, "size": {"width": 1.3, "height": 1.1}, "colors...
  - rectangle «Scene Shade» width=1600 height=900 fill={"type": "gradient", "gradientType": "radial", "enabled": true, "rotation": 0, "size": {"width": 1.6, "height": 1.6}, "colors": [{"color"...
  - frame «Content» width=1600 height=778 layout="vertical" gap=12 padding=[28, 32, 24, 32]
    - frame «Main» width="fill_container" height="fill_container" layout="vertical" gap=12
      - frame «Live Header» width="fill_container" alignItems="end" justifyContent="space_between"
        - frame «Title Block» layout="vertical" gap=6
          - frame «Status» gap=8 alignItems="center"
            - ellipse «Live Dot» width=7 height=7 fill="$route"
            - text «Status Text» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: AZR 4127 · en croisière
          - text «Title» fill="$text-primary" fontFamily="$font-display" fontSize=30 fontWeight="600"  TEXT: Nice → Paris-Charles de Gaulle
        - ref «View Switcher» ref="a7ZUZ"  (instance of «View Switcher»)
      - frame «Cutaway Area» width="fill_container" height="fill_container" layout="none"
        - script «Aircraft Schematic» width=1536 height=588
      - frame «Facts» width="fill_container" gap=56 padding=[0, 0, 4, 0] alignItems="end"
        - frame «Fact · Altitude» layout="vertical" gap=4
          - text «Fact Label» fill="$text-tertiary" fontFamily="$font-ui" fontSize=13  TEXT: Altitude
          - text «Fact Value» fill="$text-primary" fontFamily="$font-display" fontSize=26 fontWeight="500"  TEXT: FL240
        - frame «Fact · Vitesse sol» layout="vertical" gap=4
          - text «Fact Label» fill="$text-tertiary" fontFamily="$font-ui" fontSize=13  TEXT: Vitesse sol
          - text «Fact Value» fill="$text-primary" fontFamily="$font-display" fontSize=26 fontWeight="500"  TEXT: 412 kt
        - frame «Fact · Arrivée prévue» layout="vertical" gap=4
          - text «Fact Label» fill="$text-tertiary" fontFamily="$font-ui" fontSize=13  TEXT: Arrivée prévue
          - text «Fact Value» fill="$text-primary" fontFamily="$font-display" fontSize=26 fontWeight="500"  TEXT: 18:42Z
        - frame «Fact · Carburant» layout="vertical" gap=4
          - text «Fact Label» fill="$text-tertiary" fontFamily="$font-ui" fontSize=13  TEXT: Carburant
          - text «Fact Value» fill="$text-primary" fontFamily="$font-display" fontSize=26 fontWeight="500"  TEXT: 2 140 kg
        - frame «Facts Spacer» width="fill_container" height=1
        - frame «Verification» gap=8 alignItems="center"
          - icon «Verif Icon» width=15 height=15 fill="$text-tertiary" icon="scan-line"
          - text «Verif Text» fill="$text-secondary" fontFamily="$font-ui" fontSize=14  TEXT: Vérification en cours · aucune anomalie
  - ref «HUD Top» ref="a93UHQ" descendants={"Uth8f": {"stroke": "#00000000"}, "Ely3m": {"fill": "$text-tertiary"}, "W1uf3B": {"stroke": "$text-primary"}, "DbACz": {"fill": "$text-p...  (instance of «HUD/Top»)
  - ref «HUD Bottom» ref="t2yhjE" descendants={"D3kro/Mw53t": {"content": "Échap"}, "XuZbG": {"content": "Tableau de bord"}, "msx5l/Mw53t": {"content": "V"}, "sA5qV": {"content": "Cha...  (instance of «HUD/Bottom»)
