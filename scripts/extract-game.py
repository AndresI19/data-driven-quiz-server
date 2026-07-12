#!/usr/bin/env python3
"""Extract GAME_JS / GAME_CSS / the game HTML shell verbatim (the exact text the browser
runs) from the untouched Study/flashcards/gen_flashcards.py. A write-guard neutralises the
generator's own file writes so Study/ is never modified. Writes three files to the dir given
as argv[1]."""
import builtins, io, os, re, sys

SRC = os.path.join(os.path.dirname(__file__), "..", "..", "Study", "flashcards", "gen_flashcards.py")
DEST = sys.argv[1]

_real_open = builtins.open
def _guard_open(path, mode="r", *a, **k):
    if "w" in mode or "a" in mode:
        return io.StringIO()
    return _real_open(path, mode, *a, **k)

ns = {"__name__": "genmod", "__file__": os.path.abspath(SRC), "open": _guard_open}
with _real_open(os.path.abspath(SRC), "r", encoding="utf-8") as f:
    code = f.read()
_stdout = sys.stdout
sys.stdout = io.StringIO()
try:
    exec(compile(code, SRC, "exec"), ns)
finally:
    sys.stdout = _stdout

def dump(name, text):
    p = os.path.join(DEST, name)
    with _real_open(p, "w", encoding="utf-8") as f:
        f.write(text)
    print(f"wrote {name}  ({len(text.splitlines())} lines)")

dump("GAME_JS.js", ns["GAME_JS"])
dump("GAME_CSS.css", ns["GAME_CSS"])
# The HTML shell: the generator builds game_doc; capture just the <body> structure (minus the
# inlined <style>/<script> we already have separately) for reference when writing index.html.
gdoc = ns.get("game_doc", "")
# strip the big <style>…</style> and <script>…</script> blobs to leave the DOM skeleton
shell = re.sub(r"<style>.*?</style>", "<style>/* GAME_CSS */</style>", gdoc, flags=re.S)
shell = re.sub(r"<script>.*?</script>", "<script>/* GAME_JS */</script>", shell, flags=re.S)
dump("GAME_SHELL.html", shell)
