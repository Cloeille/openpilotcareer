# Sécurité · fatigue & incidents

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «Sécurité · fatigue & incidents» width=1600 height=900 layout="none" fill="$bg" clip=true
  - frame «Scene 3D» width=1600 height=900 fill={"type": "image", "enabled": true, "url": "images/generated-13.png", "mode": "cover"}
  - rectangle «Scene Shade» width=1600 height=900 fill={"type": "gradient", "gradientType": "radial", "enabled": true, "rotation": 0, "size": {"width": 1.5, "height": 1.5}, "colors": [{"color"...
  - frame «Content» width=1600 height=778 layout="vertical" gap=24 padding=[28, 32, 24, 32]
    - frame «Safety Header» width="fill_container" alignItems="end" justifyContent="space_between"
      - frame «Identity» layout="vertical" gap=8
        - frame «Breadcrumb» gap=10 alignItems="center"
          - ref «Base Sign» ref="pirBQ"  (instance of «Sign/Location»)
          - text «Crumb Text» fill="$text-tertiary" fontFamily="$font-ui" fontSize=13 fontWeight="normal"  TEXT: Compagnie  ›  Sécurité
        - frame «Status» gap=8 padding=[6, 0, 0, 0] alignItems="center"
          - ellipse «Status Dot» width=7 height=7 fill="$warning"
          - text «Status Text» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: Risque en hausse depuis lundi · un vol de ce soir dépasserait la limite de service
        - text «Title» fill="$text-primary" fontFamily="$font-display" fontSize=40 fontWeight="600"  TEXT: Sécurité des vols
      - frame «Key Stats» gap=36 padding=[0, 0, 4, 0] alignItems="end"
        - ref «Stat · Indice de sécurité» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "Indice de sécurité"}, "GqS8d": {"content": "72 / 100", "fontSize": 40}, "JT5Iq": {"content": "−6 depuis lundi", "...  (instance of «Stat»)
        - rectangle «Divider» width=1 height=64 fill="$border-strong"
        - frame «Factor · Fatigue des équipages» width=196 layout="vertical" gap=8
          - ref «Stat» width="fill_container" ref="stcmC" descendants={"V6gpg0": {"content": "Fatigue des équipages"}, "GqS8d": {"content": "27 / 40", "fontSize": 26}, "JT5Iq": {"content": "repos courts · 34...  (instance of «Stat»)
          - frame «Bar Track» width="fill_container" height=3 layout="none" fill="#FFFFFF1F"
            - rectangle «Bar Fill» width=132 height=3 fill="$warning"
        - frame «Factor · État des avions» width=196 layout="vertical" gap=8
          - ref «Stat» width="fill_container" ref="stcmC" descendants={"V6gpg0": {"content": "État des avions"}, "GqS8d": {"content": "29 / 40", "fontSize": 26}, "JT5Iq": {"content": "usure de F-HAZC · 3 rép...  (instance of «Stat»)
          - frame «Bar Track» width="fill_container" height=3 layout="none" fill="#FFFFFF1F"
            - rectangle «Bar Fill» width=142 height=3 fill="$text-primary"
        - frame «Factor · Formation» width=196 layout="vertical" gap=8
          - ref «Stat» width="fill_container" ref="stcmC" descendants={"V6gpg0": {"content": "Formation"}, "GqS8d": {"content": "16 / 20", "fontSize": 26}, "JT5Iq": {"content": "1 contrôle simulateur à repas...  (instance of «Stat»)
          - frame «Bar Track» width="fill_container" height=3 layout="none" fill="#FFFFFF1F"
            - rectangle «Bar Fill» width=157 height=3 fill="$text-primary"
    - frame «Safety Body» width="fill_container" height="fill_container" gap=20
      - ref «Panel · Risque d'incident» width="fill_container" height="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Risque d'incident par vol"}, "A9Tx2K": {"content": "Détail du calcul"}, "q5ftx0": {"gap": 16, "height": "fill_con...  (instance of «Panel»)
      - frame «Side Column» width=440 height="fill_container" layout="vertical" gap=20
        - ref «Panel · Incidents de la saison» width="fill_container" height="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Incidents de la saison"}, "A9Tx2K": {"content": "Journal complet"}, "q5ftx0": {"gap": 0, "height": "fill_containe...  (instance of «Panel»)
  - ref «HUD Top» ref="a93UHQ" descendants={"Uth8f": {"stroke": "#00000000"}, "Ely3m": {"fill": "$text-tertiary"}, "daIvj": {"stroke": "$text-primary"}, "cXwn0": {"fill": "$text-pr...  (instance of «HUD/Top»)
  - ref «HUD Bottom» ref="t2yhjE" descendants={"D3kro/Mw53t": {"content": "Échap"}, "XuZbG": {"content": "Retour à la compagnie"}, "msx5l/Mw53t": {"content": "↑ ↓"}, "sA5qV": {"conten...  (instance of «HUD/Bottom»)
