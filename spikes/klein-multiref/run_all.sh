#!/usr/bin/env bash
# Spike runbook (4 real submissions). Needs a PAID Comfy Cloud account: free tier keys get
# 403 "API key authentication is not available for free tier accounts" on POST /api/v2/jobs.
# Requires: comfy-sdk==0.5.0, COMFY_API_KEY in env, OBJECT_INFO=<saved /api/object_info json>.
set -euo pipefail
cd "$(dirname "$0")"
PY=${PY:-python}; O=artifacts
$PY build_graphs.py
# 1) fixtures: synthetic portrait + mug (FLUX.2 Klein 4B distilled, 4 steps)
$PY run.py flux2_klein_t2i_fixtures.api.json --submit --out $O/r1
P=$(ls $O/r1/fixture_portrait*.png | head -1); M=$(ls $O/r1/fixture_mug*.png | head -1)
# 2) two more views of the same person via the edit graph (1 reference)
$PY run.py flux2_klein_views.api.json --inputs 54=$P --submit --out $O/r2
VA=$(ls $O/r2/view_a*.png | head -1); VB=$(ls $O/r2/view_b*.png | head -1)
# 3) multi-ref scenes (3 face refs + product), 4B distilled; 4) same with 9B distilled
for v in 4b_distilled 9b_distilled; do
  $PY run.py flux2_klein_scenes_$v.api.json --inputs 54=$P 60=$VA 61=$VB 62=$M --submit --out $O/r_$v
done
# Optional 5th: 4b_base (20 steps, cfg 5) for base-vs-distilled timing.
# When FLUX.3 Klein weights appear in /api/experiment/models, run klein_edit_multiref.api.json the same way.
