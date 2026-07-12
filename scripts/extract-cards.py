#!/usr/bin/env python3
"""One-shot: read the card data out of the original Study/flashcards/gen_flashcards.py
and emit it as JSON (to stdout). A write-guard neutralises the generator's file writes,
so importing it here NEVER modifies the old Study/ project. Node then turns this JSON
into the cards/*.yaml files."""
import builtins, io, json, os, sys

SRC = os.path.join(os.path.dirname(__file__), "..", "..", "Study", "flashcards", "gen_flashcards.py")
CATCOL = {"A": "#6366f1", "B": "#0ea5e9", "C": "#14b8a6", "D": "#f59e0b", "E": "#ec4899",
          "F": "#8b5cf6", "G": "#22c55e", "H": "#ef4444", "I": "#f97316", "J": "#06b6d4"}

_real_open = builtins.open
def _guard_open(path, mode="r", *a, **k):
    if "w" in mode or "a" in mode:            # swallow any file writes the generator performs
        return io.StringIO()
    return _real_open(path, mode, *a, **k)

ns = {"__name__": "genmod", "__file__": os.path.abspath(SRC), "open": _guard_open}
with _real_open(os.path.abspath(SRC), "r", encoding="utf-8") as f:
    code = f.read()
_stdout = sys.stdout
sys.stdout = io.StringIO()                    # swallow the generator's print() summary
try:
    exec(compile(code, SRC, "exec"), ns)
finally:
    sys.stdout = _stdout

CARDS, CATS = ns["CARDS"], ns["CATS"]
CLOZE, HINTS, DIAGRAMS = ns["CLOZE"], ns["HINTS"], ns["DIAGRAMS"]
# The already-built game payload (post-transform) — the ground truth the TS port must reproduce.
GAME_CARDS, MULTI_POOL = ns["game_cards"], ns["_multi_pool"]

sections = []
for key, name in CATS.items():
    cards_out = []
    for c in CARDS:
        if c["cat"] != key:
            continue
        cid = c["id"]
        card = {"topic": c["topic"]}
        if c.get("desc"):
            card["desc"] = c["desc"]
        if c.get("extras"):
            card["extras"] = [{"label": lbl, "text": txt} for lbl, txt in c["extras"]]
        for fld in ("items", "table", "diagram", "match", "mc", "manifest"):
            if c.get(fld) is not None:
                card[fld] = c[fld]
        for flag in ("fold", "recall", "inverse"):
            if c.get(flag):
                card[flag] = True
        if cid in CLOZE:
            t = CLOZE[cid]
            card["cloze"] = {"text": t[0], "answer": t[1]}
            if len(t) > 2 and t[2]:
                card["cloze"]["alts"] = list(t[2])
        h = c.get("hint") or HINTS.get(cid)    # explicit hint: inline overrides HINTS; auto-hints derived in TS
        if h:
            card["hint"] = h
        cards_out.append(card)
    sections.append({"key": key, "name": name, "color": CATCOL.get(key, "#888"), "cards": cards_out})

reference = {"cats": CATS, "catColors": CATCOL, "cards": GAME_CARDS,
             "diagrams": DIAGRAMS, "multiPool": MULTI_POOL}
print(json.dumps({"sections": sections, "diagrams": DIAGRAMS, "reference": reference},
                 ensure_ascii=False))
