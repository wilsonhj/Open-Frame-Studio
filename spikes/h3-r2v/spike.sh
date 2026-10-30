#!/usr/bin/env bash
# Re-run the H3 R2V spike once the Cloud account can submit jobs (paid tier).
# Exactly 2-3 submissions: fixtures (1), turbo clip (1), optional base-20 comparison (1, pass --base).
# Never loops/retries a submit. COMFY_API_KEY is read from env by the SDK and is never printed.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${SPIKE_OUT:-$HERE/../../spike-out/h3-r2v}"  # spike-out/ is gitignored
export OBJECT_INFO="${OBJECT_INFO:-$OUT/object_info.json}"
mkdir -p "$OUT"
[ -s "$OBJECT_INFO" ] || curl -sS -H "Authorization: Bearer $COMFY_API_KEY" https://cloud.comfy.org/api/object_info -o "$OBJECT_INFO"
cd "$HERE"
python3 build_graphs.py

# 1) synthetic references (FLUX.2 Klein 4B distilled, 4 steps, 512px)
python3 run.py fixtures_t2i.api.json --submit --timeout 600 --out "$OUT/fixtures"
P=$(ls "$OUT"/fixtures/h3_ref_person*.png | head -1)
M=$(ls "$OUT"/fixtures/h3_ref_product*.png | head -1)

probe() {  # frames, fps, size, audio streams. Reports only: never aborts the run after a billed job.
  local f sz found=0
  for f in "$1"/*.mp4; do
    [ -e "$f" ] || continue  # no match: the glob stays literal
    found=1
    ffprobe -v error -show_entries stream=codec_type,codec_name,width,height,r_frame_rate,nb_frames,channels \
      -show_entries format=duration,size -of compact "$f" || echo "ffprobe failed for $f" >&2
    sz=$(wc -c < "$f" 2>/dev/null | tr -d " ") || sz=0  # portable (GNU and BSD/macOS); unreadable: 0
    [ -n "$sz" ] || sz=0
    if [ "$sz" -lt 5000000 ]; then
      cp "$f" "$HERE/" && echo "copied $(basename "$f") to $HERE"
    else
      echo "kept $(basename "$f") in $1 only ($sz bytes, not copied into the repo)"
    fi
  done
  [ "$found" = 1 ] || echo "no .mp4 output in $1" >&2
  return 0
}

# 2) turbo clip (4 steps, 480x864, 124 frames)
python3 run.py h3_r2v.api.json --inputs 137="$P" 139="$M" --submit --timeout 1800 --out "$OUT/turbo"
probe "$OUT/turbo"

# 3) optional base 20-step comparison
if [ "${1:-}" = "--base" ]; then
  python3 run.py h3_r2v_base20.api.json --inputs 137="$P" 139="$M" --submit --timeout 3600 --out "$OUT/base20"
  probe "$OUT/base20"
fi
