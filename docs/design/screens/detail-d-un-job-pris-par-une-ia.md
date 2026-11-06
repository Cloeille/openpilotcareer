# Détail d'un job · pris par une IA

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «Détail d'un job · pris par une IA» width=1600 height=900 layout="none" fill="$bg" clip=true x=6800 y=3000
  - frame «Scene 3D» width=1600 height=900 fill={"type": "image", "enabled": true, "url": "images/generated-4.png", "mode": "cover"} x=0 y=0
  - rectangle «Scene Shade» width=1600 height=900 fill={"type": "gradient", "gradientType": "radial", "enabled": true, "rotation": 0, "size": {"width": 1.5, "height": 1.5}, "colors": [{"color"... x=0 y=0
  - frame «Content» width=1600 height=778 gap=20 padding=[28, 32, 24, 32] x=0 y=76
    - frame «Briefing Column» width=620 height="fill_container" layout="vertical" gap=32
      - frame «Job Header» width="fill_container" layout="vertical" gap=12
        - frame «Title Block» layout="vertical" gap=6
          - frame «Status» gap=8 alignItems="center"
            - ellipse «Status Dot» width=7 height=7 fill="$danger"
            - text «Status Text» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: Job passagers · J-20915 · plus disponible
          - text «Title» fill="$text-primary" fontFamily="$font-display" fontSize=30 fontWeight="600"  TEXT: Nice → Rome-Fiumicino
        - text «Route Line» fill="$text-secondary" fontFamily="$font-ui" fontSize=16 fontWeight="normal"  TEXT: LFMN → LIRF · 254 NM · 46 passagers · 11 380 €
      - frame «Taken Notice» width="fill_container" layout="vertical" gap=10
        - text «Lead» fill="$text-primary" fontFamily="$font-display" fontSize=22 fontWeight="600"  TEXT: Méridia Cargo a pris ce job il y a 2 min.
        - text «Explanation» width="fill_container" fill="$text-secondary" fontFamily="$font-ui" fontSize=15 fontWeight="normal"  TEXT: Pendant que tu lisais le briefing, cette compagnie IA l'a accepté à 18:40Z. Un job accepté quitte le tableau : il n'est plus disponible pour personne. Ton ATR 42-600 F-HAZT reste libre à Nice.
        - ref «AI Company Link» ref="n9Pulf" descendants={"RUCj0": {"content": "Voir la fiche de Méridia Cargo"}}  (instance of «Button/Ghost»)
      - ref «Similar Jobs Panel» width="fill_container" ref="bibzm" descendants={"uBW0Z": {"padding": [24, 28, 4, 28]}, "e0veVE": {"content": "Jobs similaires"}, "A9Tx2K": {"content": "Au départ de LFMN · pour ton ATR...  (instance of «Panel»)
      - frame «Board Return» width="fill_container" gap=16 alignItems="center"
        - ref «Back to Board Button» ref="v6he7" descendants={"RU69u": {"icon": "arrow-left"}, "BxHlG": {"content": "Retour aux jobs"}}  (instance of «Button/Secondary»)
        - text «Board Count» fill="$text-tertiary" fontFamily="$font-ui" fontSize=14 fontWeight="normal"  TEXT: 42 offres au départ de Nice
  - ref «HUD Top» ref="a93UHQ" descendants={"Uth8f": {"stroke": "#00000000"}, "Ely3m": {"fill": "$text-tertiary"}, "wAYyl": {"stroke": "$text-primary"}, "VKGo6": {"fill": "$text-pr... x=0 y=0  (instance of «HUD/Top»)
  - ref «HUD Bottom» ref="t2yhjE" descendants={"oFiTj": {"name": "Hint · Retour aux jobs"}, "D3kro/Mw53t": {"content": "Échap"}, "XuZbG": {"content": "Retour aux jobs"}, "qtpFg": {"na... x=0 y=854  (instance of «HUD/Bottom»)
