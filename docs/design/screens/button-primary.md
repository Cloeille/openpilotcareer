# Button/Primary

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «Button/Primary» height=42 gap=14 padding=[0, 10, 0, 20] alignItems="center" fill="$btn-primary" cornerRadius=3 reusable=true
  - text «Label» fill="$on-btn-primary" fontFamily="$font-ui" fontSize=15 fontWeight="600"  TEXT: Accepter le job
  - frame «Key» height=22 padding=[0, 7] alignItems="center" fill="#0000000D" stroke="#00000033" strokeWidth={"top": 1, "right": 1, "bottom": 2, "left": 1} cornerRadius=3
    - text «Key Label» fill="#11121499" fontFamily="$font-ui" fontSize=11 fontWeight="600"  TEXT: Entrée
