# Finance · prévisions 12 mois

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «Finance · prévisions 12 mois» width=1600 height=900 layout="none" fill="$bg" clip=true
  - frame «Scene 3D» width=1600 height=900 fill={"type": "image", "enabled": true, "url": "images/generated-11.png", "mode": "cover"}
  - rectangle «Scene Shade» width=1600 height=900 fill={"type": "gradient", "gradientType": "radial", "enabled": true, "rotation": 0, "size": {"width": 1.5, "height": 1.5}, "colors": [{"color"...
  - frame «Content» width=1600 height=778 layout="vertical" gap=24 padding=[28, 32, 24, 32]
    - frame «Header» width="fill_container" alignItems="end" justifyContent="space_between"
      - frame «Identity» layout="vertical" gap=8
        - frame «Breadcrumb» gap=10 alignItems="center"
          - ref «Base Sign» ref="pirBQ" descendants={"OYKAu": {"content": "LFMN"}}  (instance of «Sign/Location»)
          - text «Crumb Text» fill="$text-tertiary" fontFamily="$font-ui" fontSize=13 fontWeight="normal"  TEXT: Finance  ›  Prévisions 12 mois
        - frame «Status» gap=8 padding=[6, 0, 0, 0] alignItems="center"
          - ellipse «Status Dot» width=7 height=7 fill="$warning"
          - text «Status Text» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: En scénario prudent, le compte passe à découvert du 9 janvier au 22 février
        - text «Title» fill="$text-primary" fontFamily="$font-display" fontSize=40 fontWeight="600"  TEXT: Prévisions 12 mois
        - text «Subtitle» fill="$text-secondary" fontFamily="$font-ui" fontSize=15 fontWeight="normal"  TEXT: Ton solde au plus bas de chaque mois jusqu'en octobre 2027, et ce qui le fait bouger
      - frame «Key Stats» gap=44 padding=[0, 0, 4, 0]
        - ref «Stat · Solde aujourd'hui» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "Solde aujourd'hui"}, "GqS8d": {"content": "1 284 560 €"}, "JT5Iq": {"content": "ven. 6 novembre", "fill": "$text-...  (instance of «Stat»)
        - ref «Stat · Point bas, central» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "Point bas, central"}, "GqS8d": {"content": "96 000 €"}, "JT5Iq": {"content": "mi-janvier · prudent −148 000 €", "...  (instance of «Stat»)
        - ref «Stat · Fin octobre 2027, central» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "Fin octobre 2027, central"}, "GqS8d": {"content": "2 350 000 €"}, "JT5Iq": {"content": "prudent 1,24 M€ · optimis...  (instance of «Stat»)
    - frame «Body» width="fill_container" height="fill_container" gap=20
      - ref «Panel · Projection» width="fill_container" height="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Solde au plus bas de chaque mois"}, "A9Tx2K": {"type": "frame", "id": "ZagI2", "name": "Legend", "gap": 20, "alig...  (instance of «Panel»)
      - ref «Panel · Décisions» width=448 height="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Tester une décision"}, "A9Tx2K": {"content": "Effet sur le point bas", "fill": "$text-tertiary", "fontWeight": "n...  (instance of «Panel»)
  - ref «HUD Top» ref="a93UHQ" descendants={"Uth8f": {"stroke": "#00000000"}, "Ely3m": {"fill": "$text-tertiary"}, "daIvj": {"stroke": "$text-primary"}, "cXwn0": {"fill": "$text-pr...  (instance of «HUD/Top»)
  - ref «HUD Bottom» ref="t2yhjE"  (instance of «HUD/Bottom»)
