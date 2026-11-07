# Staff · congés & repos

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «Staff · congés & repos» width=1600 height=900 layout="none" fill="$bg" clip=true
  - frame «Scene 3D» width=1600 height=900 fill={"type": "image", "enabled": true, "url": "images/generated-13.png", "mode": "cover"}
  - rectangle «Scene Shade» width=1600 height=900 fill={"type": "gradient", "gradientType": "radial", "enabled": true, "rotation": 0, "size": {"width": 1.5, "height": 1.5}, "colors": [{"color"...
  - frame «Content» width=1600 height=778 layout="vertical" gap=24 padding=[28, 32, 24, 32]
    - frame «Header» width="fill_container" alignItems="end" justifyContent="space_between"
      - frame «Identity» layout="vertical" gap=8
        - frame «Breadcrumb» gap=10 alignItems="center"
          - ref «Base Sign» ref="pirBQ" descendants={"OYKAu": {"content": "LFMN"}}  (instance of «Sign/Location»)
          - text «Crumb Text» fill="$text-tertiary" fontFamily="$font-ui" fontSize=13 fontWeight="normal"  TEXT: Staff  ›  Congés & repos
        - frame «Status» gap=8 padding=[6, 0, 0, 0] alignItems="center"
          - ellipse «Status Dot» width=7 height=7 fill="$warning"
          - text «Status Text» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: 2 jours en sous-effectif d'ici le 3 décembre, aucun pilote CRJ
        - text «Title» fill="$text-primary" fontFamily="$font-display" fontSize=40 fontWeight="600"  TEXT: Congés & repos
        - text «Subtitle» fill="$text-secondary" fontFamily="$font-ui" fontSize=15 fontWeight="normal"  TEXT: Qui est absent, quand, et ce que ça laisse pour faire tourner tes lignes
      - frame «Key Stats» gap=44 padding=[0, 0, 4, 0]
        - ref «Stat · Congés restants» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "Congés restants"}, "GqS8d": {"content": "312 j"}, "JT5Iq": {"content": "sur l'année · 48 personnes", "fill": "$te...  (instance of «Stat»)
        - ref «Stat · En repos maintenant» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "En repos maintenant"}, "GqS8d": {"content": "9"}, "JT5Iq": {"content": "dont 4 pilotes", "fill": "$text-tertiary"}}  (instance of «Stat»)
        - ref «Stat · Fatigue moyenne» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "Fatigue moyenne"}, "GqS8d": {"content": "38 %"}, "JT5Iq": {"content": "stable", "fill": "$text-tertiary"}}  (instance of «Stat»)
    - frame «Body» width="fill_container" height="fill_container" gap=20
      - ref «Panel · Couverture» width="fill_container" height="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Couverture du planning"}, "A9Tx2K": {"content": "Vue par personne"}, "q5ftx0": {"height": "fill_container", "gap"...  (instance of «Panel»)
      - frame «Side Column» width=420 height="fill_container" layout="vertical" gap=20
        - ref «Panel · Demandes» width="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Demandes de congés"}, "A9Tx2K": {"content": "2 en attente", "fill": "$text-tertiary"}, "q5ftx0": {"gap": 0, "padd...  (instance of «Panel»)
        - ref «Panel · Politique de repos» width="fill_container" height="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Politique de repos"}, "A9Tx2K": {"enabled": false}, "q5ftx0": {"height": "fill_container", "gap": 10, "children":...  (instance of «Panel»)
  - ref «HUD Top» ref="a93UHQ" descendants={"Uth8f": {"stroke": "#00000000"}, "Ely3m": {"fill": "$text-tertiary"}, "daIvj": {"stroke": "$text-primary"}, "cXwn0": {"fill": "$text-pr...  (instance of «HUD/Top»)
  - ref «HUD Bottom» ref="t2yhjE" descendants={"D3kro/Mw53t": {"content": "Échap"}, "XuZbG": {"content": "Retour au staff"}, "msx5l/Mw53t": {"content": "← →"}, "sA5qV": {"content": "C...  (instance of «HUD/Bottom»)
