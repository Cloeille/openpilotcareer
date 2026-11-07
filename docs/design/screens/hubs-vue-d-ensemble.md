# Hubs · vue d'ensemble

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «Hubs · vue d'ensemble» width=1600 height=900 layout="none" fill="$bg" clip=true
  - frame «Scene 3D» width=1600 height=900 fill={"type": "image", "enabled": true, "url": "images/generated-15.png", "mode": "cover"}
  - rectangle «Scene Shade» width=1600 height=900 fill={"type": "gradient", "gradientType": "radial", "enabled": true, "rotation": 0, "size": {"width": 1.5, "height": 1.5}, "colors": [{"color"...
  - frame «Content» width=1600 height=778 layout="vertical" gap=24 padding=[28, 32, 24, 32]
    - frame «Header» width="fill_container" alignItems="end" justifyContent="space_between"
      - frame «Title Block» layout="vertical" gap=6
        - text «Status Text» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: Azur Régional · 2 bases · 6 avions · 44 employés
        - text «Title» fill="$text-primary" fontFamily="$font-display" fontSize=30 fontWeight="600"  TEXT: Hubs et bases
      - ref «Stat · Coût des installations» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "Installations, toutes bases", "fill": "$text-tertiary"}, "GqS8d": {"content": "36 900 € / mois", "fontSize": 26},...  (instance of «Stat»)
    - frame «Hubs» width="fill_container" height="fill_container" gap=24
      - ref «Hub · LFMN» width="fill_container" height="fill_container" ref="bibzm" descendants={"uBW0Z": {"enabled": false}, "q5ftx0": {"height": "fill_container", "gap": 20, "padding": [24, 28, 20, 28], "children": [{"type": "frame...  (instance of «Panel»)
      - frame «Side Column» width=392 height="fill_container" layout="vertical" gap=24
        - ref «Base · LFLL» width="fill_container" ref="bibzm" descendants={"uBW0Z": {"enabled": false}, "q5ftx0": {"gap": 20, "padding": [24, 26, 20, 26], "children": [{"type": "frame", "id": "NwRvw", "name": "B...  (instance of «Panel»)
        - frame «Spacer» width="fill_container" height="fill_container"
        - frame «Opportunity» width="fill_container" layout="vertical" gap=12 padding=[0, 4]
          - frame «Opportunity Head» gap=10 alignItems="center"
            - ref «Sign · LFKJ» ref="B3YF1" descendants={"gljan": {"content": "LFKJ"}}  (instance of «Sign/Direction»)
            - text «Label» fill="$text-primary" fontFamily="$font-display" fontSize=18 fontWeight="600"  TEXT: Ouvrir une base à Ajaccio
          - text «Text» width="fill_container" fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="normal"  TEXT: Tu opères déjà 12 vols par semaine vers Ajaccio. Un bureau d'escale et 2 postes y sont libres : tes équipages pourraient y passer la nuit au lieu de rentrer à vide.
          - frame «Opportunity Footer» width="fill_container" alignItems="center" justifyContent="space_between"
            - text «Cost» fill="$text-primary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: dès 5 400 € / mois
            - ref «Button · Étudier» ref="n9Pulf" descendants={"RUCj0": {"content": "Étudier l'ouverture"}}  (instance of «Button/Ghost»)
  - ref «HUD Top» ref="a93UHQ" descendants={"Uth8f": {"stroke": "#00000000"}, "Ely3m": {"fill": "$text-tertiary"}, "daIvj": {"stroke": "$text-primary"}, "cXwn0": {"fill": "$text-pr...  (instance of «HUD/Top»)
  - ref «HUD Bottom» ref="t2yhjE" descendants={"D3kro/Mw53t": {"content": "Échap"}, "XuZbG": {"content": "Retour"}, "msx5l/Mw53t": {"content": "← →"}, "sA5qV": {"content": "Changer de...  (instance of «HUD/Bottom»)
