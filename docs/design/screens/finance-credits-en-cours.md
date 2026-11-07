# Finance · crédits en cours

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «Finance · crédits en cours» width=1600 height=900 layout="none" fill="$bg" clip=true
  - frame «Scene 3D» width=1600 height=900 fill={"type": "image", "enabled": true, "url": "images/generated-11.png", "mode": "cover"}
  - rectangle «Scene Shade» width=1600 height=900 fill={"type": "gradient", "gradientType": "radial", "enabled": true, "rotation": 0, "size": {"width": 1.5, "height": 1.5}, "colors": [{"color"...
  - frame «Content» width=1600 height=778 layout="vertical" gap=24 padding=[28, 32, 24, 32]
    - frame «Credit Header» width="fill_container" alignItems="end" justifyContent="space_between"
      - frame «Identity» layout="vertical" gap=8
        - frame «Breadcrumb» gap=10 alignItems="center"
          - ref «Base Sign» ref="pirBQ"  (instance of «Sign/Location»)
          - text «Crumb Text» fill="$text-tertiary" fontFamily="$font-ui" fontSize=13 fontWeight="normal"  TEXT: Compagnie  ›  Finance
        - frame «Status» gap=8 padding=[6, 0, 0, 0] alignItems="center"
          - ellipse «Status Dot» width=7 height=7 fill="$success"
          - text «Status Text» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: Échéances à jour · prochain prélèvement de 125 100 € le 15 novembre
        - text «Title» fill="$text-primary" fontFamily="$font-display" fontSize=40 fontWeight="600"  TEXT: Crédits en cours
        - text «Subtitle» fill="$text-secondary" fontFamily="$font-ui" fontSize=15 fontWeight="normal"  TEXT: Azur Régional · 8 126 000 € restant dû sur 10 000 000 € empruntés
      - frame «Key Stats» gap=44 padding=[0, 0, 4, 0]
        - ref «Stat · Mensualités» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "Mensualités"}, "GqS8d": {"content": "125 100 €"}, "JT5Iq": {"content": "par mois, deux crédits", "fill": "$text-t...  (instance of «Stat»)
        - ref «Stat · Endettement» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "Endettement"}, "GqS8d": {"content": "6,1 %"}, "JT5Iq": {"content": "des 2 049 600 € reçus en octobre", "fill": "$...  (instance of «Stat»)
        - ref «Stat · Encore empruntable» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "Encore empruntable"}, "GqS8d": {"content": "940 000 €"}, "JT5Iq": {"content": "en crédit conso, sans garantie", "...  (instance of «Stat»)
        - ref «Stat · Note de crédit» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "Note de crédit"}, "GqS8d": {"content": "A−"}, "JT5Iq": {"content": "stable depuis août", "fill": "$text-tertiary"}}  (instance of «Stat»)
    - frame «Credit Body» width="fill_container" height="fill_container" gap=20
      - ref «Panel · Échéancier» width="fill_container" height="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Échéancier jusqu'en 2033"}, "A9Tx2K": {"content": "Simuler un remboursement anticipé"}, "q5ftx0": {"type": "frame...  (instance of «Panel»)
      - ref «Panel · Détail par crédit» width=520 height="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Détail par crédit"}, "A9Tx2K": {"content": "Voir les contrats"}, "q5ftx0": {"type": "frame", "id": "O3OrUD", "nam...  (instance of «Panel»)
  - ref «HUD Top» ref="a93UHQ" descendants={"Uth8f": {"stroke": "#00000000"}, "Ely3m": {"fill": "$text-tertiary"}, "daIvj": {"stroke": "$text-primary"}, "cXwn0": {"fill": "$text-pr...  (instance of «HUD/Top»)
  - ref «HUD Bottom» ref="t2yhjE" descendants={"vdllS": {"type": "frame", "id": "y3Ngwn", "name": "Hints", "gap": 22, "alignItems": "center", "children": [{"type": "frame", "id": "Qcv...  (instance of «HUD/Bottom»)
