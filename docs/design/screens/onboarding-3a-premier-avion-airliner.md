# Onboarding · 3a premier avion (airliner)

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «Onboarding · 3a premier avion (airliner)» width=1600 height=900 layout="none" fill="$bg" clip=true
  - frame «Scene 3D» width=1600 height=900 fill={"type": "image", "enabled": true, "url": "images/generated-6.png", "mode": "cover"}
  - rectangle «Scene Shade» width=1600 height=900 fill={"type": "gradient", "gradientType": "radial", "enabled": true, "rotation": 0, "size": {"width": 1.5, "height": 1.5}, "colors": [{"color"...
  - frame «Content» width=1600 height=778 layout="vertical" gap=36 padding=[40, 64, 36, 64]
    - frame «Title Block» layout="vertical" gap=8
      - text «Overline» fill="$text-secondary" fontFamily="$font-ui" fontSize=15 fontWeight="normal"  TEXT: Parcours airliner · premier avion
      - text «Title» fill="$text-primary" fontFamily="$font-display" fontSize=52 fontWeight="600"  TEXT: Loue ton premier avion
      - text «Sub» width=720 fill="$text-secondary" fontFamily="$font-ui" fontSize=16 fontWeight="normal"  TEXT: Trois loueurs peuvent livrer un appareil à ton hub sous 48 h. Tu paies un loyer chaque mois au lieu d'acheter : ton capital reste disponible pour le carburant, les équipages et les imprévus.
    - frame «Main Row» width="fill_container" height="fill_container" gap=24
      - ref «Panel · Offres de location» width="fill_container" height="fill_container" ref="bibzm" descendants={"uBW0Z": {"padding": [22, 26, 6, 26]}, "e0veVE": {"content": "Offres de location", "fontSize": 20}, "A9Tx2K": {"content": "3 offres · lo...  (instance of «Panel»)
      - ref «Panel · Offre sélectionnée» width=452 height="fill_container" ref="bibzm" descendants={"uBW0Z": {"enabled": false}, "q5ftx0": {"padding": [26, 28], "gap": 22, "height": "fill_container", "children": [{"type": "frame", "id":...  (instance of «Panel»)
    - frame «Footer» width="fill_container" alignItems="center" justifyContent="space_between"
      - frame «Footer Left» gap=24 alignItems="center"
        - ref «Buy On Credit» ref="n9Pulf" descendants={"RUCj0": {"content": "Acheter à crédit plutôt"}}  (instance of «Button/Ghost»)
        - text «Footer Note» fill="$text-tertiary" fontFamily="$font-ui" fontSize=14 fontWeight="normal"  TEXT: La location peut être arrêtée après la durée minimum, ou convertie en achat plus tard.
      - ref «Lease Aircraft» ref="Im067" descendants={"h8MyJ": {"content": "Louer l'A320neo"}}  (instance of «Button/Primary»)
  - ref «HUD Onboarding» ref="uCkER" descendants={"TZdq9": {"fill": "#FFFFFF1F", "stroke": "#00000000"}, "cyUlI": {"enabled": false}, "R9K1Zp": {"enabled": true}, "eP7CE": {"fill": "$tex...  (instance of «HUD/Onboarding»)
  - ref «HUD Bottom» ref="t2yhjE" descendants={"D3kro/Mw53t": {"content": "Échap"}, "XuZbG": {"content": "Étape précédente"}, "msx5l/Mw53t": {"content": "↑ ↓"}, "sA5qV": {"content": "...  (instance of «HUD/Bottom»)
