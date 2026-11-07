# Ligne · détail & planning

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «Ligne · détail & planning» width=1600 height=900 layout="none" fill="$bg" clip=true
  - frame «Scene 3D» width=1600 height=900 fill={"type": "image", "enabled": true, "url": "images/generated-4.png", "mode": "cover"}
  - rectangle «Scene Shade» width=1600 height=900 fill={"type": "gradient", "gradientType": "radial", "enabled": true, "rotation": 0, "size": {"width": 1.5, "height": 1.5}, "colors": [{"color"...
  - frame «Content» width=1600 height=778 layout="vertical" gap=22 padding=[28, 32, 24, 32]
    - frame «Line Header» width="fill_container" alignItems="end" justifyContent="space_between"
      - frame «Identity» layout="vertical" gap=8
        - frame «Breadcrumb» gap=10 alignItems="center"
          - ref «Sign · LFMN» ref="pirBQ"  (instance of «Sign/Location»)
          - text «Pair Arrow» fill="$text-secondary" fontFamily="$font-ui" fontSize=16 fontWeight="normal"  TEXT: ⇄
          - ref «Sign · LFLL» ref="pirBQ" descendants={"OYKAu": {"content": "LFLL"}}  (instance of «Sign/Location»)
          - text «Crumb Text» fill="$text-tertiary" fontFamily="$font-ui" fontSize=13 fontWeight="normal"  TEXT: Réseau  ›  Lignes autonomes
        - frame «Status» gap=8 padding=[6, 0, 0, 0] alignItems="center"
          - ellipse «Status Dot» width=7 height=7 fill="$success"
          - text «Status Text» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: Ligne active · exploitation automatique depuis le 12 octobre
        - text «Title» fill="$text-primary" fontFamily="$font-display" fontSize=40 fontWeight="600"  TEXT: Nice ⇄ Lyon
        - text «Subtitle» fill="$text-secondary" fontFamily="$font-ui" fontSize=15 fontWeight="normal"  TEXT: Vols AZR 1131 à 1138 · 162 NM · 1 h 10 de vol en ATR 72-600
      - frame «Key Stats» gap=44 padding=[0, 0, 4, 0]
        - ref «Stat · Avions affectés» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "Avions affectés"}, "GqS8d": {"content": "2"}, "JT5Iq": {"content": "F-HAZA · F-HAZB à mi-temps", "fill": "$text-t...  (instance of «Stat»)
        - ref «Stat · Fréquence» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "Fréquence"}, "GqS8d": {"content": "1 vol / 3 h"}, "JT5Iq": {"content": "depuis Nice · 4 allers-retours par jour",...  (instance of «Stat»)
        - ref «Stat · Remplissage» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "Remplissage"}, "GqS8d": {"content": "78 %"}, "JT5Iq": {"content": "+4 pts sur 7 jours", "fill": "$text-tertiary"}}  (instance of «Stat»)
        - ref «Stat · Recette par jour» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "Recette par jour"}, "GqS8d": {"content": "41 500 €"}, "JT5Iq": {"content": "marge 9 400 € après coûts", "fill": "...  (instance of «Stat»)
    - ref «Panel · Planning» width="fill_container" height="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Planning de la ligne"}, "A9Tx2K": {"content": "Modifier le programme"}, "q5ftx0": {"height": "fill_container", "g...  (instance of «Panel»)
  - ref «HUD Top» ref="a93UHQ" descendants={"Uth8f": {"stroke": "#00000000"}, "Ely3m": {"fill": "$text-tertiary"}, "zg3vi": {"stroke": "$text-primary"}, "O6CMm": {"fill": "$text-pr...  (instance of «HUD/Top»)
  - ref «HUD Bottom» ref="t2yhjE" descendants={"XuZbG": {"content": "Retour au réseau"}, "msx5l/Mw53t": {"content": "← →"}, "sA5qV": {"content": "Jour précédent / suivant"}, "EYYNz/Mw...  (instance of «HUD/Bottom»)
