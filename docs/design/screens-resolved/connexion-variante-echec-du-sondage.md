# Connexion · variante échec du sondage

Resolved tree (component instances expanded with their overrides; HUD bars referenced). Rendered image: renders/<slug>.webp when the frame is a 1600x900 screen.

- frame «Connexion · variante échec du sondage» width=600 layout="vertical" gap=20 padding=[28, 50, 50, 50] fill=[{"type": "image", "enabled": true, "url": "images/generated.png", "mode": "cover"}, "$...
  - text «Caption» fill="$text-tertiary" fontFamily="$font-ui" fontSize=13 fontWeight="normal"  TEXT: Variante : le serveur ne répond pas
  - frame «Title Block» layout="vertical" gap=6
    - frame «Status» gap=8 alignItems="center"
      - text «Status Text» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: Étape 1 sur 2 · serveur et compte
    - text «Title» fill="$text-primary" fontFamily="$font-display" fontSize=30 fontWeight="600"  TEXT: Connexion
  - instance «Panel · Connexion (échec)» of «Panel»
    - frame «Content» width="fill_container" height="fit_content(80)" layout="vertical" gap=32 padding=28
      - frame «Server» width="fill_container" layout="vertical" gap=12
        - text «Label» fill="$text-secondary" fontFamily="$font-ui" fontSize=13 fontWeight="500"  TEXT: Serveur
        - frame «Server Choice» width="fill_container" gap=3 padding=3 fill="$surface-sunken" stroke="$border" strokeWidth=1 cornerRadius=4
          - frame «Option · Serveur global» width="fill_container" height=36 alignItems="center" justifyContent="center" cornerRadius=3
            - text «Label» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: Serveur global
          - frame «Option · Serveur personnalisé» width="fill_container" height=36 alignItems="center" justifyContent="center" fill="$surface-raised" stroke="$border-strong" strokeWidth=1 cornerRadius=3
            - text «Label» fill="$text-primary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: Serveur personnalisé
        - instance «Input · Adresse du serveur» of «Input»
          - frame «Field» width="fill_container" height=44 gap=10 padding=[0, 12] alignItems="center" fill="$surface-sunken" stroke="$border-strong" strokeWidth=1 cornerRadius=3
            - icon «Icon» width=16 height=16 fill="$text-tertiary" icon="link"
            - text «Value» width="fill_container" fill="$text-primary" fontFamily="$font-mono" fontSize=14 fontWeight="normal"  TEXT: https://vol.lesailesdusud.org
        - frame «Probe · Échec» width="fill_container" gap=10 padding=[2, 0, 0, 2]
          - icon «Icon» width=16 height=16 fill="$danger" icon="circle-alert"
          - frame «Stack» width="fill_container" layout="vertical" gap=3
            - text «Status» fill="$text-primary" fontFamily="$font-ui" fontSize=14 fontWeight="600"  TEXT: Serveur injoignable
            - text «Message» width="fill_container" fill="$text-tertiary" fontFamily="$font-ui" fontSize=13 fontWeight="normal" lineHeight=1.35  TEXT: Aucune réponse après 5 s. Vérifie l'adresse ou réessaie plus tard.
          - instance «Button · Réessayer» of «Button/Ghost»
            - text «Label» fill="$text-primary" fontFamily="$font-ui" fontSize=13 fontWeight="500"  TEXT: Réessayer
            - icon «Icon» width=14 height=14 fill="$text-secondary" icon="rotate-cw"
      - text «Pending» fill="$text-tertiary" fontFamily="$font-ui" fontSize=13 fontWeight="normal"  TEXT: Les identifiants s'affichent une fois le serveur joignable.
