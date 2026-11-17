#!/usr/bin/env python3
"""Reference matcher for Wallpaper Sorter: the executable version of the agreed rules.
The Rust matcher must give the same answers as this on cases.csv.

Usage: python3 ref_matcher.py [tags.toml] [filename ...]
"""
import re, sys, tomllib, os

STOP = {"and", "more", "by", "drawn", "full", "com", "konachan", "yande", "re", "wallhaven", "original"}

def load(path):
    with open(path, "rb") as f:
        cfg = tomllib.load(f)
    return cfg.get("settings", {}), cfg.get("tag", [])

def wsplit(s):
    """Words: drop long hex runs, split camelCase, lowercase, letter runs and digit runs."""
    s = re.sub(r"[0-9a-f]{16,}", " ", s, flags=re.I)
    s = re.sub(r"([a-z])([A-Z])", r"\1 \2", s)
    return re.findall(r"[a-z]+|\d+", s.lower())

def split_name(filename):
    base = filename.rsplit("/", 1)[-1]
    m = re.search(r"\.([A-Za-z0-9]{2,4})$", base)
    ext = m.group(1).lower() if m else ""
    stem = base[: m.start()] if m else base
    return stem, ext

def tokens(stem):
    stem = re.sub(r"^wallhaven-[a-z0-9]{6}", "", stem, flags=re.I)
    stem = re.sub(r"_?drawn_by_.*$", "", stem, flags=re.I)
    return [w for w in wsplit(stem) if not re.fullmatch(r"\d{5,}", w) and w not in STOP]

def hit(tk, kw, mode="word"):
    k = wsplit(kw)
    if not k:
        return False
    if mode == "substring":
        return any(k[0] in t for t in tk) if len(k) == 1 else " ".join(k) in " ".join(tk)
    return any(tk[i:i + len(k)] == k for i in range(len(tk) - len(k) + 1))

def classify(filename, tags, settings):
    stem, ext = split_name(filename)
    if ext not in settings.get("image_extensions", ["jpg", "jpeg", "png", "webp", "avif", "gif", "bmp"]):
        return {"dest": "IGNORE", "rule": "Not an image", "tags": [], "ignored": ""}
    tk = tokens(stem)
    specific, generic = [], []
    for t in tags:
        kws = [kw for kw in t["keywords"] if hit(tk, kw, t.get("match", "word"))]
        if not kws:
            continue
        sw = t.get("strict_words", [])
        if sw and not any(hit(tk, w) for w in sw):
            continue
        (generic if t.get("generic") else specific).append((t, kws[0]))
    max_words = settings.get("generic_max_words", 4)
    ignored = ""
    if specific:
        base = specific
        if generic:
            ignored = "generic ignored: " + ";".join(kw for _, kw in generic)
    elif generic and len(tk) <= max_words:
        base = generic
    elif generic:
        return {"dest": "INBOX", "rule": "No match", "tags": [],
                "ignored": "generic ignored (%d words, limit %d): %s" % (len(tk), max_words, ";".join(kw for _, kw in generic))}
    else:
        return {"dest": "INBOX", "rule": "No match", "tags": [], "ignored": ""}
    names = [kw for _, kw in base]
    dests = sorted({t["dest"] for t, _ in base})
    depth = lambda d: len(d.split("/"))
    mx = max(depth(d) for d in dests)
    top = [d for d in dests if depth(d) == mx]
    if len(top) == 1:
        if len(dests) > 1:
            rule = "Deepest folder wins"
        elif ignored:
            rule = "Specific beats generic"
        else:
            rule = "One folder"
        return {"dest": top[0], "rule": rule, "tags": names, "ignored": ignored}
    parts = [d.split("/") for d in top]
    common = []
    for col in zip(*parts):
        if len(set(col)) == 1:
            common.append(col[0])
        else:
            break
    if common:
        return {"dest": "/".join(common), "rule": "Shared parent", "tags": names, "ignored": ignored}
    return {"dest": "INBOX", "rule": "Conflict", "tags": names, "ignored": ignored}

def prefix_of(dest, tags):
    for t in tags:
        if t["dest"] == dest and t.get("prefix"):
            return t["prefix"]
    return dest.split("/")[-1].replace("-", " ")

if __name__ == "__main__":
    args = sys.argv[1:]
    tomlpath = args.pop(0) if args and args[0].endswith(".toml") else os.path.join(os.path.dirname(__file__), "tags.starter.toml")
    settings, tags = load(tomlpath)
    for fn in args:
        r = classify(fn, tags, settings)
        print(f"{fn}\n   {r['rule']}: {r['dest']}   tags={';'.join(r['tags'])}")
