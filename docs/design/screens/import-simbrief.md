# Import SimBrief

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «Import SimBrief» width=1600 height=900 layout="none" fill="$bg" clip=true x=3400 y=3000
  - frame «Scene 3D» width=1600 height=900 fill={"type": "image", "enabled": true, "url": "images/generated-3.png", "mode": "cover"} x=0 y=0
  - rectangle «Scene Shade» width=1600 height=900 fill={"type": "gradient", "gradientType": "radial", "enabled": true, "rotation": 0, "size": {"width": 1.5, "height": 1.5}, "colors": [{"color"... x=0 y=0
  - frame «Content» width=1600 height=778 gap=20 padding=[28, 32, 24, 32] x=0 y=76
    - frame «Import Column» width=620 height="fill_container" layout="vertical" gap=28
      - frame «Header» width="fill_container" layout="vertical" gap=12
        - frame «Title Block» layout="vertical" gap=6
          - frame «Status» gap=8 alignItems="center"
            - text «Status Text» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: Jobs · job personnalisé
          - text «Title» fill="$text-primary" fontFamily="$font-display" fontSize=30 fontWeight="600"  TEXT: Importer depuis SimBrief
        - text «Intro» width="fill_container" fill="$text-secondary" fontFamily="$font-ui" fontSize=16 fontWeight="normal"  TEXT: Ton dernier plan de vol devient un job personnalisé : route, carburant prévu, appareil et charge sont repris tels quels.
      - frame «User Row» width="fill_container" gap=12 alignItems="end"
        - ref «Username Input» width="fill_container" ref="HlSJO" descendants={"JaQRw": {"content": "Nom d'utilisateur SimBrief"}, "R65jAG": {"content": "lmoreau_azr", "fill": "$text-primary"}}  (instance of «Input»)
        - ref «Fetch Button» height=44 ref="v6he7" descendants={"RU69u": {"enabled": false}, "BxHlG": {"content": "Récupérer le plan"}}  (instance of «Button/Secondary»)
      - ref «Preview Panel» width="fill_container" ref="bibzm" descendants={"uBW0Z": {"padding": [24, 28, 4, 28]}, "e0veVE": {"content": "Aperçu du job"}, "A9Tx2K": {"content": "Plan généré il y a 8 min", "fill":...  (instance of «Panel»)
  - ref «HUD Top» ref="a93UHQ" descendants={"Uth8f": {"stroke": "#00000000"}, "Ely3m": {"fill": "$text-tertiary"}, "wAYyl": {"stroke": "$text-primary"}, "VKGo6": {"fill": "$text-pr... x=0 y=0  (instance of «HUD/Top»)
  - ref «HUD Bottom» ref="t2yhjE" descendants={"D3kro/Mw53t": {"content": "Échap"}, "XuZbG": {"content": "Retour aux jobs"}, "msx5l/Mw53t": {"content": "R"}, "sA5qV": {"content": "Réc... x=0 y=854  (instance of «HUD/Bottom»)
