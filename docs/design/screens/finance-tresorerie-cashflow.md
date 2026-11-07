# Finance · trésorerie & cashflow

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «Finance · trésorerie & cashflow» width=1600 height=900 layout="none" fill="$bg" clip=true
  - frame «Scene 3D» width=1600 height=900 fill={"type": "image", "enabled": true, "url": "images/generated-11.png", "mode": "cover"}
  - rectangle «Scene Shade» width=1600 height=900 fill={"type": "gradient", "gradientType": "radial", "enabled": true, "rotation": 0, "size": {"width": 1.5, "height": 1.5}, "colors": [{"color"...
  - frame «Content» width=1600 height=778 layout="vertical" gap=24 padding=[28, 32, 24, 32]
    - frame «Header» width="fill_container" alignItems="end" justifyContent="space_between"
      - frame «Identity» layout="vertical" gap=8
        - frame «Breadcrumb» gap=10 alignItems="center"
          - ref «Base Sign» ref="pirBQ" descendants={"OYKAu": {"content": "AZR"}}  (instance of «Sign/Location»)
          - text «Crumb Text» fill="$text-tertiary" fontFamily="$font-ui" fontSize=13 fontWeight="normal"  TEXT: Compagnie  ›  Finance
        - frame «Status» gap=8 padding=[6, 0, 0, 0] alignItems="center"
          - ellipse «Status Dot» width=7 height=7 fill="$success"
          - text «Status Text» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: Cashflow positif depuis 7 mois · prochain gros débit le 28 nov., salaires
        - text «Title» fill="$text-primary" fontFamily="$font-display" fontSize=40 fontWeight="600"  TEXT: Trésorerie & cashflow
        - text «Subtitle» fill="$text-secondary" fontFamily="$font-ui" fontSize=15 fontWeight="normal"  TEXT: Ce qui entre, ce qui sort, et combien de temps ta compagnie tient sans recettes
      - frame «Key Stats» gap=44 padding=[0, 0, 4, 0]
        - ref «Stat · Solde» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "Solde"}, "GqS8d": {"content": "1 284 560 €"}, "JT5Iq": {"content": "au 6 nov. · 17:58Z", "fill": "$text-tertiary"}}  (instance of «Stat»)
        - ref «Stat · Cashflow d'octobre» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "Cashflow d'octobre"}, "GqS8d": {"content": "+221 200 €", "fill": "$success"}, "JT5Iq": {"content": "+38 400 € sur...  (instance of «Stat»)
        - ref «Stat · Autonomie» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "Autonomie"}, "GqS8d": {"content": "21 jours"}, "JT5Iq": {"content": "de dépenses sans recettes", "fill": "$text-t...  (instance of «Stat»)
        - ref «Stat · Dette restante» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "Dette restante"}, "GqS8d": {"content": "8 126 000 €"}, "JT5Iq": {"content": "2 crédits · 125 100 € / mois", "fill...  (instance of «Stat»)
    - frame «Body» width="fill_container" height="fill_container" gap=20
      - ref «Panel · Flux de trésorerie» width="fill_container" height="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Flux de trésorerie"}, "A9Tx2K": {"content": "nov. 2025 → oct. 2026", "fill": "$text-tertiary"}, "q5ftx0": {"heigh...  (instance of «Panel»)
  - ref «HUD Top» ref="a93UHQ" descendants={"Uth8f": {"stroke": "#00000000"}, "Ely3m": {"fill": "$text-tertiary"}, "daIvj": {"stroke": "$text-primary"}, "cXwn0": {"fill": "$text-pr...  (instance of «HUD/Top»)
  - ref «HUD Bottom» ref="t2yhjE"  (instance of «HUD/Bottom»)
