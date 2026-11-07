# Staff · reconversion en formateur

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «Staff · reconversion en formateur» width=1600 height=900 layout="none" fill="$bg" clip=true
  - frame «Scene 3D» width=1600 height=900 fill={"type": "image", "enabled": true, "url": "images/generated-15.png", "mode": "cover"}
  - rectangle «Scene Shade» width=1600 height=900 fill={"type": "gradient", "gradientType": "radial", "enabled": true, "rotation": 0, "size": {"width": 1.5, "height": 1.5}, "colors": [{"color"...
  - frame «Content» width=1600 height=778 layout="vertical" gap=24 padding=[28, 32, 24, 32]
    - frame «Header» width="fill_container" alignItems="end" justifyContent="space_between"
      - frame «Identity» layout="vertical" gap=8
        - frame «Breadcrumb» gap=10 alignItems="center"
          - ref «Base Sign» ref="pirBQ"  (instance of «Sign/Location»)
          - text «Crumb Text» fill="$text-tertiary" fontFamily="$font-ui" fontSize=13 fontWeight="normal"  TEXT: Staff  ›  Pilotes basés à Nice  ›  Cdt. Vidal
        - frame «Status» gap=8 padding=[6, 0, 0, 0] alignItems="center"
          - ellipse «Status Dot» width=7 height=7 fill="$danger"
          - text «Status Text» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: Classe 1 refusée le 4 nov. · il ne peut plus voler en ligne, et aurait eu 65 ans le 9 mars
        - text «Title» fill="$text-primary" fontFamily="$font-display" fontSize=40 fontWeight="600"  TEXT: Reconversion de Cdt. Vidal
        - text «Subtitle» fill="$text-secondary" fontFamily="$font-ui" fontSize=15 fontWeight="normal"  TEXT: Commandant de bord · 64 ans · qualifié ATR 72-600 et A220-300 · chez Azur Régional depuis 19 ans
      - frame «Key Stats» gap=44 padding=[0, 0, 4, 0]
        - ref «Stat · Heures de vol» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "Heures de vol"}, "GqS8d": {"content": "14 200 h"}, "JT5Iq": {"content": "dont 8 300 h sur ATR", "fill": "$text-te...  (instance of «Stat»)
        - ref «Stat · Salaire actuel» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "Salaire actuel"}, "GqS8d": {"content": "11 400 €"}, "JT5Iq": {"content": "par mois · CDI", "fill": "$text-tertiar...  (instance of «Stat»)
        - ref «Stat · Moral» width="fit_content" ref="stcmC" descendants={"V6gpg0": {"content": "Moral"}, "GqS8d": {"content": "58 %"}, "JT5Iq": {"content": "en chute depuis la visite médicale", "fill": "$warni...  (instance of «Stat»)
    - frame «Body» width="fill_container" height="fill_container" gap=20
      - ref «Panel · Options» width="fill_container" height="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Que lui proposer ?"}, "A9Tx2K": {"content": "Voir sa fiche"}, "q5ftx0": {"height": "fill_container", "gap": 0, "p...  (instance of «Panel»)
      - frame «Side Column» width=400 height="fill_container" layout="vertical" gap=20
        - ref «Panel · Trou sur la ligne» width="fill_container" height="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Trou sur la ligne"}, "A9Tx2K": {"content": "Planning"}, "q5ftx0": {"height": "fill_container", "gap": 0, "padding...  (instance of «Panel»)
        - ref «Panel · Ce qu'il en dit» width="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Ce qu'il en dit"}, "A9Tx2K": {"content": "entretien du 5 nov.", "fill": "$text-tertiary"}, "q5ftx0": {"gap": 0, "...  (instance of «Panel»)
  - ref «HUD Top» ref="a93UHQ" descendants={"Uth8f": {"stroke": "#00000000"}, "Ely3m": {"fill": "$text-tertiary"}, "daIvj": {"stroke": "$text-primary"}, "cXwn0": {"fill": "$text-pr...  (instance of «HUD/Top»)
  - ref «HUD Bottom» ref="t2yhjE" descendants={"D3kro/Mw53t": {"content": "Échap"}, "XuZbG": {"content": "Retour à sa fiche"}, "msx5l/Mw53t": {"content": "1 – 4"}, "sA5qV": {"content"...  (instance of «HUD/Bottom»)
