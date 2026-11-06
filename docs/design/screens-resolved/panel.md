# Panel

Resolved tree (component instances expanded with their overrides; HUD bars referenced). Rendered image: renders/<slug>.webp when the frame is a 1600x900 screen.

- frame «Panel» width=440 layout="vertical" fill="$surface" stroke="$border" strokeWidth=1 cornerRadius=6 effect={"type": "background_blur", "radius": 24}
  - frame «Header» width="fill_container" gap=10 padding=[18, 22, 4, 22] alignItems="center"
    - text «Title» width="fill_container" fill="$text-primary" fontFamily="$font-display" fontSize=18 fontWeight="600"  TEXT: Vol en cours
    - text «Action» fill="$text-secondary" fontFamily="$font-ui" fontSize=13 fontWeight="500"  TEXT: Tout voir
  - frame «Content» width="fill_container" height="fit_content(80)" layout="vertical" gap=14 padding=[14, 22, 22, 22]
