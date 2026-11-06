# Cabines · classes, ponts & équipements

Extracted from docs/design/openhangar.pen (Pen schema 2.21). Values like $accent are design variables (see tokens.css).

- frame «Cabines · classes, ponts & équipements» width=1600 layout="vertical" gap=36 padding=[48, 56, 56, 56] fill=["#07090C", {"type": "gradient", "gradientType": "radial", "enabled": true, "rotation": 0, "size": {"width": 1.3, "height": 1.1}, "colors... clip=true
  - frame «Board Header» width="fill_container" layout="vertical" gap=8
    - text «Board Title» fill="$text-primary" fontFamily="$font-display" fontSize=34 fontWeight="600"  TEXT: Un plan de cabine pour chaque configuration
    - text «Board Sub» width=900 fill="$text-secondary" fontFamily="$font-ui" fontSize=15  TEXT: Le plan est généré depuis la configuration de l'appareil : ponts, classes, portes, toilettes, galleys, escaliers et PNC. Les équipements usés apparaissent en ambre, hors service en rouge.
  - frame «Config · Airbus A380 · deux ponts» width="fill_container" layout="vertical" gap=10 padding=[18, 0, 0, 0] stroke="$border" strokeWidth={"top": 1}
    - frame «Config Head» gap=14 alignItems="end"
      - text «Config Name» fill="$text-primary" fontFamily="$font-ui" fontSize=17 fontWeight="600"  TEXT: Airbus A380 · deux ponts
      - text «Config Sub» fill="$text-tertiary" fontFamily="$font-ui" fontSize=14  TEXT: Première, affaires et économique · 12 toilettes
    - script «Cabin · a380» width="fill_container" height=470
  - frame «Config · Boeing 747-8 · pont supérieur partiel» width="fill_container" layout="vertical" gap=10 padding=[18, 0, 0, 0] stroke="$border" strokeWidth={"top": 1}
    - frame «Config Head» gap=14 alignItems="end"
      - text «Config Name» fill="$text-primary" fontFamily="$font-ui" fontSize=17 fontWeight="600"  TEXT: Boeing 747-8 · pont supérieur partiel
      - text «Config Sub» fill="$text-tertiary" fontFamily="$font-ui" fontSize=14  TEXT: Cockpit et cabine affaires à l'étage · 9 toilettes
    - script «Cabin · b747» width="fill_container" height=430
  - frame «Config · Boeing 777-300ER · trois classes» width="fill_container" layout="vertical" gap=10 padding=[18, 0, 0, 0] stroke="$border" strokeWidth={"top": 1}
    - frame «Config Head» gap=14 alignItems="end"
      - text «Config Name» fill="$text-primary" fontFamily="$font-ui" fontSize=17 fontWeight="600"  TEXT: Boeing 777-300ER · trois classes
      - text «Config Sub» fill="$text-tertiary" fontFamily="$font-ui" fontSize=14  TEXT: Affaires 1-2-1, premium 2-4-2, économique 3-4-3
    - script «Cabin · b777» width="fill_container" height=230
  - frame «Config · Airbus A320 · deux classes» width="fill_container" layout="vertical" gap=10 padding=[18, 0, 0, 0] stroke="$border" strokeWidth={"top": 1}
    - frame «Config Head» gap=14 alignItems="end"
      - text «Config Name» fill="$text-primary" fontFamily="$font-ui" fontSize=17 fontWeight="600"  TEXT: Airbus A320 · deux classes
      - text «Config Sub» fill="$text-tertiary" fontFamily="$font-ui" fontSize=14  TEXT: Affaires 2-2, économique 3-3 · toilettes arrière à réviser
    - script «Cabin · a320» width="fill_container" height=200
