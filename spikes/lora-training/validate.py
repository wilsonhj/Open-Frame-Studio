"""Offline check of an API-format graph against a saved Cloud /api/object_info dump.

Usage: python validate.py object_info.json graph.json [graph2.json ...]
Checks: class_type exists, required inputs present, no unknown inputs,
combo values in the allowed list, link targets exist and slot in range.
"""
import json
import sys


def check(info, graph):
    errs = []
    for nid, node in graph.items():
        ct = node["class_type"]
        if ct not in info:
            errs.append(f"{nid}: unknown class_type {ct}")
            continue
        spec = info[ct]["input"]
        req = spec.get("required", {})
        opt = spec.get("optional", {})
        allowed = {**req, **opt}
        for name in req:
            if name not in node["inputs"]:
                errs.append(f"{nid} {ct}: missing required input {name}")
        for name, val in node["inputs"].items():
            if name not in allowed:
                errs.append(f"{nid} {ct}: unknown input {name}")
                continue
            t = allowed[name]
            if isinstance(val, list) and len(val) == 2 and isinstance(val[0], str):
                src = graph.get(val[0])
                if src is None:
                    errs.append(f"{nid} {ct}.{name}: link to missing node {val[0]}")
                elif src["class_type"] in info and val[1] >= len(info[src["class_type"]]["output"]):
                    errs.append(f"{nid} {ct}.{name}: bad output slot {val[1]}")
                continue
            options = None
            if isinstance(t[0], list):
                options = t[0]
            elif t[0] == "COMBO":
                options = t[1].get("options")
            if options is not None and options and ct != "LoadImage" and val not in options:
                errs.append(f"{nid} {ct}.{name}: value {val!r} not in options")
    return errs


if __name__ == "__main__":
    info = json.load(open(sys.argv[1]))
    bad = False
    for p in sys.argv[2:]:
        e = check(info, json.load(open(p)))
        print(p, "OK" if not e else "\n  " + "\n  ".join(e))
        bad |= bool(e)
    sys.exit(1 if bad else 0)
