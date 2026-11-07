# Staff · cabinet de recrutement

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «Staff · cabinet de recrutement» width=1600 height=900 layout="none" fill="$bg" clip=true
  - frame «Scene 3D» width=1600 height=900 fill={"type": "image", "enabled": true, "url": "images/generated.png", "mode": "cover"}
  - rectangle «Scene Shade» width=1600 height=900 fill={"type": "gradient", "gradientType": "radial", "enabled": true, "rotation": 0, "size": {"width": 1.5, "height": 1.5}, "colors": [{"color"...
  - frame «Content» width=1600 height=778 layout="vertical" gap=24 padding=[28, 32, 24, 32]
    - frame «Header» width="fill_container" alignItems="end" justifyContent="space_between"
      - frame «Identity» layout="vertical" gap=8
        - frame «Breadcrumb» gap=10 alignItems="center"
          - ref «Base Sign» ref="pirBQ" descendants={"OYKAu": {"content": "LFMN"}}  (instance of «Sign/Location»)
          - text «Crumb Text» fill="$text-tertiary" fontFamily="$font-ui" fontSize=13 fontWeight="normal"  TEXT: Staff  ›  Cabinet de recrutement
        - frame «Status» gap=8 padding=[6, 0, 0, 0] alignItems="center"
          - ellipse «Status Dot» width=7 height=7 fill="$danger"
          - text «Status Text» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: LFLL ⇄ LFML suspendue, aucun pilote CRJ disponible
        - text «Title» fill="$text-primary" fontFamily="$font-display" fontSize=40 fontWeight="600"  TEXT: Cabinet de recrutement
        - text «Subtitle» fill="$text-secondary" fontFamily="$font-ui" fontSize=15 fontWeight="normal"  TEXT: Des pilotes déjà qualifiés en quelques jours, contre une commission et des salaires plus hauts
      - frame «Key Stats» gap=44 padding=[0, 0, 4, 0]
        - ref «Stat · Pilotes CRJ» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "Pilotes CRJ"}, "GqS8d": {"content": "0 / 2"}, "JT5Iq": {"content": "pour rouvrir la ligne", "fill": "$text-tertia...  (instance of «Stat»)
        - ref «Stat · Ligne à l'arrêt» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "Ligne à l'arrêt"}, "GqS8d": {"content": "5 400 €"}, "JT5Iq": {"content": "de marge perdue par jour", "fill": "$te...  (instance of «Stat»)
        - ref «Stat · Effectif» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "Effectif"}, "GqS8d": {"content": "70 / 77"}, "JT5Iq": {"content": "7 postes vacants", "fill": "$text-tertiary"}}  (instance of «Stat»)
    - frame «Body» width="fill_container" height="fill_container" gap=20
      - ref «Panel · Trois options» width="fill_container" height="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Trois façons d'avoir tes 2 pilotes CRJ"}, "A9Tx2K": {"content": "à partir d'aujourd'hui, ven. 6 novembre", "fill"...  (instance of «Panel»)
      - frame «Side Column» width=420 height="fill_container" layout="vertical" gap=20
        - ref «Panel · Mission» width="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Mission confiée"}, "A9Tx2K": {"content": "Modifier"}, "q5ftx0": {"gap": 6, "padding": [8, 22, 18, 22], "children"...  (instance of «Panel»)
        - ref «Panel · Shortlist» width="fill_container" height="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Candidats proposés"}, "A9Tx2K": {"content": "trouvés en 4 jours", "fill": "$text-tertiary", "fontWeight": "normal...  (instance of «Panel»)
  - ref «HUD Top» ref="a93UHQ" descendants={"Uth8f": {"stroke": "#00000000"}, "Ely3m": {"fill": "$text-tertiary"}, "daIvj": {"stroke": "$text-primary"}, "cXwn0": {"fill": "$text-pr...  (instance of «HUD/Top»)
  - ref «HUD Bottom» ref="t2yhjE" descendants={"D3kro/Mw53t": {"content": "Échap"}, "XuZbG": {"content": "Retour au staff"}, "msx5l/Mw53t": {"content": "↑ ↓"}, "sA5qV": {"content": "C...  (instance of «HUD/Bottom»)
