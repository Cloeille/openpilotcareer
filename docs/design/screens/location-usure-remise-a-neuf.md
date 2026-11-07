# Location · usure & remise à neuf

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «Location · usure & remise à neuf» width=1600 height=900 layout="none" fill="$bg" clip=true
  - frame «Scene 3D» width=1600 height=900 fill={"type": "image", "enabled": true, "url": "images/generated-5.png", "mode": "cover"}
  - rectangle «Scene Shade» width=1600 height=900 fill={"type": "gradient", "gradientType": "radial", "enabled": true, "rotation": 0, "size": {"width": 1.5, "height": 1.5}, "colors": [{"color"...
  - frame «Content» width=1600 height=778 layout="vertical" gap=20 padding=[24, 32, 20, 32]
    - frame «Header» width="fill_container" alignItems="end" justifyContent="space_between"
      - frame «Identity» layout="vertical" gap=8
        - frame «Breadcrumb» gap=10 alignItems="center"
          - ref «Base Sign» ref="pirBQ"  (instance of «Sign/Location»)
          - text «Crumb Text» fill="$text-tertiary" fontFamily="$font-ui" fontSize=13 fontWeight="normal"  TEXT: Flotte  ›  F-HAZG en location
        - text «Title» fill="$text-primary" fontFamily="$font-display" fontSize=40 fontWeight="600"  TEXT: Usure & remise à neuf
        - text «Sub» fill="$text-secondary" fontFamily="$font-ui" fontSize=15 fontWeight="normal"  TEXT: DHC-6 Twin Otter 400 F-HAZG · occasion de 2015, 6 840 h de vol · loué à Viking Air Leasing, encore 24 mois
      - frame «Key Stats» gap=44 padding=[0, 0, 4, 0]
        - ref «Stat · Performance» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "Performance"}, "GqS8d": {"content": "−4 %"}, "JT5Iq": {"content": "−3 % après vos choix", "fill": "$text-tertiary"}}  (instance of «Stat»)
        - ref «Stat · Fiabilité» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "Fiabilité"}, "GqS8d": {"content": "91 %"}, "JT5Iq": {"content": "96 % après vos choix", "fill": "$text-tertiary"}}  (instance of «Stat»)
        - ref «Stat · Satisfaction passagers» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "Satisfaction passagers"}, "GqS8d": {"content": "3,4 / 5"}, "JT5Iq": {"content": "3,9 / 5 après vos choix", "fill"...  (instance of «Stat»)
    - frame «Body» width="fill_container" height="fill_container" gap=20
      - ref «Panel · Composant par composant» width="fill_container" height="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Composant par composant"}, "A9Tx2K": {"content": "Calcul pour une restitution en octobre 2028", "fill": "$text-te...  (instance of «Panel»)
      - ref «Panel · Investir dans un avion loué» width=400 height="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Investir dans un avion loué ?"}, "A9Tx2K": {"enabled": false}, "q5ftx0": {"height": "fill_container", "gap": 16, ...  (instance of «Panel»)
  - ref «HUD Top» ref="a93UHQ" descendants={"Uth8f": {"stroke": {"type": "color", "color": "$text-primary", "enabled": false}}, "Ely3m": {"fill": "$text-tertiary"}, "K11dL": {"stro...  (instance of «HUD/Top»)
  - ref «HUD Bottom» ref="t2yhjE" descendants={"oFiTj": {"name": "Hint · Retour"}, "D3kro/Mw53t": {"content": "Échap"}, "XuZbG": {"content": "Retour"}, "qtpFg": {"name": "Hint · Compo...  (instance of «HUD/Bottom»)
