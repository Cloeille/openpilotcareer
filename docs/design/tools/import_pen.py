#!/usr/bin/env python3
"""Regenerate docs/design/{screens,screens-resolved,texts}/ and the INDEX table from a Pen file.

    python3 docs/design/tools/import_pen.py [PEN] [OUT_DIR]

PEN defaults to docs/design/openhangar.pen, OUT_DIR to docs/design. The output is a pure function of the
pen file: running it on the committed pen must reproduce the committed files byte for byte (that is the
check to run after changing this script).

  screens/<slug>.md           raw per-frame tree, refs shown as `ref ... (instance of «X»)`
  screens-resolved/<slug>.md  instances expanded with their `descendants` overrides, disabled nodes dropped
  texts/<slug>.txt            text contents of the raw tree plus the `content` overrides of its refs
  INDEX.md                    the `| Frame | Extract | Size |` table is rewritten in place; the text above and below it is kept

Renders (renders/<slug>.webp) and assets/ come from the pen.dev viewer, see docs/design/tools/README.md.
"""
import copy
import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKIP = {"id", "type", "name", "x", "y", "children", "content", "textGrowth", "library", "enabled", "descendants", "ref", "scriptUri", "inputs", "slot", "layoutPosition", "innerRadius", "startAngle", "sweepAngle", "strokeAlignment"}
ORDER = {
    "frame": ["width", "height", "layout", "gap", "padding", "alignItems", "justifyContent", "fill", "stroke", "strokeWidth", "cornerRadius", "effect", "reusable", "clip"],
    "text": ["width", "fill", "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "textAlign"],
    "rectangle": ["width", "height", "fill", "stroke", "strokeWidth", "cornerRadius", "opacity"],
    "ellipse": ["width", "height", "fill", "stroke", "strokeWidth", "opacity"],
    "icon": ["width", "height", "fill", "icon"],
    "script": ["width", "height", "opacity"],
    "ref": ["opacity", "width", "height", "stroke"],
}
HEAD_RAW = "Extracted from docs/design/openhangar.pen (Pen schema {v}). Values like $accent are design variables (see tokens.css)."
HEAD_RES = "Resolved tree (component instances expanded with their overrides; HUD bars referenced). Rendered image: renders/<slug>.webp when the frame is a 1600x900 screen."
BARS = {"HUD/Top": "hud-top", "HUD/Bottom": "hud-bottom", "HUD/Onboarding": "hud-onboarding"}


def slug(name):
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def val(v, cut=0):
    s = json.dumps(v, ensure_ascii=False) if not isinstance(v, str) else json.dumps(v, ensure_ascii=False)
    if isinstance(v, bool):
        s = "true" if v else "false"
    if cut and isinstance(v, (dict, list)) and len(s) > cut:
        s = s[: cut - 3] + "..."
    return s


def props(n, cut):
    keys = [k for k in n if k not in SKIP and not (cut == "raw" and k == "lineHeight") and not (cut == "resolved" and k in ("clip", "reusable"))]
    order = ORDER.get(n["type"], [])
    keys.sort(key=lambda k: order.index(k) if k in order else len(order))
    out = []
    for k in keys:
        if k == "fill" and cut == "resolved" and isinstance(n[k], (dict, list)):
            kind = n[k]["type"] if isinstance(n[k], dict) else "list"
            out.append("fill=image(%s)" % n[k]["url"] if kind == "image" else "fill=gradient" if kind == "gradient" else "fill=" + val(n[k], 90))
        else:
            out.append("%s=%s" % (k, val(n[k], 140)))
    return (" " + " ".join(out)) if out else ""


class Pen:
    def __init__(self, path):
        self.doc = json.loads(Path(path).read_text())
        self.byid = {}
        for c in self.doc["children"]:
            self.index(c)

    def index(self, n):
        self.byid[n["id"]] = n
        for c in n.get("children", []):
            self.index(c)

    def raw_lines(self, n, d, out):
        pad = "  " * d
        if n["type"] == "ref":
            comp = self.byid[n["ref"]]["name"]
            out.append("%s- ref «%s»%s ref=%s%s  (instance of «%s»)" % (pad, n["name"], props(n, "raw"), val(n["ref"]), (" descendants=" + val(n["descendants"], 140)) if "descendants" in n else "", comp))
            return
        text = ("  TEXT: " + n.get("content", "")) if n["type"] == "text" else ""
        out.append("%s- %s «%s»%s%s" % (pad, n["type"], n["name"], props(n, "raw"), text))
        for c in n.get("children", []):
            self.raw_lines(c, d + 1, out)

    def expand(self, ref, overrides=None):
        """Component tree for a ref with its overrides applied. Keys are node ids or 'refId/innerId' paths."""
        comp = copy.deepcopy(self.byid[ref["ref"]])
        ov = dict(overrides or {})
        ov.update(ref.get("descendants", {}))
        return self.apply(comp, ov)

    def apply(self, n, ov):
        o = ov.get(n["id"])
        if o:
            n = {**n, **{k: v for k, v in o.items() if k not in ("children",)}}
            if "children" in o:
                n["children"] = copy.deepcopy(o["children"])
        if n.get("enabled") is False:
            return None
        if n["type"] == "ref":
            inner = {k.split("/", 1)[1]: v for k, v in ov.items() if k.startswith(n["id"] + "/")}
            return {"__instance": n, "children": self.expand(n, inner)["children"]}
        n = dict(n)
        n["children"] = [c for c in (self.apply(c, ov) for c in n.get("children", [])) if c is not None]
        return n

    def resolved_lines(self, n, d, out, top=False):
        pad = "  " * d
        if "__instance" in n:
            ref = n["__instance"]
            comp = self.byid[ref["ref"]]["name"]
            if comp in BARS:
                out.append("%s- [instance «%s» — see screens-resolved/%s.md]" % (pad, comp, BARS[comp]))
                return
            out.append("%s- instance «%s» of «%s»" % (pad, ref["name"], comp))
            for c in n["children"]:
                self.resolved_lines(c, d + 1, out)
            return
        text = ("  TEXT: " + n.get("content", "")) if n["type"] == "text" else ""
        out.append("%s- %s «%s»%s%s" % (pad, n["type"], n["name"], props(n, "resolved"), text))
        for c in n.get("children", []):
            self.resolved_lines(c, d + 1, out)

    def texts(self, n, out):
        if "__instance" in n and self.byid[n["__instance"]["ref"]]["name"] in BARS:
            return
        if n.get("type") == "text":
            out.append(n.get("content", ""))
        for c in n.get("children", []):
            self.texts(c, out)


def write_index(path, table):
    lines = path.read_text().split("\n") if path.exists() else ["# Design index", "", ""]
    start = next(i for i, l in enumerate(lines) if l.startswith("| Frame |")) if any(l.startswith("| Frame |") for l in lines) else len(lines)
    end = start
    while end < len(lines) and lines[end].startswith("|"):
        end += 1
    path.write_text("\n".join(lines[:start] + table + lines[end:]).rstrip("\n") + "\n")


def main():
    pen_path = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "openhangar.pen"
    out_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT
    pen = Pen(pen_path)
    version = pen.doc["version"]
    for sub in ("screens", "screens-resolved", "texts"):
        (out_dir / sub).mkdir(parents=True, exist_ok=True)
    table = ["| Frame | Extract | Size |", "|---|---|---|"]
    for frame in pen.doc["children"]:
        s = slug(frame["name"])
        raw = []
        pen.raw_lines(frame, 0, raw)
        (out_dir / "screens" / (s + ".md")).write_text("# %s\n\n%s\n\n%s\n" % (frame["name"], HEAD_RAW.format(v=version), "\n".join(raw)))
        res = []
        top = pen.apply(copy.deepcopy(frame), {})
        pen.resolved_lines(top, 0, res, True)
        (out_dir / "screens-resolved" / (s + ".md")).write_text("# %s\n\n%s\n\n%s\n" % (frame["name"], HEAD_RES, "\n".join(res)))
        tx = []
        pen.texts(top, tx)
        (out_dir / "texts" / (s + ".txt")).write_text("\n".join(tx) + "\n")
        table.append("| %s | screens/%s.md | %d lines |" % (frame["name"], s, len(raw)))
    write_index(out_dir / "INDEX.md", table)


if __name__ == "__main__":
    main()
