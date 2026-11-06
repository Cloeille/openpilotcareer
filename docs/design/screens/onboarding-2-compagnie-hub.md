# Onboarding · 2 compagnie & hub

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «Onboarding · 2 compagnie & hub» width=1600 height=900 layout="none" fill="$bg" clip=true
  - frame «Scene 3D» width=1600 height=900 fill={"type": "image", "enabled": true, "url": "images/generated-3.png", "mode": "cover"}
  - rectangle «Scene Shade» width=1600 height=900 fill={"type": "gradient", "gradientType": "radial", "enabled": true, "rotation": 0, "size": {"width": 1.5, "height": 1.5}, "colors": [{"color"...
  - frame «Content» width=1600 height=778 layout="vertical" gap=32 padding=[40, 64, 36, 64] justifyContent="space_between"
    - frame «Title Block» layout="vertical" gap=8
      - text «Overline» fill="$text-secondary" fontFamily="$font-ui" fontSize=15 fontWeight="normal"  TEXT: Parcours airliner · compagnie et hub
      - text «Title» fill="$text-primary" fontFamily="$font-display" fontSize=52 fontWeight="600"  TEXT: Fonde ta compagnie
      - text «Sub» width=720 fill="$text-secondary" fontFamily="$font-ui" fontSize=16 fontWeight="normal"  TEXT: Donne-lui un nom, un code et une base. C'est de ton hub que partiront tes premiers jobs, et c'est là que tes avions passeront la nuit.
    - frame «Main Row» width="fill_container" gap=24
      - ref «Panel · Compagnie» width=480 height="fit_content" ref="bibzm" descendants={"e0veVE": {"content": "Compagnie"}, "A9Tx2K": {"enabled": false}, "q5ftx0": {"gap": 18, "padding": [20, 24, 24, 24], "children": [{"id":...  (instance of «Panel»)
      - ref «Panel · Hub principal» width="fill_container" height="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Hub principal"}, "A9Tx2K": {"content": "Suggestions adaptées au parcours airliner", "fill": "$text-tertiary", "en...  (instance of «Panel»)
    - frame «Footer» width="fill_container" alignItems="center" justifyContent="space_between"
      - text «Footer Note» fill="$text-tertiary" fontFamily="$font-ui" fontSize=14 fontWeight="normal"  TEXT: Tu pourras ouvrir d'autres bases quand ta flotte grandira.
      - ref «Continue» ref="Im067" descendants={"h8MyJ": {"content": "Choisir mon premier avion"}}  (instance of «Button/Primary»)
  - ref «HUD Onboarding» ref="uCkER" descendants={"TZdq9": {"fill": "#FFFFFF1F", "stroke": "#00000000"}, "cyUlI": {"enabled": false}, "R9K1Zp": {"enabled": true}, "eP7CE": {"fill": "$tex...  (instance of «HUD/Onboarding»)
  - ref «HUD Bottom» ref="t2yhjE" descendants={"D3kro/Mw53t": {"content": "Échap"}, "XuZbG": {"content": "Étape précédente"}, "msx5l/Mw53t": {"content": "Tab"}, "sA5qV": {"content": "...  (instance of «HUD/Bottom»)
