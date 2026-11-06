# Flotte · nouvelle compagnie

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «Flotte · nouvelle compagnie» width=1600 height=900 layout="none" fill="$bg" clip=true
  - frame «Scene 3D» width=1600 height=900 fill={"type": "image", "enabled": true, "url": "images/generated-6.png", "mode": "cover"}
  - rectangle «Scene Shade» width=1600 height=900 fill={"type": "gradient", "gradientType": "radial", "enabled": true, "rotation": 0, "size": {"width": 1.5, "height": 1.5}, "colors": [{"color"...
  - frame «Content» width=1600 height=778 padding=[28, 32, 24, 32] justifyContent="space_between"
    - frame «Choice Column» width=780 height="fill_container" layout="vertical" gap=28
      - frame «Title Block» width="fill_container" layout="vertical" gap=6
        - frame «Status» gap=8 alignItems="center"
          - text «Status Text» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: Azur Régional · AZR · nouvelle compagnie
        - text «Title» fill="$text-primary" fontFamily="$font-display" fontSize=30 fontWeight="600"  TEXT: Choisis ton premier avion
        - text «Sub» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="normal"  TEXT: Ta flotte est vide. La location te permet de démarrer sans entamer ton capital de 1 500 000 €.
      - ref «Starter Panel» width="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Avions de départ"}, "A9Tx2K": {"content": "3 dans ton budget", "fill": "$text-tertiary"}, "q5ftx0": {"padding": [...  (instance of «Panel»)
      - ref «Hub Panel» width="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Base d'attache"}, "A9Tx2K": {"content": "Le premier hub est offert", "fill": "$text-tertiary"}, "q5ftx0": {"layou...  (instance of «Panel»)
    - frame «Summary Column» width=420 height="fill_container" layout="vertical"
      - ref «Summary Panel» width="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Récapitulatif"}, "A9Tx2K": {"content": "Avant le premier vol", "fill": "$text-tertiary"}, "q5ftx0": {"padding": [...  (instance of «Panel»)
  - ref «HUD Top» ref="a93UHQ" descendants={"Uth8f": {"stroke": {"type": "color", "color": "$text-primary", "enabled": false}}, "Ely3m": {"fill": "$text-tertiary"}, "tTPky": {"enab...  (instance of «HUD/Top»)
  - ref «HUD Bottom» ref="t2yhjE" descendants={"vdllS": {"type": "frame", "id": "XymTh", "name": "Hints", "gap": 22, "alignItems": "center", "children": [{"type": "frame", "id": "L3xS...  (instance of «HUD/Bottom»)
