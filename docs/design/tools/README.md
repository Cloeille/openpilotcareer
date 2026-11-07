# Design import tools

One import = one pen file plus one capture pass. The generated extracts are a pure function of the pen file.

1. Replace `docs/design/openhangar.pen` with the new file (the share gives a zstd `.pen`; decompress it) and copy `raw/scripts/*.js` into `scripts/`.
2. `python3 docs/design/tools/import_pen.py` rewrites `screens/`, `screens-resolved/`, `texts/` and the table in `INDEX.md`. Delete the three folders first so removed frames disappear. Check the tool after editing it: run it on the previous pen from git and `diff -r` against the committed folders (on the v2 pen, `screens/` reproduces byte for byte; `screens-resolved/` differs on 7 files because the tool keeps `height=fit_content(80)` on panel `Content` frames, and `texts/` is a superset because the tool also reads texts inside panel-content overrides, which the v2 files missed: the table and list texts of Achat, Compagnie IA, Détail d'un job and others).
3. Renders: capture the share in presentation mode with Playwright (1760x990 viewport, ArrowRight, 2.5 s per slide), crop (71,40,1689,950) and resize to 1600x900, then name each slide by OCR overlap with `texts/<slug>.txt` (tesseract fra+eng, idf-weighted token coverage) and check the dense screens by eye. The viewer loops: expect each slide twice. Pen `script` nodes do not draw in this capture, list those screens in INDEX.md.
4. New backdrops: `images/generated-N.png` to `assets/generated-N.webp` (Pillow, quality 80).
