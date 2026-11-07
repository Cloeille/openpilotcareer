# Staff · politique RH & climat social

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «Staff · politique RH & climat social» width=1600 height=900 layout="none" fill="$bg" clip=true
  - frame «Scene 3D» width=1600 height=900 fill={"type": "image", "enabled": true, "url": "images/generated.png", "mode": "cover"}
  - rectangle «Scene Shade» width=1600 height=900 fill={"type": "gradient", "gradientType": "radial", "enabled": true, "rotation": 0, "size": {"width": 1.5, "height": 1.5}, "colors": [{"color"...
  - frame «Content» width=1600 height=778 layout="vertical" gap=24 padding=[28, 32, 24, 32]
    - frame «Header» width="fill_container" alignItems="end" justifyContent="space_between"
      - frame «Identity» layout="vertical" gap=8
        - frame «Breadcrumb» gap=10 alignItems="center"
          - ref «Base Sign» ref="pirBQ" descendants={"OYKAu": {"content": "LFMN"}}  (instance of «Sign/Location»)
          - text «Crumb Text» fill="$text-tertiary" fontFamily="$font-ui" fontSize=13 fontWeight="normal"  TEXT: Staff  ›  Politique RH
        - frame «Status» gap=8 padding=[6, 0, 0, 0] alignItems="center"
          - ellipse «Status Dot» width=7 height=7 fill="$warning"
          - text «Status Text» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: Les PNC se plaignent de leurs plannings · 3 plaintes ce mois
        - text «Title» fill="$text-primary" fontFamily="$font-display" fontSize=40 fontWeight="600"  TEXT: Politique RH
        - text «Subtitle» fill="$text-secondary" fontFamily="$font-ui" fontSize=15 fontWeight="normal"  TEXT: Le ton de ta directrice RH, et ce qu'il change au moral, à la productivité et au risque juridique
      - frame «Key Stats» gap=44 padding=[0, 0, 4, 0]
        - ref «Stat · Effectif» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "Effectif"}, "GqS8d": {"content": "70 / 77"}, "JT5Iq": {"content": "7 postes vacants", "fill": "$text-tertiary"}}  (instance of «Stat»)
        - ref «Stat · Masse salariale» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "Masse salariale"}, "GqS8d": {"content": "345 500 €"}, "JT5Iq": {"content": "par mois", "fill": "$text-tertiary"}}  (instance of «Stat»)
        - ref «Stat · Fatigue moyenne» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "Fatigue moyenne"}, "GqS8d": {"content": "38 %"}, "JT5Iq": {"content": "stable", "fill": "$text-tertiary"}}  (instance of «Stat»)
    - frame «Body» width="fill_container" height="fill_container" gap=20
      - ref «Panel · Style RH» width="fill_container" height="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Style de ta directrice RH"}, "A9Tx2K": {"content": "Sophie Garnier · chez Azur Régional depuis 2019", "fill": "$t...  (instance of «Panel»)
      - frame «Side Column» width=420 height="fill_container" layout="vertical" gap=20
        - ref «Panel · Moral par famille» width="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Moral par famille"}, "A9Tx2K": {"content": "maintenant → avec ce réglage", "fill": "$text-tertiary", "fontWeight"...  (instance of «Panel»)
        - ref «Panel · Risque juridique» width="fill_container" height="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Risque juridique"}, "A9Tx2K": {"content": "en zone grise", "fill": "$warning", "fontWeight": "500", "fontSize": 1...  (instance of «Panel»)
  - ref «HUD Top» ref="a93UHQ" descendants={"Uth8f": {"stroke": "#00000000"}, "Ely3m": {"fill": "$text-tertiary"}, "daIvj": {"stroke": "$text-primary"}, "cXwn0": {"fill": "$text-pr...  (instance of «HUD/Top»)
  - ref «HUD Bottom» ref="t2yhjE" descendants={"D3kro/Mw53t": {"content": "Échap"}, "XuZbG": {"content": "Retour au staff"}, "msx5l/Mw53t": {"content": "↑ ↓"}, "sA5qV": {"content": "C...  (instance of «HUD/Bottom»)
