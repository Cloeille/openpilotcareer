# Comparaison IA

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «Comparaison IA» width=1600 height=900 layout="none" fill="$bg" clip=true
  - frame «Scene 3D» width=1600 height=900 fill={"type": "image", "enabled": true, "url": "images/generated-10.png", "mode": "cover"}
  - rectangle «Scene Shade» width=1600 height=900 fill={"type": "gradient", "gradientType": "radial", "enabled": true, "rotation": 0, "size": {"width": 1.5, "height": 1.5}, "colors": [{"color"...
  - frame «Content» width=1600 height=778 layout="vertical" padding=[28, 32, 24, 32] justifyContent="space_between"
    - frame «Versus Top» width="fill_container" layout="vertical" gap=14
      - frame «Versus Header» width="fill_container" alignItems="end" justifyContent="space_between"
        - frame «Title Block · Azur Régional» width="fill_container" layout="vertical" gap=6
          - frame «Status» gap=8 alignItems="center"
            - text «Status Text» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: Toi · 7e cette saison
          - text «Title» fill="$text-primary" fontFamily="$font-display" fontSize=30 fontWeight="600"  TEXT: Azur Régional
        - frame «Versus Center» width=200 layout="vertical" gap=4 padding=[0, 0, 2, 0] alignItems="center"
          - text «VS» fill="$text-tertiary" fontFamily="$font-display" fontSize=20 fontWeight="500"  TEXT: vs
          - text «Score» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="normal"  TEXT: Égalité, 3 à 3
        - frame «Title Block · Alpes Air Link» width="fill_container" layout="vertical" gap=6 alignItems="end"
          - frame «Status» gap=8 alignItems="center"
            - text «Status Text» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: IA prudente · 6e cette saison
          - text «Title» fill="$text-primary" fontFamily="$font-display" fontSize=30 fontWeight="600"  TEXT: Alpes Air Link
    - frame «Versus Deck» width="fill_container" gap=20 justifyContent="center"
      - ref «Duel» width=820 height="fit_content" ref="bibzm" descendants={"uBW0Z": {"enabled": false}, "G3dgU": {"enabled": false}, "e0veVE": {"content": "Duel de saison"}, "A9Tx2K": {"content": "Égalité, 3 à 3...  (instance of «Panel»)
  - ref «HUD Top» ref="a93UHQ" descendants={"Uth8f": {"stroke": {"type": "color", "color": "$text-primary", "enabled": false}}, "Ely3m": {"fill": "$text-tertiary"}, "Btj9I": {"stro...  (instance of «HUD/Top»)
  - ref «HUD Bottom» ref="t2yhjE" descendants={"oFiTj": {"name": "Hint · Classement"}, "D3kro/Mw53t": {"content": "Échap"}, "XuZbG": {"content": "Classement"}, "qtpFg": {"name": "Hint...  (instance of «HUD/Bottom»)
