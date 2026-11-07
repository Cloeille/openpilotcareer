# Alliance · installations partagées

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «Alliance · installations partagées» width=1600 height=900 layout="none" fill="$bg" clip=true
  - frame «Scene 3D» width=1600 height=900 fill={"type": "image", "enabled": true, "url": "images/generated-14.png", "mode": "cover"}
  - rectangle «Scene Shade» width=1600 height=900 fill={"type": "gradient", "gradientType": "radial", "enabled": true, "rotation": 0, "size": {"width": 1.5, "height": 1.5}, "colors": [{"color"...
  - frame «Content» width=1600 height=778 layout="vertical" gap=20 padding=[28, 32, 24, 32]
    - frame «Header» width="fill_container" alignItems="end" justifyContent="space_between"
      - frame «Title Block» layout="vertical" gap=6
        - frame «Status» gap=8 alignItems="center"
          - icon «Status Icon» width=14 height=14 fill="$warning" icon="wrench"
          - text «Status Text» fill="$warning" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: Limite de la visite C le 11 novembre · après, F-HAZC ne peut plus voler, même à vide
        - text «Title» fill="$text-primary" fontFamily="$font-display" fontSize=30 fontWeight="600"  TEXT: Où faire la visite C de F-HAZC ?
        - text «Sub» fill="$text-tertiary" fontFamily="$font-ui" fontSize=14 fontWeight="normal"  TEXT: CRJ700 stationné à Nice · les hangars de l'alliance comparés à un atelier extérieur, convoyage compris
      - ref «View Switcher · alliance» ref="a7ZUZ" descendants={"wmERV": {"fill": "#00000000"}, "NWATU": {"content": "Membres & réseau", "fill": "$text-secondary"}, "z8pczc": {"fill": "#FFFFFF1A"}, "J...  (instance of «View Switcher»)
    - frame «Body» width="fill_container" height="fill_container" gap=32
      - ref «Panel · Comparaison» width="fill_container" height="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Trois endroits possibles"}, "A9Tx2K": {"content": "Un jour au sol coûte 6 800 € de recettes", "fill": "$text-tert...  (instance of «Panel»)
      - frame «Right Column» width=360 height="fill_container" layout="vertical" gap=16
        - ref «Panel · Mis en commun» width="fill_container" height="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Mis en commun"}, "A9Tx2K": {"content": "Proposer le mien"}, "q5ftx0": {"height": "fill_container", "gap": 0, "pad...  (instance of «Panel»)
  - ref «HUD Top» ref="a93UHQ" descendants={"Uth8f": {"stroke": "#00000000"}, "Ely3m": {"fill": "$text-tertiary"}, "daIvj": {"stroke": "$text-primary"}, "cXwn0": {"fill": "$text-pr...  (instance of «HUD/Top»)
  - ref «HUD Bottom» ref="t2yhjE" descendants={"XuZbG": {"content": "Retour"}, "msx5l/Mw53t": {"content": "↑ ↓"}, "sA5qV": {"content": "Atelier suivant"}, "EYYNz/Mw53t": {"content": "...  (instance of «HUD/Bottom»)
