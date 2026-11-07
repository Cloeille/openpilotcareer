# Staff · fiche d'un membre

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «Staff · fiche d'un membre» width=1600 height=900 layout="none" fill="$bg" clip=true
  - frame «Scene 3D» width=1600 height=900 fill={"type": "image", "enabled": true, "url": "images/generated-13.png", "mode": "cover"}
  - rectangle «Scene Shade» width=1600 height=900 fill={"type": "gradient", "gradientType": "radial", "enabled": true, "rotation": 0, "size": {"width": 1.5, "height": 1.5}, "colors": [{"color"...
  - frame «Content» width=1600 height=778 layout="vertical" gap=24 padding=[28, 32, 24, 32]
    - frame «Member Header» width="fill_container" alignItems="end" justifyContent="space_between"
      - frame «Identity» layout="vertical" gap=8
        - frame «Breadcrumb» gap=10 alignItems="center"
          - ref «Base Sign» ref="pirBQ"  (instance of «Sign/Location»)
          - text «Crumb Text» fill="$text-tertiary" fontFamily="$font-ui" fontSize=13 fontWeight="normal"  TEXT: Staff  ›  Pilotes basés à Nice
        - frame «Status» gap=8 padding=[6, 0, 0, 0] alignItems="center"
          - ellipse «Status Dot» width=7 height=7 fill="$warning"
          - text «Status Text» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: En vol sur AZR 1136 vers Nice · limite de service proche
        - text «Name» fill="$text-primary" fontFamily="$font-display" fontSize=40 fontWeight="600"  TEXT: Camille Lefèvre
        - text «Role» fill="$text-secondary" fontFamily="$font-ui" fontSize=15 fontWeight="normal"  TEXT: Officière pilote de ligne · qualifiée ATR 72-600 · chez Azur Régional depuis 14 mois
      - frame «Key Stats» gap=44 padding=[0, 0, 4, 0]
        - ref «Stat · Heures de vol» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "Heures de vol"}, "GqS8d": {"content": "3 412 h"}, "JT5Iq": {"content": "dont 1 180 h sur ATR", "fill": "$text-ter...  (instance of «Stat»)
        - ref «Stat · Fiabilité» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "Fiabilité"}, "GqS8d": {"content": "96 %"}, "JT5Iq": {"content": "2 retards en 90 jours", "fill": "$text-tertiary"}}  (instance of «Stat»)
        - ref «Stat · Moral» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "Moral"}, "GqS8d": {"content": "71 %"}, "JT5Iq": {"content": "en baisse · journées longues", "fill": "$warning"}}  (instance of «Stat»)
        - ref «Stat · Salaire» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "Salaire"}, "GqS8d": {"content": "6 200 €"}, "JT5Iq": {"content": "par mois · CDI", "fill": "$text-tertiary"}}  (instance of «Stat»)
    - frame «Member Body» width="fill_container" height="fill_container" gap=20
      - ref «Panel · Temps de service» width="fill_container" height="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Temps de service aujourd'hui"}, "A9Tx2K": {"content": "Planning de la semaine"}, "q5ftx0": {"height": "fill_conta...  (instance of «Panel»)
      - frame «Side Column» width=400 height="fill_container" layout="vertical" gap=20
        - ref «Panel · Qualifications» width="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Qualifications"}, "A9Tx2K": {"content": "Former", "fill": "$text-primary"}, "q5ftx0": {"gap": 0, "padding": [6, 2...  (instance of «Panel»)
        - ref «Panel · Contrat & affectation» width="fill_container" height="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Contrat & affectation"}, "A9Tx2K": {"enabled": false}, "q5ftx0": {"gap": 10, "height": "fill_container", "childre...  (instance of «Panel»)
  - ref «HUD Top» ref="a93UHQ" descendants={"Uth8f": {"stroke": "#00000000"}, "Ely3m": {"fill": "$text-tertiary"}, "daIvj": {"stroke": "$text-primary"}, "cXwn0": {"fill": "$text-pr...  (instance of «HUD/Top»)
  - ref «HUD Bottom» ref="t2yhjE" descendants={"D3kro/Mw53t": {"content": "Échap"}, "XuZbG": {"content": "Retour aux effectifs"}, "msx5l/Mw53t": {"content": "← →"}, "sA5qV": {"content...  (instance of «HUD/Bottom»)
