# Finance · nouveau crédit conso

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «Finance · nouveau crédit conso» width=1600 height=900 layout="none" fill="$bg" clip=true
  - frame «Scene 3D» width=1600 height=900 fill={"type": "image", "enabled": true, "url": "images/generated-11.png", "mode": "cover"}
  - rectangle «Scene Shade» width=1600 height=900 fill={"type": "gradient", "gradientType": "radial", "enabled": true, "rotation": 0, "size": {"width": 1.5, "height": 1.5}, "colors": [{"color"...
  - frame «Content» width=1600 height=778 padding=[28, 32, 24, 32] justifyContent="space_between"
    - frame «Loan Column» width=760 height="fill_container" layout="vertical" gap=24
      - frame «Title Block» width="fill_container" layout="vertical" gap=6
        - text «Breadcrumb» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: Finance · crédits
        - text «Title» fill="$text-primary" fontFamily="$font-display" fontSize=30 fontWeight="600"  TEXT: Nouveau crédit conso
        - text «Sub» width="fill_container" fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="normal"  TEXT: Versé sur ton solde et libre d'usage : salaires, installations, creux de trésorerie. Sans avion en garantie, le taux est plus élevé qu'un crédit avion.
      - ref «Loan Panel» width="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Montant et durée"}, "A9Tx2K": {"content": "Banque des Alpes · 7,2 %", "fill": "$text-tertiary"}, "q5ftx0": {"padd...  (instance of «Panel»)
    - frame «Offers Column» width=620 height="fill_container" layout="vertical" gap=20
      - ref «Offers Panel» width="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Offres pour ta note B+"}, "A9Tx2K": {"content": "3 banques", "fill": "$text-tertiary"}, "q5ftx0": {"padding": [8,...  (instance of «Panel»)
      - ref «Recap Panel» width="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Après signature"}, "A9Tx2K": {"content": "Premier prélèvement le 6 décembre", "fill": "$text-tertiary"}, "q5ftx0"...  (instance of «Panel»)
  - ref «HUD Top» ref="a93UHQ" descendants={"Uth8f": {"stroke": "#00000000"}, "Ely3m": {"fill": "$text-tertiary"}, "daIvj": {"stroke": "$text-primary"}, "cXwn0": {"fill": "$text-pr...  (instance of «HUD/Top»)
  - ref «HUD Bottom» ref="t2yhjE" descendants={"vdllS": {"type": "frame", "id": "j9kXIm", "name": "Hints", "gap": 22, "alignItems": "center", "children": [{"type": "frame", "id": "oPg...  (instance of «HUD/Bottom»)
