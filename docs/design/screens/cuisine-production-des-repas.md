# Cuisine · production des repas

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «Cuisine · production des repas» width=1600 height=900 layout="none" fill="$bg" clip=true
  - frame «Scene 3D» width=1600 height=900 fill={"type": "image", "enabled": true, "url": "images/generated-13.png", "mode": "cover"}
  - rectangle «Scene Shade» width=1600 height=900 fill={"type": "gradient", "gradientType": "radial", "enabled": true, "rotation": 0, "size": {"width": 1.5, "height": 1.5}, "colors": [{"color"...
  - frame «Content» width=1600 height=778 layout="vertical" gap=24 padding=[28, 32, 24, 32]
    - frame «Kitchen Header» width="fill_container" alignItems="end" justifyContent="space_between"
      - frame «Identity» layout="vertical" gap=8
        - frame «Breadcrumb» gap=10 alignItems="center"
          - ref «Base Sign» ref="pirBQ"  (instance of «Sign/Location»)
          - text «Crumb Text» fill="$text-tertiary" fontFamily="$font-ui" fontSize=13 fontWeight="normal"  TEXT: Compagnie  ›  Restauration à bord
        - frame «Status» gap=8 padding=[6, 0, 0, 0] alignItems="center"
          - ellipse «Status Dot» width=7 height=7 fill="$warning"
          - text «Status Text» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: Repas chauds d'AZR 4131 vers Paris en retard de 12 minutes
        - text «Title» fill="$text-primary" fontFamily="$font-display" fontSize=40 fontWeight="600"  TEXT: Cuisine centrale de Nice
        - text «Role» fill="$text-secondary" fontFamily="$font-ui" fontSize=15 fontWeight="normal"  TEXT: Exploitée en propre · zone fret de Nice-Côte d'Azur · production du vendredi 6 novembre
      - frame «Key Stats» gap=44 padding=[0, 0, 4, 0]
        - ref «Stat · Repas à produire» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "Repas à produire"}, "GqS8d": {"content": "548"}, "JT5Iq": {"content": "312 collations · 236 repas chauds", "fill"...  (instance of «Stat»)
        - ref «Stat · Capacité du jour» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "Capacité du jour"}, "GqS8d": {"content": "620"}, "JT5Iq": {"content": "515 ce soir · un cuisinier absent", "fill"...  (instance of «Stat»)
        - ref «Stat · Marge brute» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "Marge brute"}, "GqS8d": {"content": "46 %"}, "JT5Iq": {"content": "environ 2 300 € sur la journée", "fill": "$tex...  (instance of «Stat»)
    - frame «Kitchen Body» width="fill_container" height="fill_container" gap=20
      - ref «Panel · Niveau de qualité» width="fill_container" height="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Niveau de qualité des repas"}, "A9Tx2K": {"content": "Simuler sur 7 jours"}, "q5ftx0": {"height": "fill_container...  (instance of «Panel»)
      - frame «Side Column» width=520 height="fill_container" layout="vertical" gap=20
        - ref «Panel · Plan de production» width="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Départs de ce soir"}, "A9Tx2K": {"content": "Plan de la journée"}, "q5ftx0": {"gap": 0, "padding": [10, 22, 20, 2...  (instance of «Panel»)
        - ref «Panel · Cuisine ou sous-traitance» width="fill_container" height="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Cuisine en propre ou sous-traitance"}, "A9Tx2K": {"content": "Demander un devis"}, "q5ftx0": {"height": "fill_con...  (instance of «Panel»)
  - ref «HUD Top» ref="a93UHQ" descendants={"Uth8f": {"stroke": "#00000000"}, "Ely3m": {"fill": "$text-tertiary"}, "daIvj": {"stroke": "$text-primary"}, "cXwn0": {"fill": "$text-pr...  (instance of «HUD/Top»)
  - ref «HUD Bottom» ref="t2yhjE" descendants={"D3kro/Mw53t": {"content": "Échap"}, "XuZbG": {"content": "Retour au hub"}, "msx5l/Mw53t": {"content": "← →"}, "sA5qV": {"content": "Niv...  (instance of «HUD/Bottom»)
