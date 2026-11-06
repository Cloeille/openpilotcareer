# Input

Resolved tree (component instances expanded with their overrides; HUD bars referenced). Rendered image: renders/<slug>.webp when the frame is a 1600x900 screen.

- frame «Input» width=340 layout="vertical" gap=7
  - text «Label» fill="$text-secondary" fontFamily="$font-ui" fontSize=13 fontWeight="500"  TEXT: Nom d'utilisateur
  - frame «Field» width="fill_container" height=44 gap=10 padding=[0, 12] alignItems="center" fill="$surface-sunken" stroke="$border-strong" strokeWidth=1 cornerRadius=3
    - icon «Icon» width=16 height=16 fill="$text-tertiary" icon="user"
    - text «Value» width="fill_container" fill="$text-tertiary" fontFamily="$font-ui" fontSize=15 fontWeight="normal"  TEXT: ex. lmoreau
