# Facility · contrat & améliorations

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «Facility · contrat & améliorations» width=1600 height=900 layout="none" fill="$bg" clip=true
  - frame «Scene 3D» width=1600 height=900 fill={"type": "image", "enabled": true, "url": "images/generated-14.png", "mode": "cover"}
  - rectangle «Scene Shade» width=1600 height=900 fill={"type": "gradient", "gradientType": "radial", "enabled": true, "rotation": 0, "size": {"width": 1.5, "height": 1.5}, "colors": [{"color"...
  - frame «Content» width=1600 height=778 gap=56 padding=[28, 32, 24, 32]
    - frame «Contract Column» width=700 height="fill_container" layout="vertical" gap=24
      - frame «Title Block» width="fill_container" layout="vertical" gap=8
        - frame «Status» gap=10 alignItems="center"
          - ref «Sign · LFMN» ref="pirBQ" descendants={"OYKAu": {"content": "LFMN"}}  (instance of «Sign/Location»)
          - text «Status Text» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: Hub principal · facilities
        - text «Title» fill="$text-primary" fontFamily="$font-display" fontSize=30 fontWeight="600"  TEXT: Hangar de maintenance 2
        - text «Sub» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="normal"  TEXT: Zone technique nord · 4 200 m² · libre depuis septembre · proposé par Aéroports de la Côte d'Azur
      - ref «Choice Panel» width="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Louer ou acheter"}, "A9Tx2K": {"content": "Mêmes effets, seul le coût change", "fill": "$text-tertiary"}, "q5ftx0...  (instance of «Panel»)
      - ref «Staff Panel» width="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Personnel requis"}, "A9Tx2K": {"content": "Pour le niveau 2", "fill": "$text-tertiary"}, "q5ftx0": {"gap": 0, "pa...  (instance of «Panel»)
    - frame «Upgrade Column» width="fill_container" height="fill_container" layout="vertical" gap=24 padding=[119, 0, 0, 0]
      - ref «Levels Panel» width="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Niveau du hangar"}, "A9Tx2K": {"content": "Le loyer ne change pas avec le niveau", "fill": "$text-tertiary"}, "q5...  (instance of «Panel»)
      - frame «Spacer» width="fill_container" height="fill_container"
      - frame «Confirm» width="fill_container" layout="vertical" gap=18 padding=[20, 22, 22, 22] fill="$surface" stroke="$border" strokeWidth=1 cornerRadius=6 effect={"type": "background_blur", "radius": 24}
        - frame «Summary» width="fill_container" gap=40 alignItems="end"
          - ref «Stat · À la signature» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "À payer à la signature", "fill": "$text-tertiary"}, "GqS8d": {"content": "457 000 €", "fontSize": 30}, "JT5Iq": {...  (instance of «Stat»)
          - ref «Stat · Chaque mois» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "Ensuite, chaque mois", "fill": "$text-tertiary"}, "GqS8d": {"content": "64 700 €", "fontSize": 30}, "JT5Iq": {"co...  (instance of «Stat»)
          - frame «Spacer» width="fill_container" height=1
          - frame «Balance After» layout="vertical" gap=2 alignItems="end"
            - text «Label» fill="$text-tertiary" fontFamily="$font-ui" fontSize=13 fontWeight="normal"  TEXT: Solde après signature
            - text «Value» fill="$text-secondary" fontFamily="$font-ui" fontSize=15 fontWeight="500"  TEXT: 827 560 €
        - frame «Actions» width="fill_container" gap=16 alignItems="center"
          - ref «Button · Signer» width="fill_container" ref="Im067" descendants={"h8MyJ": {"content": "Louer et lancer le niveau 2", "textGrowth": "fixed-width", "width": "fill_container"}}  (instance of «Button/Primary»)
          - ref «Button · Niveau 1» ref="v6he7" descendants={"RU69u": {"enabled": false}, "BxHlG": {"content": "Louer au niveau 1"}}  (instance of «Button/Secondary»)
  - ref «HUD Top» ref="a93UHQ" descendants={"Uth8f": {"stroke": "#00000000"}, "Ely3m": {"fill": "$text-tertiary"}, "daIvj": {"stroke": "$text-primary"}, "cXwn0": {"fill": "$text-pr...  (instance of «HUD/Top»)
  - ref «HUD Bottom» ref="t2yhjE" descendants={"D3kro/Mw53t": {"content": "Échap"}, "XuZbG": {"content": "Retour au plan"}, "msx5l/Mw53t": {"content": "Tab"}, "sA5qV": {"content": "Lo...  (instance of «HUD/Bottom»)
