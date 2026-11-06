# Compagnie IA · fiche

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «Compagnie IA · fiche» width=1600 height=900 layout="none" fill="$bg" clip=true x=3400 y=6300
  - frame «Scene 3D» width=1600 height=900 fill={"type": "image", "enabled": true, "url": "images/generated-10.png", "mode": "cover"} x=0 y=0
  - rectangle «Scene Shade» width=1600 height=900 fill={"type": "gradient", "gradientType": "radial", "enabled": true, "rotation": 0, "size": {"width": 1.5, "height": 1.5}, "colors": [{"color"... x=0 y=0
  - frame «Content» width=1600 height=778 gap=56 padding=[28, 32, 24, 32] justifyContent="space_between" x=0 y=76
    - frame «Profile Column» width=560 height="fill_container" layout="vertical" justifyContent="space_between"
      - frame «Identity» width="fill_container" layout="vertical" gap=14
        - frame «Title Block» layout="vertical" gap=6
          - frame «Status» gap=8 alignItems="center"
            - text «Status Text» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: Compagnie IA · 6e au classement
          - text «Title» fill="$text-primary" fontFamily="$font-display" fontSize=30 fontWeight="600"  TEXT: Alpes Air Link
        - frame «Personality Line» gap=6 alignItems="center"
          - text «Personality» fill="$text-primary" fontFamily="$font-ui" fontSize=16 fontWeight="500"  TEXT: Prudente
          - text «Since» fill="$text-secondary" fontFamily="$font-ui" fontSize=16 fontWeight="normal"  TEXT: · active depuis la saison 3 · hub principal LSGG
        - frame «Doctrine Wrap» width="fill_container" padding=[4, 0, 0, 0]
          - text «Doctrine» width=480 fill="$text-secondary" fontFamily="$font-ui" fontSize=16 fontWeight="normal"  TEXT: Ne prend que des jobs à marge sûre, évite la météo marginale et n'emprunte jamais. Progresse lentement, recule rarement.
      - ref «Network» width="fill_container" ref="bibzm" descendants={"uBW0Z": {"enabled": false}, "q5ftx0": {"layout": "horizontal", "gap": 40, "padding": [24, 26], "children": [{"type": "frame", "id": "at...  (instance of «Panel»)
    - frame «Moves Column» width=420 height="fill_container" layout="vertical" justifyContent="end"
      - ref «Recent Moves» width="fill_container" ref="bibzm" descendants={"e0veVE": {"content": "Mouvements récents"}, "A9Tx2K": {"content": "Cette saison", "fontSize": 14, "fill": "$text-tertiary"}, "q5ftx0": ...  (instance of «Panel»)
  - ref «HUD Top» ref="a93UHQ" descendants={"Uth8f": {"stroke": {"type": "color", "color": "$text-primary", "enabled": false}}, "Ely3m": {"fill": "$text-tertiary"}, "Btj9I": {"stro... x=0 y=0  (instance of «HUD/Top»)
  - ref «HUD Bottom» ref="t2yhjE" descendants={"oFiTj": {"name": "Hint · Classement"}, "D3kro/Mw53t": {"content": "Échap"}, "XuZbG": {"content": "Classement"}, "qtpFg": {"name": "Hint... x=0 y=854  (instance of «HUD/Bottom»)
