# View Switcher

Resolved tree (component instances expanded with their overrides; HUD bars referenced). Rendered image: renders/<slug>.webp when the frame is a 1600x900 screen.

- frame «View Switcher» gap=2 padding=4 fill="$surface" stroke="$border" strokeWidth=1 cornerRadius=6 effect={"type": "background_blur", "radius": 20}
  - frame «View · Vue en coupe» padding=[8, 16] fill="#FFFFFF1A" cornerRadius=4
    - text «Label» fill="$text-primary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: Vue en coupe
  - frame «View · Cabine & charge» padding=[8, 16] cornerRadius=4
    - text «Label» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: Cabine & charge
  - frame «View · Systèmes» padding=[8, 16] cornerRadius=4
    - text «Label» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: Systèmes
