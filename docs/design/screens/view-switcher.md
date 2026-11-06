# View Switcher

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «View Switcher» gap=2 padding=4 fill="$surface" stroke="$border" strokeWidth=1 cornerRadius=6 effect={"type": "background_blur", "radius": 20} reusable=true
  - frame «View · Vue en coupe» padding=[8, 16] fill="#FFFFFF1A" cornerRadius=4
    - text «Label» fill="$text-primary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: Vue en coupe
  - frame «View · Cabine & charge» padding=[8, 16] cornerRadius=4
    - text «Label» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: Cabine & charge
  - frame «View · Systèmes» padding=[8, 16] cornerRadius=4
    - text «Label» fill="$text-secondary" fontFamily="$font-ui" fontSize=14 fontWeight="500"  TEXT: Systèmes
