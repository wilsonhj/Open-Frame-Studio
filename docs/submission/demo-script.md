# Live demo script (5 minutes)

**Be upfront from the first minute.** By default this demo runs against a **local mock of the Comfy Cloud API**. The app, the pipelines, the run store, polling, downloads and the compliance checks are all real. Only the models are replaced: the mock returns your uploaded product on a studio backdrop where FLUX.2 Klein would return a generated shot, and passes the upload through where BiRefNet would cut it out. The same flows have also run on real Comfy Cloud (see "Running on Comfy Cloud" below).

## Before you go on (2 minutes, off stage)

```bash
pnpm install
pnpm demo          # mock Comfy on 127.0.0.1:8199 + the studio on http://127.0.0.1:3000
```

- Wait for `[demo] mock Comfy API v2 on http://127.0.0.1:8199` and Next's `Ready`.
- Open http://127.0.0.1:3000 and click through `/photoshoot` and `/listing` once, so the dev compiler has built them. The first compile of each route takes a few seconds and would otherwise land on stage.
- Have two product photos ready:
  - any product photo for **Product Shoot** (for example `fixtures/products/product-mug-tiles.png`);
  - `fixtures/products/product-bottle-transparent.png` for **Listing Images**. The mock cannot remove a background, so a photo with a busy background correctly fails check A4 there.
- `pnpm demo` never reads or prints `COMFY_API_KEY`, and nothing leaves the machine.

## 0:00 – 0:40 · Landing

- Open http://127.0.0.1:3000. The heading reads *"Open-weights product studio on ComfyUI"*.
- Point at the rail: **Product Shoot** and **Listing Images** are live. **Identity** and **Motion** are marked *soon*: their contracts exist, the UI does not yet.
- Point at the status dot at the bottom of the rail: **"Demo · local mock"**. Say it out loud.

## 0:40 – 2:10 · Product Shoot, product only

- Click **Product Shoot** and upload the product photo.
- Pick the **Product shot** mode and a count of 4 (the most a mode allows). The shoot is product only.
- Click the primary (orange) **Shoot** button. One click is one run; the client never resubmits on its own.
- While it runs, narrate the states: the cutout runs first, then each frame goes *waiting → developing → done*. The browser polls `GET /api/pipelines/photoshoot/{runId}`, starting at 1 s and backing off to 5 s.
- **Reload the page mid-run.** The run resumes: the run id lives in sessionStorage, and the run itself is a durable JSON document on the server.
- Each frame's caption shows its variation (setting, lighting, angle, palette). If a frame fails, its **Retry (new seed)** link re-runs just that frame, as exactly one new job.

## 2:10 – 2:40 · Download

- Click **Download** under a frame. It is a real PNG served by our own route, `/api/pipelines/photoshoot/{runId}/files/{stepId}/{name}`. The browser never sees a Comfy URL or a key.

## 2:40 – 3:40 · Listing Images, the hero image

- Click **Listing Images** and upload `product-bottle-transparent.png`.
- Click **Generate main image**. The product is cut out, placed at 85% fill on a pure #FFFFFF 2000×2000 canvas, and checked against A1–A7 and C3 (white border, fill, canvas size, real transparency, one product, source size, visible on white, centred and not cropped).
- Show the checks and the **compliant** pill, then **Download**. The download link only appears for a compliant image.
- Optional: upload a busy-background photo instead. The run fails with a plain-words reason ("The background was not removed…") and an **Upload a different photo** button: the gate in action.
- The gallery and story panels are shown as *coming next*. Say so; don't click them.

## 3:40 – 4:20 · Open weights

- Go back to the landing and scroll to **Open weights**. Every row comes from `models/manifest.json`, the same file CI checks against the workflow graphs.
  - FLUX.2 Klein 4B with its Qwen3-4B encoder and VAE: **Apache-2.0**.
  - BiRefNet cutout: **MIT**. SeedVR2 upscale: **Apache-2.0**.
  - MiniMax H3 for Motion: **conditional** (H3 Community License). Comfy Cloud generations include commercial rights, while self-hosting and local commercial use follow the H3 licence. That is why it is flagged in amber, not green.

## 4:20 – 5:00 · Running on Comfy Cloud

- Nothing in the app changes. Stop `pnpm demo`, set `COMFY_API_KEY` to a Comfy Cloud key with credits, leave `COMFY_BASE_URL` unset and run `pnpm dev`. Behind an HTTPS proxy, also set `NODE_USE_ENV_PROXY=1` (Node's `fetch` ignores `HTTPS_PROXY` otherwise).
- The same pipelines then submit the real API-format graphs in `workflows/*.api.json`: BiRefNet cutout and FLUX.2 Klein edit for these two tools.
- The mock speaks the same `/api/v2` surface the `@comfyorg/sdk` uses (asset upload, job submit, job poll, output download), which is why the demo exercises the real client code end to end.

## If something goes wrong on stage

- **A route is slow the first time.** That is the dev compiler. Keep talking; it happens once per route.
- **A frame fails.** Click Retry under it. That creates exactly one new job.
- **Port 3000 or 8199 is busy.** Run `PORT=3001 DEMO_PORT=8299 pnpm demo`.
- **Mock only** (for example, when driving the app from another terminal): `pnpm mock`, then `COMFY_BASE_URL=http://127.0.0.1:8199 COMFY_API_KEY=demo pnpm dev`.
