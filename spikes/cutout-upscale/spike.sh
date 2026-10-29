#!/usr/bin/env bash
# Spike 4 on Comfy Cloud (needs a paid tier: free tier returns 403 on submit). 2 real submissions.
# Each run.py call validates against /object_info first and submits exactly once (no retries).
set -euo pipefail
cd "$(dirname "$0")"
PY=${PY:-python}
: "${OBJECT_INFO:?point OBJECT_INFO at a saved /api/object_info dump}"
FIX=${1:?usage: spike.sh product_busy.png}
# 1) BiRefNet cutout: user input = node 17 field image
$PY run.py cutout.api.json --inputs 17="$FIX" --submit --out out/cloud-cutout --timeout 600
# 2) SeedVR2 7B int8 x2: user input = node 1 field image (RGBA ok, alpha is carried through)
CUT=$(ls out/cloud-cutout/oss_cutout_*.png | head -1)
$PY run.py upscale.api.json --inputs 1="$CUT" --submit --out out/cloud-upscale --timeout 900
$PY marketplace_main.py "$(ls out/cloud-upscale/oss_upscale_*.png | head -1)" out/cloud-main_2000.jpg
