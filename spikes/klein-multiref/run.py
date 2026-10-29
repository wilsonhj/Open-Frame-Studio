"""Validate an API graph against Cloud /object_info, then (optionally) submit once and save outputs.

usage: python run.py GRAPH.json [--inputs node=path ...] [--submit] [--out DIR] [--timeout S]
Never retries submit() (fresh idempotency key = double billing). Key read from env by the SDK.
"""
import argparse
import json
import os
import pathlib
import sys
import time

OI = pathlib.Path(os.environ.get("OBJECT_INFO", "object_info.json"))


def validate(graph, oi):
    errs = []
    for nid, node in graph.items():
        ct = node["class_type"]
        spec = oi.get(ct)
        if not spec:
            errs.append(f"{nid}: unknown class_type {ct}")
            continue
        req = spec["input"].get("required", {})
        opt = spec["input"].get("optional", {})
        known = set(req) | set(opt)
        for k, v in node["inputs"].items():
            base = k.split(".")[0]
            if base not in known:
                errs.append(f"{nid}.{k}: unknown input for {ct}")
                continue
            t = (req.get(base) or opt.get(base))[0]
            if isinstance(t, list) and "." not in k and not isinstance(v, list) and t and v not in t:
                errs.append(f"{nid}.{k}: value {v!r} not in combo list ({len(t)} options)")
            if isinstance(v, list) and v[0] not in graph:
                errs.append(f"{nid}.{k}: link to missing node {v[0]}")
        for k in req:
            if k not in node["inputs"] and ct != "LoadImage":
                if not any(x.startswith(k + ".") for x in node["inputs"]):
                    errs.append(f"{nid}: missing required input {k}")
    return errs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("graph")
    ap.add_argument("--inputs", nargs="*", default=[])
    ap.add_argument("--submit", action="store_true")
    ap.add_argument("--out", default="out")
    ap.add_argument("--timeout", type=float, default=900)
    a = ap.parse_args()

    graph = json.loads(pathlib.Path(a.graph).read_text())
    oi = json.loads(OI.read_text())
    errs = validate(graph, oi)
    print("local validation:", "OK" if not errs else "\n  " + "\n  ".join(errs))
    if not a.submit:
        return
    from comfy_sdk import Comfy

    client = Comfy()
    wf = client.workflows.from_json(graph)
    t0 = time.monotonic()
    for spec in a.inputs:
        nid, path = spec.split("=", 1)
        asset = client.assets.from_file(path)
        wf.set_input(nid, "image", asset)
    t_up = time.monotonic() - t0
    t1 = time.monotonic()
    try:
        job = client.submit(wf)  # exactly once, never retried
    except Exception as exc:  # 422 node_errors land here before anything runs
        print("submit refused:", type(exc).__name__, getattr(exc, "code", None))
        print(str(exc)[:4000])
        for attr in ("body", "details", "data", "response_body"):
            if getattr(exc, attr, None):
                print(attr, json.dumps(getattr(exc, attr), default=str)[:4000])
        sys.exit(2)
    print("job", job.id, "submitted; waiting")
    job.wait(timeout=a.timeout)
    wall = time.monotonic() - t1
    print("status", job.status, f"wall {wall:.1f}s (uploads {t_up:.1f}s)")
    out = pathlib.Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    meta = json.loads(job._model.model_dump_json()) if hasattr(job._model, "model_dump_json") else {}
    meta.pop("workflow", None)
    (out / f"job_{job.id}.json").write_text(json.dumps(
        {"wall_s": round(wall, 1), "upload_s": round(t_up, 1), "job": meta}, indent=2, default=str))
    if job.status != "succeeded":
        print("error:", json.dumps(job.error, default=str)[:4000])
        sys.exit(3)
    for o in job.outputs:
        dest = out / o.name
        o.to_file(str(dest))
        print("saved", o.node_id, dest)


if __name__ == "__main__":
    main()
