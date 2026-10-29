"""Run an API-format graph on a self-hosted ComfyUI (default http://127.0.0.1:8199) and copy outputs.

Same JSON the Cloud path submits; only the transport differs. usage:
  python run_local.py GRAPH.json --set 17.image=product_busy.png --out DIR [--server URL] [--validate-only]
"""
import argparse, json, pathlib, shutil, time, urllib.request, urllib.error, uuid


def post(url, body):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


ap = argparse.ArgumentParser()
ap.add_argument("graph"); ap.add_argument("--set", nargs="*", default=[])
ap.add_argument("--out", default="out"); ap.add_argument("--server", default="http://127.0.0.1:8199")
ap.add_argument("--output-dir", help="server --output-directory, to copy files from")
ap.add_argument("--timeout", type=float, default=1800)
a = ap.parse_args()

g = json.loads(pathlib.Path(a.graph).read_text())
for s in a.set:
    k, v = s.split("=", 1); nid, field = k.split(".", 1)
    try: v = json.loads(v)
    except json.JSONDecodeError: pass
    g[nid]["inputs"][field] = v
t0 = time.monotonic()
code, resp = post(a.server + "/prompt", {"prompt": g, "client_id": str(uuid.uuid4())})
if code != 200:
    print("refused", code, json.dumps(resp, indent=1)[:3000]); raise SystemExit(2)
pid = resp["prompt_id"]; print("queued", pid)
while time.monotonic() - t0 < a.timeout:
    with urllib.request.urlopen(f"{a.server}/history/{pid}") as r:
        h = json.loads(r.read()).get(pid)
    if h and h.get("status", {}).get("completed") is not None and (h["status"]["completed"] or h["status"].get("status_str") == "error"):
        break
    time.sleep(1)
wall = time.monotonic() - t0
st = h["status"]; print("status", st.get("status_str"), f"wall {wall:.1f}s")
out = pathlib.Path(a.out); out.mkdir(parents=True, exist_ok=True)
(out / f"history_{pid}.json").write_text(json.dumps({"wall_s": round(wall, 1), "history": h}, indent=1))
for nid, o in h.get("outputs", {}).items():
    for im in o.get("images", []):
        src = pathlib.Path(a.output_dir) / im.get("subfolder", "") / im["filename"]
        shutil.copy(src, out / im["filename"]); print("saved", nid, out / im["filename"])
if st.get("status_str") != "success":
    print(json.dumps(st.get("messages"), indent=1)[:3000]); raise SystemExit(3)
