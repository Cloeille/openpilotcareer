# Entrepôt · pièces de rechange

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «Entrepôt · pièces de rechange» width=1600 height=900 layout="none" fill="$bg" clip=true
  - frame «Scene 3D» width=1600 height=900 fill={"type": "image", "enabled": true, "url": "images/generated-13.png", "mode": "cover"}
  - rectangle «Scene Shade» width=1600 height=900 fill={"type": "gradient", "gradientType": "radial", "enabled": true, "rotation": 0, "size": {"width": 1.5, "height": 1.5}, "colors": [{"color"...
  - frame «Content» width=1600 height=778 layout="vertical" gap=24 padding=[28, 32, 24, 32]
    - frame «Warehouse Header» width="fill_container" alignItems="end" justifyContent="space_between"
      - frame «Identity» layout="vertical" gap=8
        - frame «Breadcrumb» gap=10 alignItems="center"
          - ref «Base Sign» ref="pirBQ"  (instance of «Sign/Location»)
          - text «Crumb Text» fill="$text-tertiary" fontFamily="$font-ui" fontSize=13 fontWeight="normal"  TEXT: Compagnie  ›  Installations à Nice
        - text «Title» fill="$text-primary" fontFamily="$font-display" fontSize=40 fontWeight="600"  TEXT: Entrepôt de pièces de rechange
        - text «Subtitle» fill="$text-secondary" fontFamily="$font-ui" fontSize=15 fontWeight="normal"  TEXT: Zone fret Ouest · 380 m² loués 4 200 € par mois · 18 pièces pour 3 types d'avions sur 4
      - frame «Key Stats» gap=44 padding=[0, 0, 4, 0]
        - ref «Stat · Capital immobilisé» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "Capital immobilisé"}, "GqS8d": {"content": "481 400 €"}, "JT5Iq": {"content": "soit 37 % du solde", "fill": "$tex...  (instance of «Stat»)
        - ref «Stat · Jours au sol évités» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "Jours au sol attendus"}, "GqS8d": {"content": "≈ 24 j"}, "JT5Iq": {"content": "par an · dont 11 j pour le Caravan...  (instance of «Stat»)
        - ref «Stat · Avions couverts» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "Avions couverts"}, "GqS8d": {"content": "5 sur 6"}, "JT5Iq": {"content": "F-HAZF sans aucune pièce", "fill": "$da...  (instance of «Stat»)
    - frame «Warehouse Body» width="fill_container" height="fill_container" gap=20
      - ref «Panel · Arbitrage» width="fill_container" height="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Argent qui dort ou avion au sol"}, "A9Tx2K": {"content": "Comment c'est estimé"}, "q5ftx0": {"height": "fill_cont...  (instance of «Panel»)
      - ref «Panel · En stock» width=440 height="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "En stock à LFMN"}, "A9Tx2K": {"content": "Inventaire complet"}, "q5ftx0": {"height": "fill_container", "gap": 18,...  (instance of «Panel»)
  - ref «HUD Top» ref="a93UHQ" descendants={"Uth8f": {"stroke": "#00000000"}, "Ely3m": {"fill": "$text-tertiary"}, "daIvj": {"stroke": "$text-primary"}, "cXwn0": {"fill": "$text-pr...  (instance of «HUD/Top»)
  - ref «HUD Bottom» ref="t2yhjE" descendants={"D3kro/Mw53t": {"content": "Échap"}, "XuZbG": {"content": "Retour aux installations"}, "msx5l/Mw53t": {"content": "← →"}, "sA5qV": {"con...  (instance of «HUD/Bottom»)
