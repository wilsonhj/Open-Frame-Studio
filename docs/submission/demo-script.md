# Live demo script (5 minutes)

**Be upfront from the first minute:** this demo runs against a **local mock of the Comfy Cloud API**, not Comfy Cloud. Our Comfy account is on the free tier, which cannot run API jobs. The app, the pipelines, the run store, polling, downloads and the card renderer are all real. Only the image model is replaced: the mock returns a composited placeholder (your uploaded product on a studio backdrop with a soft shadow) where FLUX.2 Klein would return a generated shot.

## Before you go on (2 minutes, off stage)

```bash
pnpm install
pnpm demo          # mock Comfy on 127.0.0.1:8199 + the studio on http://127.0.0.1:3000
```

- Wait for `[demo] mock Comfy API v2 on http://127.0.0.1:8199` and Next's `Ready`.
- Open http://127.0.0.1:3000 and click through `/photoshoot` and `/cards` once so the dev compiler has built them. The first compile of each route takes a few seconds and would otherwise land on stage.
- Have a product photo on the desktop: a bottle, a shoe or a mug on a plain background works best. `fixtures/` has some.
- `pnpm demo` never reads or prints `COMFY_API_KEY`. It replaces the key with a dummy value, and nothing leaves the machine.

## 0:00 – 0:40 · Landing

- Open http://127.0.0.1:3000.
- Read the pitch line: *"Open-weights product studio on ComfyUI — a clean-room rebuild of Higgsfield's Photoshoot and Marketplace Cards."*
- Point at the rail. Photoshoot and Cards are live today. Soul and Motion are marked *soon*: their contracts exist, the UI does not.
- Point at the status dot at the bottom of the rail: **"Demo · local mock"**. Say it out loud.
- Design note, ten seconds at most: a "darkroom contact sheet". Warm paper and one safelight-orange accent, used only on the primary action and on anything live.

## 0:40 – 2:10 · Photoshoot, product only

- Click **Photoshoot**. Upload the product photo.
- Pick the **product shot** mode and a count of 4. Leave the Soul empty: this run is product only.
- Click the primary (orange) button. One click is one run. The client never resubmits on its own.
- While it runs, narrate the states each frame passes through: *queued → running → succeeded*. Every wait shows a state. The browser polls `GET /api/pipelines/photoshoot/{runId}`, starting at 1 s and backing off to 5 s.
- **Reload the page mid-run.** The run resumes, because the run id lives in sessionStorage and the run itself is a durable JSON document on the server.
- What a frame contains: the product, cut out and placed on a varied backdrop. On Cloud, lighting, angle and palette change per frame. Here the mock varies the backdrop palette per frame.

## 2:10 – 2:40 · Results and download

- Open a frame. Show its caption: frame number and variation.
- Download one image, then the whole set. These are real PNG files served through our own `/api/jobs/.../outputs/...` proxy. The browser never sees a Comfy URL or a key.

## 2:40 – 3:40 · Marketplace Cards, main image

- Click **Cards**. Reuse the same product.
- Generate the **main image**: a pure-white background that is compliance-checked (white border, product fill ratio).
- Show the compliance result. If time allows, show one secondary tile rendered on top of the main image.
- Point out that card text and layout are rendered locally by our code with OFL fonts, not by the image model, so the copy is always legible.

## 3:40 – 4:20 · Open weights

- Go back to the landing and scroll to **Open weights**. Every row comes from `models/manifest.json`, the same file CI checks against the workflow graphs.
  - FLUX.2 Klein 4B with its Qwen3-4B encoder and VAE: **Apache-2.0**.
  - BiRefNet cutout: **MIT**. SeedVR2 upscale: **Apache-2.0**.
  - MiniMax H3 for Motion: **conditional** (H3 Community License). Read the note: Comfy Cloud generations include commercial rights, while self-hosting and local commercial use follow the H3 licence. That is why it is flagged in amber and not green.

## 4:20 – 5:00 · What changes with a paid Comfy Cloud key

- Nothing in the app changes. You stop `pnpm demo`, set `COMFY_API_KEY` to a paid Comfy Cloud key, unset `COMFY_BASE_URL` and run `pnpm dev`.
- The same pipelines then submit the real API-format graphs in `workflows/*.api.json`: Klein edit/t2i, BiRefNet cutout, SeedVR2 upscale and H3 reference-to-video.
- The mock speaks the same `/api/v2` surface the `@comfyorg/sdk` uses (asset upload, job submit, job poll, output download). That is why the demo exercises the real client code end to end.
- Close: *"A Higgsfield-style studio where you can read every weight's licence, and where the Soul and the outputs are files you keep."*

## If something goes wrong on stage

- **A route is slow the first time.** That is the dev compiler. Keep talking; it happens once per route.
- **A run fails.** Click Retry. That creates exactly one new job.
- **Port 3000 or 8199 is busy.** Run `PORT=3001 DEMO_PORT=8299 pnpm demo`.
- **Mock only** (for example, if you are driving the app from another terminal): `pnpm mock`, then `COMFY_BASE_URL=http://127.0.0.1:8199 COMFY_API_KEY=demo pnpm dev`.
