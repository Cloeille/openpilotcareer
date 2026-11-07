# Staff · centre de formation & formateurs

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «Staff · centre de formation & formateurs» width=1600 height=900 layout="none" fill="$bg" clip=true
  - frame «Scene 3D» width=1600 height=900 fill={"type": "image", "enabled": true, "url": "images/generated-13.png", "mode": "cover"}
  - rectangle «Scene Shade» width=1600 height=900 fill={"type": "gradient", "gradientType": "radial", "enabled": true, "rotation": 0, "size": {"width": 1.5, "height": 1.5}, "colors": [{"color"...
  - frame «Content» width=1600 height=778 layout="vertical" gap=24 padding=[28, 32, 24, 32]
    - frame «Header» width="fill_container" alignItems="end" justifyContent="space_between"
      - frame «Identity» layout="vertical" gap=8
        - frame «Breadcrumb» gap=10 alignItems="center"
          - ref «Base Sign» ref="pirBQ"  (instance of «Sign/Location»)
          - text «Crumb Text» fill="$text-tertiary" fontFamily="$font-ui" fontSize=13 fontWeight="normal"  TEXT: Staff  ›  Centre de formation
        - frame «Status» gap=8 padding=[6, 0, 0, 0] alignItems="center"
          - ellipse «Status Dot» width=7 height=7 fill="$warning"
          - text «Status Text» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: Aucun formateur CRJ700 · la qualification de Camille Lefèvre devra être achetée dehors
        - text «Title» fill="$text-primary" fontFamily="$font-display" fontSize=40 fontWeight="600"  TEXT: Centre de formation
        - text «Subtitle» fill="$text-secondary" fontFamily="$font-ui" fontSize=15 fontWeight="normal"  TEXT: Qui forme qui, sur quoi, et ce que ça coûte de le faire chez toi plutôt que dehors
      - frame «Key Stats» gap=44 padding=[0, 0, 4, 0]
        - ref «Stat · Stagiaires en cours» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "Stagiaires en cours"}, "GqS8d": {"content": "8"}, "JT5Iq": {"content": "2 pilotes · 6 PNC", "fill": "$text-tertia...  (instance of «Stat»)
        - ref «Stat · Simulateur ATR» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "Simulateur ATR cette semaine"}, "GqS8d": {"content": "68 %"}, "JT5Iq": {"content": "112 % la semaine du 30 nov.",...  (instance of «Stat»)
        - ref «Stat · Économisé en 2026» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "Économisé en 2026"}, "GqS8d": {"content": "238 000 €"}, "JT5Iq": {"content": "face à la formation achetée dehors"...  (instance of «Stat»)
    - frame «Body» width="fill_container" height="fill_container" gap=20
      - ref «Panel · Planning de formation» width="fill_container" height="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Planning de formation"}, "A9Tx2K": {"content": "Vue par formateur"}, "q5ftx0": {"height": "fill_container", "gap"...  (instance of «Panel»)
      - frame «Side Column» width=400 height="fill_container" layout="vertical" gap=20
        - ref «Panel · Formateurs» width="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Formateurs"}, "A9Tx2K": {"content": "Recruter"}, "q5ftx0": {"gap": 0, "padding": [4, 22, 16, 22], "children": [{"...  (instance of «Panel»)
        - ref «Panel · Chez toi ou dehors» width="fill_container" height="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Chez toi ou dehors"}, "A9Tx2K": {"content": "par stagiaire", "fill": "$text-tertiary"}, "q5ftx0": {"height": "fil...  (instance of «Panel»)
  - ref «HUD Top» ref="a93UHQ" descendants={"Uth8f": {"stroke": "#00000000"}, "Ely3m": {"fill": "$text-tertiary"}, "daIvj": {"stroke": "$text-primary"}, "cXwn0": {"fill": "$text-pr...  (instance of «HUD/Top»)
  - ref «HUD Bottom» ref="t2yhjE" descendants={"D3kro/Mw53t": {"content": "Échap"}, "XuZbG": {"content": "Retour au staff"}, "msx5l/Mw53t": {"content": "← →"}, "sA5qV": {"content": "C...  (instance of «HUD/Bottom»)
