# Connexion · variante échec du sondage

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «Connexion · variante échec du sondage» width=600 layout="vertical" gap=20 padding=[28, 50, 50, 50] fill=[{"type": "image", "enabled": true, "url": "images/generated.png", "mode": "cover"}, "$scene-scrim"] clip=true x=5100 y=800
  - text «Caption» fill="$text-tertiary" fontFamily="$font-ui" fontSize=13 fontWeight="normal"  TEXT: Variante : le serveur ne répond pas
  - frame «Title Block» layout="vertical" gap=6
    - frame «Status» gap=8 alignItems="center"
      - text «Status Text» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: Étape 1 sur 2 · serveur et compte
    - text «Title» fill="$text-primary" fontFamily="$font-display" fontSize=30 fontWeight="600"  TEXT: Connexion
  - ref «Panel · Connexion (échec)» width="fill_container" ref="bibzm" descendants={"uBW0Z": {"padding": [26, 28, 0, 28], "enabled": false}, "e0veVE": {"content": "Connexion", "fontSize": 20}, "A9Tx2K": {"enabled": false...  (instance of «Panel»)
