# workflows/

API-format ComfyUI graphs (`{node_id: {class_type, inputs}}`), one per file, named `<name>.api.json`.
Subgraphs must be unpacked before export: UI exports (`nodes`/`links`) are rejected by `lib/comfy.ts`.

Each workflow the app can run needs an entry in `lib/bindings/index.ts` (one file per workflow in `lib/bindings/`) mapping logical inputs to `{node, field}` and logical outputs to the `Save*` node that produces them. The name must also be listed in `WORKFLOW_NAMES` in `lib/contracts/bindings.ts`. Validate class names and inputs against `GET /api/object_info` before committing; `checkBinding` in `lib/bindings/apply.ts` confirms that every bound node and field exists as a widget in the graph, and `tests/bindings.test.ts` runs it against every registered workflow.

Five of these graphs come from the Wave 0 spike graphs in `spikes/`, which stay as frozen records: `cutout` and `h3_r2v` are verbatim copies, `klein_edit_multiref` is the FLUX.2 fallback graph, `klein_t2i` keeps one fixture chain, and `upscale` switches the model from 7B to 3B. Edit the copies here, not the spikes.

| Workflow | Purpose | Bound inputs | Outputs |
|---|---|---|---|
| `image_resize_smoke` | Plumbing smoke test: LoadImage → ImageScaleBy → SaveImage (the `/smoke` page) | `image`, `scale` (0.05–2), `method` | `image` |
| `klein_edit_multiref` | FLUX.2 Klein 4B distilled edit with up to four reference images (identity preview, product shoot, listing tiles) | `image_1`–`image_4`, `prompt`, `width`, `height`, `batch_size`, `seed`, `steps`, `cfg`, `ref_megapixels`, `model` | `image` |
| `klein_t2i` | FLUX.2 Klein 4B distilled text-to-image (backdrops, text-only packshots, fixtures) | `prompt`, `width`, `height`, `batch_size`, `seed`, `steps`, `cfg`, `model` | `image` |
| `cutout` | BiRefNet background removal to an RGBA cutout and a mask | `image` | `cutout`, `mask` |
| `upscale` | SeedVR2 3B image upscale; alpha is re-attached | `image`, `scale`, `model`, `seed`, `color_correction` (`wavelet` by default; `lab` streaks flat colour) | `image` |
| `h3_r2v` | MiniMax H3 reference-to-video | `image_1` (person), `image_2` (product), `prompt` (uses `<Picture N>` tags), `seed`, `duration`, `turbo`, `steps_base`, `steps_turbo`, `aspect_ratio`, `megapixels`, `ref_image_size` | `video` |

Notes:

- `image_*` inputs are uploads (PNG, JPEG or WebP, at most 20 MB); the loader nodes' file widgets get SDK asset handles.
- `width` and `height` on the Klein graphs are multiples of 16 and are mirrored into the scheduler node, so they stay in step.
- Inputs flagged `randomize` (the seeds on `klein_edit_multiref`, `klein_t2i` and `h3_r2v`) get a fresh random value when a request leaves them out, because ComfyUI caches identical graphs. `/api/jobs` returns the value it used in `seeds`.
- `h3_r2v` ships with turbo on (4 steps). Set `turbo` to false for final renders (20 base steps).
- Model filenames inside the graphs are configured names, not verified weights. FLUX.3 Klein files are not on Comfy Cloud, so every graph uses FLUX.2 Klein 4B.
