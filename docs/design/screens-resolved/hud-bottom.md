# HUD/Bottom

Resolved tree (component instances expanded with their overrides; HUD bars referenced). Rendered image: renders/<slug>.webp when the frame is a 1600x900 screen.

- frame «HUD/Bottom» width=1600 height=46 padding=[0, 32] alignItems="center" justifyContent="space_between" fill=gradient
  - frame «Status» gap=28 alignItems="center"
    - frame «Bridge» gap=8 alignItems="center"
      - ellipse «Bridge Dot» width=7 height=7 fill="$success"
      - text «Bridge Label» fill="$text-secondary" fontFamily="$font-ui" fontSize=12 fontWeight="500"  TEXT: Pont SimConnect
      - text «Bridge Value» fill="$text-tertiary" fontFamily="$font-ui" fontSize=12  TEXT: Connecté · MSFS 2024
    - frame «Season» gap=8 alignItems="center"
      - icon «Season Icon» width=14 height=14 fill="$text-tertiary" icon="calendar-clock"
      - text «Season Label» fill="$text-secondary" fontFamily="$font-ui" fontSize=12 fontWeight="500"  TEXT: Saison de novembre
      - text «Season Value» fill="$text-tertiary" fontFamily="$font-ui" fontSize=12  TEXT: encore 25 jours
  - frame «Hints» gap=22 alignItems="center"
    - frame «Hint · RETOUR» gap=8 alignItems="center"
      - instance «Key» of «Keycap»
        - text «Key» fill="$text-primary" fontFamily="$font-mono" fontSize=11 fontWeight="700"  TEXT: Échap
      - text «Hint Label» fill="$text-secondary" fontFamily="$font-ui" fontSize=12  TEXT: RETOUR
    - frame «Hint · FILTRES» gap=8 alignItems="center"
      - instance «Key» of «Keycap»
        - text «Key» fill="$text-primary" fontFamily="$font-mono" fontSize=11 fontWeight="700"  TEXT: Tab
      - text «Hint Label» fill="$text-secondary" fontFamily="$font-ui" fontSize=12  TEXT: FILTRES
    - frame «Hint · SÉLECTIONNER» gap=8 alignItems="center"
      - instance «Key» of «Keycap»
        - text «Key» fill="$text-primary" fontFamily="$font-mono" fontSize=11 fontWeight="700"  TEXT: Entrée
      - text «Hint Label» fill="$text-secondary" fontFamily="$font-ui" fontSize=12  TEXT: SÉLECTIONNER
    - frame «Hint · AIDE» gap=8 alignItems="center"
      - instance «Key» of «Keycap»
        - text «Key» fill="$text-primary" fontFamily="$font-mono" fontSize=11 fontWeight="700"  TEXT: F1
      - text «Hint Label» fill="$text-secondary" fontFamily="$font-ui" fontSize=12  TEXT: Aide
