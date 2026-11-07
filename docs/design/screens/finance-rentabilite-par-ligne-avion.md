# Finance · rentabilité par ligne & avion

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «Finance · rentabilité par ligne & avion» width=1600 height=900 layout="none" fill="$bg" clip=true
  - frame «Scene 3D» width=1600 height=900 fill={"type": "image", "enabled": true, "url": "images/generated-11.png", "mode": "cover"}
  - rectangle «Scene Shade» width=1600 height=900 fill={"type": "gradient", "gradientType": "radial", "enabled": true, "rotation": 0, "size": {"width": 1.5, "height": 1.5}, "colors": [{"color"...
  - frame «Content» width=1600 height=778 layout="vertical" gap=22 padding=[24, 32, 20, 32]
    - frame «Header» width="fill_container" alignItems="end" justifyContent="space_between"
      - frame «Identity» layout="vertical" gap=8
        - frame «Breadcrumb» gap=10 alignItems="center"
          - ref «Base Sign» ref="pirBQ"  (instance of «Sign/Location»)
          - text «Crumb Text» fill="$text-tertiary" fontFamily="$font-ui" fontSize=13 fontWeight="normal"  TEXT: Finance  ›  Rentabilité par ligne & avion
        - text «Title» fill="$text-primary" fontFamily="$font-display" fontSize=40 fontWeight="600"  TEXT: Rentabilité d'octobre
        - text «Subtitle» fill="$text-secondary" fontFamily="$font-ui" fontSize=15 fontWeight="normal"  TEXT: Ce que rapporte chaque ligne une fois payés son carburant, ses redevances, son équipage, son catering et sa maintenance.
      - frame «View Controls» layout="vertical" gap=10 padding=[0, 0, 2, 0] alignItems="end"
        - text «Period» fill="$text-tertiary" fontFamily="$font-ui" fontSize=13 fontWeight="normal"  TEXT: Octobre 2026 · mois clos
        - ref «View Switcher» ref="a7ZUZ" descendants={"NWATU": {"content": "Par ligne"}, "JvCPs": {"content": "Par avion"}, "p0di5": {"enabled": false}}  (instance of «View Switcher»)
    - frame «Body» width="fill_container" height="fill_container" gap=20
      - ref «Panel · Classement» width="fill_container" height="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Marge de contribution, de la plus rentable à la plus déficitaire"}, "A9Tx2K": {"content": "Trier par marge %"}, "...  (instance of «Panel»)
      - ref «Panel · Analyse» width=360 height="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Pourquoi Lyon–Marseille perd de l'argent"}, "A9Tx2K": {"enabled": false}, "q5ftx0": {"type": "frame", "id": "Xsh1...  (instance of «Panel»)
  - ref «HUD Top» ref="a93UHQ" descendants={"Uth8f": {"stroke": "#00000000"}, "Ely3m": {"fill": "$text-tertiary"}, "daIvj": {"stroke": "$text-primary"}, "cXwn0": {"fill": "$text-pr...  (instance of «HUD/Top»)
  - ref «HUD Bottom» ref="t2yhjE" descendants={"D3kro/Mw53t": {"content": "Échap"}, "XuZbG": {"content": "Retour aux finances"}, "msx5l/Mw53t": {"content": "Tab"}, "sA5qV": {"content"...  (instance of «HUD/Bottom»)
