# Finance · relevé des opérations

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «Finance · relevé des opérations» width=1600 height=900 layout="none" fill="$bg" clip=true
  - frame «Scene 3D» width=1600 height=900 fill={"type": "image", "enabled": true, "url": "images/generated-11.png", "mode": "cover"}
  - rectangle «Scene Shade» width=1600 height=900 fill={"type": "gradient", "gradientType": "radial", "enabled": true, "rotation": 0, "size": {"width": 1.5, "height": 1.5}, "colors": [{"color"...
  - frame «Content» width=1600 height=778 layout="vertical" gap=22 padding=[28, 32, 24, 32]
    - frame «Statement Header» width="fill_container" alignItems="end" justifyContent="space_between"
      - frame «Title Block» layout="vertical" gap=6
        - frame «Status» gap=8 alignItems="center"
          - ellipse «Status Dot» width=7 height=7 fill="$success"
          - text «Status Text» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: Compte courant Azur Régional · Banque Riviera
        - text «Title» fill="$text-primary" fontFamily="$font-display" fontSize=30 fontWeight="600"  TEXT: Relevé des opérations
      - frame «Key Stats» gap=44 padding=[0, 0, 4, 0]
        - ref «Stat · Découvert autorisé» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "Découvert autorisé"}, "GqS8d": {"content": "250 000 €", "fill": "$text-secondary"}, "JT5Iq": {"content": "à 11,5 ...  (instance of «Stat»)
        - ref «Stat · Solde» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "Solde au 6 novembre, 17:52Z"}, "GqS8d": {"content": "1 284 560 €"}, "JT5Iq": {"content": "+132 840 € depuis le 1e...  (instance of «Stat»)
    - frame «Filters» width="fill_container" alignItems="center" justifyContent="space_between"
      - frame «Filter Group» gap=12 alignItems="center"
        - ref «Period Switcher» ref="a7ZUZ" descendants={"wmERV": {"fill": "#00000000"}, "NWATU": {"content": "Cette semaine", "fill": "$text-secondary"}, "z8pczc": {"fill": "#FFFFFF1A"}, "JvCP...  (instance of «View Switcher»)
        - ref «Btn · Autre période» ref="n9Pulf" descendants={"RUCj0": {"content": "Autre période", "fill": "$text-secondary"}, "xcWI8": {"icon": "calendar-range", "fill": "$text-tertiary"}}  (instance of «Button/Ghost»)
        - rectangle «Filter Divider» width=1 height=24 fill="$border-strong"
        - frame «Select · Catégorie» height=42 gap=8 padding=[0, 14] alignItems="center" fill="$surface" stroke="$border" strokeWidth=1 cornerRadius=6 effect={"type": "background_blur", "radius": 20}
          - icon «Icon» width=15 height=15 fill="$text-tertiary" icon="tags"
          - text «Label» fill="$text-tertiary" fontFamily="$font-ui" fontSize=14 fontWeight="normal"  TEXT: Catégorie
          - text «Value» fill="$text-primary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: Toutes
          - icon «Chevron» width=15 height=15 fill="$text-secondary" icon="chevron-down"
        - frame «Select · Ligne» height=42 gap=8 padding=[0, 14] alignItems="center" fill="$surface" stroke="$border" strokeWidth=1 cornerRadius=6 effect={"type": "background_blur", "radius": 20}
          - icon «Icon» width=15 height=15 fill="$text-tertiary" icon="route"
          - text «Label» fill="$text-tertiary" fontFamily="$font-ui" fontSize=14 fontWeight="normal"  TEXT: Ligne
          - text «Value» fill="$text-primary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: Toutes les lignes
          - icon «Chevron» width=15 height=15 fill="$text-secondary" icon="chevron-down"
      - ref «Btn · Exporter en CSV» ref="v6he7" descendants={"RU69u": {"icon": "download"}, "BxHlG": {"content": "Exporter en CSV"}}  (instance of «Button/Secondary»)
    - frame «Statement Body» width="fill_container" height="fill_container" gap=20
      - ref «Panel · Relevé» width="fill_container" height="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Novembre, du 1er au 6"}, "A9Tx2K": {"content": "148 opérations · les plus récentes en premier", "fill": "$text-te...  (instance of «Panel»)
      - ref «Panel · Synthèse» width=380 height="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Synthèse de la période"}, "A9Tx2K": {"content": "1er – 6 nov.", "fill": "$text-tertiary"}, "q5ftx0": {"height": "...  (instance of «Panel»)
  - ref «HUD Top» ref="a93UHQ" descendants={"Uth8f": {"stroke": "#00000000"}, "Ely3m": {"fill": "$text-tertiary"}, "daIvj": {"stroke": "$text-primary"}, "cXwn0": {"fill": "$text-pr...  (instance of «HUD/Top»)
  - ref «HUD Bottom» ref="t2yhjE" descendants={"vdllS": {"type": "frame", "id": "vXpph", "name": "Hints", "gap": 22, "alignItems": "center", "children": [{"type": "frame", "id": "D3LE...  (instance of «HUD/Bottom»)
