# How Open Frame Studio works

A walkthrough of the two tools that work today, with what happens at each step. Every generation step is a plain ComfyUI graph in [`workflows/`](../workflows/), sent to Comfy Cloud (or a self-hosted ComfyUI) through the Comfy API. Every check and composite step is ordinary TypeScript running on the server.

![The studio home page](images/home.png)

## Product Shoot (`/photoshoot`)

Upload one product photo, pick a shoot mode, choose how many frames (1–4) and optionally add a short note.

![Product Shoot after a two-frame run](images/product-shoot.png)

1. **Cutout.** The photo is uploaded once and run through BiRefNet (`workflows/cutout.api.json`) to remove the background.
2. **Frames.** For each frame, the variation engine (`lib/enhancer/`) picks a setting, lighting, angle and palette from the mode's template, so frames in one shoot differ while sharing one style. Each frame is one FLUX.2 Klein 4B multi-reference edit (`workflows/klein_edit_multiref.api.json`), with the cutout as reference image 1.
3. **Results.** Frames appear in a contact sheet as they finish. A failed frame shows the reason in plain words and a **Retry** button, labelled with its cost. Retry re-runs only that frame with a new seed, and re-runs the cutout too if that failed.

## Listing Images (`/listing`)

Upload a product photo (ideally one with a transparent or plain background). The hero image is built deterministically, not generated, so it can be checked.

![Listing hero image with its compliance checks](images/listing-hero.png)

1. **Cutout.** The same BiRefNet graph as above.
2. **Compose.** The cutout is trimmed, scaled to 85% of a 2000×2000 canvas, centred on pure #FFFFFF and written as `01_hero.png`.
3. **Checks A1–A7 and C3.** These cover a pure-white border, 85% fill, canvas size, real transparency in the cutout, a single product, enough source resolution, the product being visible on white, and centred and not cropped. Any error-level failure fails the run and hides the download; the page says which check failed and what to do.

Gallery and story panels (conditioned on the hero), Identity and Motion are specified in [`docs/spec/`](spec/) and come next.

## Real Comfy Cloud output

These are real outputs from the same pipelines on Comfy Cloud: a Listing hero image, a BiRefNet cutout, and two FLUX.2 Klein 4B Product Shoot frames ("on a marble counter").

![Real outputs from Comfy Cloud](images/comfy-cloud-outputs.png)

## How a run is executed

A run is a list of steps, planned once by the tool (`lib/photoshoot/pipeline.ts`, `lib/cards/pipeline.ts`) and executed by one runtime (`lib/pipeline/runner.ts`):

- **Durable.** The run, including each Comfy submission's idempotency key, is saved to disk before anything is sent, so a restart resumes the run instead of paying for the same job twice.
- **Wired by name.** Steps refer to each other's outputs by logical names, never by Comfy node ids. A file produced by a code step is uploaded to Comfy the first time a later step needs it.
- **Bounded.** Every step has a deadline. Cancel stops new steps and asks Comfy to stop live jobs. Retry and other actions are checked against the run's current state.
- **Gated.** Starting a run or retrying an item requires the studio access code when one is set, and counts against a rate limit. Uploads must be PNG, JPEG or WebP under 20 MB.

[ARCHITECTURE.md](ARCHITECTURE.md) has the full picture, and [spec/api.md](spec/api.md) the run protocol.

## Try it without credits

`pnpm install && pnpm demo` starts a mock Comfy server plus the app on http://127.0.0.1:3000. It never calls Comfy Cloud. For Listing, use `fixtures/products/product-bottle-transparent.png`: the mock has no background-removal model, so busy-background photos correctly fail the transparency check.
