#!/usr/bin/env python3
"""Regenerate data/aircraft-types.json and data/airports.json from upstream open data.

Sources and licences: see /DATA-LICENSES.md.
Requires: python3 and `pip install pypdf` (dev-time only; the app reads the generated JSON).
Usage: python3 data/build.py
"""
import csv
import io
import json
import re
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
FAA_ORDER_URL = "https://www.faa.gov/documentLibrary/media/Order/FAA_Order_JO_7360.1K_Aircraft_Type_Designators.pdf"
OURAIRPORTS_URL = "https://davidmegginson.github.io/ourairports-data/airports.csv"
UA = {"User-Agent": "Mozilla/5.0 (openpilotcareer data build)"}


def fetch(url: str) -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
        return r.read()


# ---------- aircraft types (FAA Order JO 7360.1K, Appendix A) ----------

HEAD = re.compile(
    r"^([A-Z0-9]{2,4}) @?(Fixed-wing|Helicopter|Gyroplane|Powered-lift)\s+(\d)([PTJER])/(S\+|S|L|H|J)?\s*(.*)$"
)
SPECIAL = re.compile(r"^([A-Z]{4})\s{3,}\(any manufacturer\), (.+?)\s*$")
TAIL_FIELDS = re.compile(r"^(?:(?:Light|Medium|Heavy|Super|L/M)\s+)?(?:[A-I]\s+)?(?:(?:III|II|I)\s+)?(?:\d{1,2}\s+)?(.*)$")
NAME = re.compile(r"^([A-Z0-9][A-Z0-9 .&()'/-]*?)\s?,\s*(.+?)(?=\s+[A-Z][A-Z0-9 .&()'/-]*\s?,\s|\s*$)")
NOISE = re.compile(r"^(=====PAGE=====|\d\d/\d\d/\d{4} JO 7360|Appendix A|A-\d+|Type|Designator|Engine|Number-|Type/FAA|Weight|Class|ICAO|WTC CWT)")


def title(s: str) -> str:
    return " ".join(w.capitalize() if w.isalpha() else w for w in s.split())


def category(cls: str, engines: int, engine: str, weight: str) -> str:
    if cls == "Helicopter":
        return "helicopter"
    if cls != "Fixed-wing":
        return "other"
    heavy = weight in ("L", "H", "J")
    if engine == "P":
        return "piston-single" if engines == 1 else "piston-multi"
    if engine == "T":
        if heavy:
            return "turboprop-airliner"
        return "turboprop-single" if engines == 1 else "turboprop-multi"
    if engine == "J":
        if weight in ("H", "J"):
            return "jet-widebody"
        return "jet-airliner" if weight == "L" else "jet-business"
    return "other"


def parse_order(text: str) -> dict:
    start = text.index("Appendix A. Decode", text.index("Appendix D.") + 1)
    end = text.index("Appendix B. Encode", start)
    lines = [l.rstrip() for l in text[start:end].split("\n")]
    types: dict = {}
    for i, line in enumerate(lines):
        m = HEAD.match(line)
        if m:
            icao, cls, engines, engine, weight, rest = m.groups()
            rest = TAIL_FIELDS.match(rest).group(1).strip()
            j = i + 1
            while not NAME.match(rest) and j < len(lines) and j < i + 12:
                cand = lines[j].strip()
                j += 1
                if cand and not NOISE.match(cand) and not HEAD.match(cand):
                    rest = cand
            n = NAME.match(rest)
            name = f"{title(n.group(1))} {n.group(2).strip()}" if n else icao
            if icao not in types:
                types[icao] = {"icao": icao, "name": name, "category": category(cls, int(engines), engine, weight or "S")}
            continue
        s = SPECIAL.match(line)
        if s and s.group(1) not in types:
            types[s.group(1)] = {"icao": s.group(1), "name": s.group(2), "category": "other"}
    return types


def build_aircraft() -> None:
    from pypdf import PdfReader  # dev-time dependency

    pdf = fetch(FAA_ORDER_URL)
    text = "\n=====PAGE=====\n".join(p.extract_text() or "" for p in PdfReader(io.BytesIO(pdf)).pages)
    types = parse_order(text)
    curated = list(csv.DictReader(open(HERE / "aircraft-curated.csv", encoding="utf-8")))
    for row in curated:
        t = types.get(row["icao"])
        if t is None:
            sys.exit(f"curated type {row['icao']} is not in FAA Order JO 7360.1K")
        t["perf"] = {k: int(row[k]) for k in ("seats", "cargoKg", "cruiseKts", "rangeNm")}
        if row.get("category"):
            t["category"] = row["category"]
    out = sorted(types.values(), key=lambda t: t["icao"])
    (HERE / "aircraft-types.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"aircraft-types.json: {len(out)} types, {len(curated)} with curated performance")


# ---------- airports (OurAirports) ----------

AIRPORT_TYPES = {"large_airport": "large", "medium_airport": "medium", "small_airport": "small", "seaplane_base": "seaplane"}
IDENT = re.compile(r"^[A-Z0-9]{3,4}$")


def build_airports() -> None:
    rows = csv.DictReader(io.StringIO(fetch(OURAIRPORTS_URL).decode("utf-8")))
    out = []
    for r in rows:
        kind = AIRPORT_TYPES.get(r["type"])
        if kind is None or not IDENT.match(r["ident"]):
            continue
        out.append([
            r["ident"], r["name"], round(float(r["latitude_deg"]), 4), round(float(r["longitude_deg"]), 4),
            kind, r["iso_country"], r["municipality"], r["iata_code"],
        ])
    out.sort(key=lambda a: a[0])
    doc = {"columns": ["icao", "name", "lat", "lon", "size", "country", "city", "iata"], "rows": out}
    (HERE / "airports.json").write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"airports.json: {len(out)} airports")


if __name__ == "__main__":
    build_aircraft()
    build_airports()
