# Service à bord · confort & repas

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «Service à bord · confort & repas» width=1600 height=900 layout="none" fill="$bg" clip=true
  - frame «Scene 3D» width=1600 height=900 fill={"type": "image", "enabled": true, "url": "images/generated-13.png", "mode": "cover"}
  - rectangle «Scene Shade» width=1600 height=900 fill={"type": "gradient", "gradientType": "radial", "enabled": true, "rotation": 0, "size": {"width": 1.5, "height": 1.5}, "colors": [{"color"...
  - frame «Content» width=1600 height=778 layout="vertical" gap=24 padding=[28, 32, 24, 32]
    - frame «Header» width="fill_container" alignItems="end" justifyContent="space_between"
      - frame «Identity» layout="vertical" gap=8
        - frame «Breadcrumb» gap=10 alignItems="center"
          - ref «Base Sign» ref="pirBQ" descendants={"OYKAu": {"content": "LFMN"}}  (instance of «Sign/Location»)
          - text «Crumb Text» fill="$text-tertiary" fontFamily="$font-ui" fontSize=13 fontWeight="normal"  TEXT: Compagnie  ›  Service à bord
        - frame «Status» gap=8 padding=[6, 0, 0, 0] alignItems="center"
          - ellipse «Status Dot» width=7 height=7 fill="$success"
          - text «Status Text» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: Appliqué sur tes 4 lignes · 38 vols par jour
        - text «Title» fill="$text-primary" fontFamily="$font-display" fontSize=40 fontWeight="600"  TEXT: Service à bord
        - text «Subtitle» fill="$text-secondary" fontFamily="$font-ui" fontSize=15 fontWeight="normal"  TEXT: Ce que tes PNC proposent selon la durée du vol, et ce qui est gratuit ou payant
      - frame «Key Stats» gap=44 padding=[0, 0, 4, 0]
        - ref «Stat · Satisfaction cabine» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "Satisfaction cabine"}, "GqS8d": {"content": "4,2 / 5"}, "JT5Iq": {"content": "+0,3 ce mois", "fill": "$success"}}  (instance of «Stat»)
        - ref «Stat · Ventes à bord» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "Ventes à bord"}, "GqS8d": {"content": "1 920 €"}, "JT5Iq": {"content": "par jour", "fill": "$text-tertiary"}}  (instance of «Stat»)
        - ref «Stat · Coût du service» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "Coût du service"}, "GqS8d": {"content": "6 480 €"}, "JT5Iq": {"content": "par jour · repas et boissons", "fill": ...  (instance of «Stat»)
    - frame «Body» width="fill_container" height="fill_container" gap=20
      - ref «Panel · Offre par type de vol» width="fill_container" height="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Offre par type de vol"}, "A9Tx2K": {"content": "Comparer aux compagnies IA"}, "q5ftx0": {"height": "fill_containe...  (instance of «Panel»)
      - frame «Side Column» width=420 height="fill_container" layout="vertical" gap=20
        - ref «Panel · Qualité des repas» width="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Qualité des repas"}, "A9Tx2K": {"content": "Voir la cuisine"}, "q5ftx0": {"gap": 14, "children": [{"type": "frame...  (instance of «Panel»)
        - ref «Panel · Équipage de cabine» width="fill_container" height="fit_content" ref="bibzm" descendants={"e0veVE": {"content": "Équipage de cabine"}, "A9Tx2K": {"enabled": false}, "q5ftx0": {"height": "fit_content", "gap": 10, "children": [{...  (instance of «Panel»)
  - ref «HUD Top» ref="a93UHQ" descendants={"Uth8f": {"stroke": "#00000000"}, "Ely3m": {"fill": "$text-tertiary"}, "daIvj": {"stroke": "$text-primary"}, "cXwn0": {"fill": "$text-pr...  (instance of «HUD/Top»)
  - ref «HUD Bottom» ref="t2yhjE" descendants={"D3kro/Mw53t": {"content": "Échap"}, "XuZbG": {"content": "Retour à la compagnie"}, "msx5l/Mw53t": {"content": "← →"}, "sA5qV": {"conten...  (instance of «HUD/Bottom»)
