# workflows/

API-format ComfyUI graphs (`{node_id: {class_type, inputs}}`), one per file, named `<name>.api.json`.
Subgraphs must be unpacked before export: UI exports (`nodes`/`links`) are rejected by `lib/comfy.ts`.

Each workflow the app can run needs an entry in `lib/bindings/index.ts` mapping user inputs to
`{node, field}`. Validate class names and inputs against `GET /api/object_info` before committing.

| Workflow | Purpose | Bound inputs |
|---|---|---|
| `image_resize_smoke` | Plumbing smoke test (LoadImage → ImageScaleBy → SaveImage) | `image` → 1.image, `scale` → 2.scale_by, `method` → 2.upscale_method |
