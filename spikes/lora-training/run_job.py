"""Submit one API-format graph to Comfy Cloud, poll to terminal, download outputs.

Usage:
  python run_job.py GRAPH.json --out DIR [--upload NODE=PATH ...] [--timeout 1800] [--label name]

- Reads COMFY_API_KEY from the environment (never printed).
- submit() is called exactly once (no retry loop: a fresh idempotency key = a new billed job).
- Polls with job.refresh() and logs status transitions with wall-clock offsets.
- Writes DIR/<label>_timing.json and downloads every output into DIR.
"""
import argparse
import json
import time
from pathlib import Path

from comfy_sdk import Comfy


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("graph")
    ap.add_argument("--out", required=True)
    ap.add_argument("--upload", action="append", default=[], help="NODE=PATH for LoadImage.image")
    ap.add_argument("--timeout", type=float, default=1800)
    ap.add_argument("--label", default="job")
    ap.add_argument("--no-download", action="append", default=[], help="node ids whose outputs are listed but not downloaded")
    a = ap.parse_args()

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    client = Comfy()
    wf = client.workflows.from_file(a.graph)

    t0 = time.monotonic()
    for spec in a.upload:
        node, path = spec.split("=", 1)
        asset = client.assets.from_file(path)
        wf.set_input(node, "image", asset)
    t_upload = time.monotonic() - t0

    t_submit0 = time.monotonic()
    job = client.submit(wf)  # exactly once
    print(f"submitted job {job.id} status={job.status} (uploads took {t_upload:.1f}s)", flush=True)
    timeline = [(0.0, job.status)]
    last = job.status
    deadline = t_submit0 + a.timeout
    while True:
        time.sleep(5)
        try:
            job.refresh()
        except Exception as e:  # transient read error: keep polling the same job
            print("refresh error:", type(e).__name__, e, flush=True)
            continue
        if job.status != last:
            dt = time.monotonic() - t_submit0
            timeline.append((round(dt, 1), job.status))
            print(f"+{dt:7.1f}s  {job.status}", flush=True)
            last = job.status
        if job.status in ("succeeded", "failed", "canceled", "expired"):
            break
        if time.monotonic() > deadline:
            print("local timeout; job still", job.status, "- id", job.id)
            break
    wall = time.monotonic() - t_submit0

    outputs = []
    for o in job.outputs:
        rec = {"node_id": o.node_id, "name": o.name, "type": o.type, "size_bytes": o.size_bytes, "content_type": o.content_type}
        if o.node_id not in a.no_download:
            p = o.to_file(out / f"{a.label}_{o.node_id}_{o.name}")
            rec["saved"] = str(p)
        outputs.append(rec)
        print("output:", rec, flush=True)

    rec = {
        "label": a.label,
        "job_id": job.id,
        "status": job.status,
        "error": job.error if not hasattr(job.error, "model_dump") else job.error.model_dump(),
        "upload_s": round(t_upload, 1),
        "submit_to_terminal_s": round(wall, 1),
        "timeline": timeline,
        "outputs": outputs,
    }
    (out / f"{a.label}_timing.json").write_text(json.dumps(rec, indent=1, default=str))
    print(json.dumps({k: rec[k] for k in ("job_id", "status", "submit_to_terminal_s")}, default=str))
    if job.error:
        print("ERROR:", json.dumps(rec["error"], default=str)[:4000])


if __name__ == "__main__":
    main()
