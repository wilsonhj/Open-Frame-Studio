# Live demo script (5 minutes)

**Be upfront from the first minute.** The live demo runs against a **local mock of the Comfy Cloud API** (`pnpm demo`). The app, the pipelines, the run store, polling, downloads, the ZIP export, the marketplace checks and the Identity photo checks are all real. Only the generative models are replaced: where FLUX.2 Klein would return a generated image, the mock returns your uploaded image on a studio backdrop; where BiRefNet would cut the product out, it passes the upload through unchanged; where MiniMax H3 would return a clip, it returns a placeholder file that does not play.

Real Comfy Cloud runs so far: Product Shoot (two frames) and the Listing hero, recorded on `main` (README). The MiniMax H3 graph behind Motion ran on Cloud through `scripts/golden-run.mjs` with two product stills (not a person-plus-product run through `/motion`); its record is in PR #13. The Listing gallery and story panels and Identity ran on Cloud in manual runs on Oct 30 that are reported in PR #13's description, not recorded in the repo. The last section of this script covers all of this.

## Before you go on (off stage, about 5 minutes)

```bash
pnpm install
pnpm demo          # mock Comfy on 127.0.0.1:8199 + the studio on http://127.0.0.1:3000
```

- Wait for `[demo] mock Comfy API v2 on http://127.0.0.1:8199` and Next's `Ready`.
- Open http://127.0.0.1:3000 and visit `/photoshoot`, `/listing`, `/identity` and `/motion` once. The dev compiler builds each route the first time you open it, which takes a few seconds and would otherwise happen on stage.
- `pnpm demo` never reads or prints `COMFY_API_KEY`, and nothing leaves the machine.
- The landing description below assumes PR #21 is merged. Before it is, the rail and the landing cards still tag Identity and Motion *soon*.
- Have these files ready:
  - **Product Shoot:** `fixtures/products/product-mug-tiles.png` (any product photo works).
  - **Listing Images:** `fixtures/products/product-bottle-transparent.png`. The mock cannot remove a background, so a photo with a busy background correctly fails check A4.
  - **Identity: bring your own face photos.** The repo has no face images on purpose (`fixtures/faces/` is not committed). Bring 5–12 photos of **yourself, a person who has agreed to this, or a fictional AI-generated person**. Never use photos of a real person without their permission. Each photo needs one sharp face, with varied angles and lighting and no sunglasses. **Use close-ups:** the photo's short side must be at least 512 px, and the face itself should be at least about 500 px tall. The sharpness check currently rejects sharp faces under about 450 px as "Face is blurry" (a known limit).
  - **Motion:** one of those face photos as the person, and `fixtures/products/product-bottle-confetti.png` as the product.
  - **No face photos?** Skip the Identity beat's live part: show the page, the consent gate and the photo rules, then point to the Identity Cloud run reported in PR #13.
  - **Real Cloud results to show at the end:** `docs/images/comfy-cloud-outputs.png` (on `main`). Optionally the real H3 clip from PR #13 (two product stills, made by the golden-run script): `git fetch origin docs/status-after-merge && git show origin/docs/status-after-merge:fixtures/golden/h3_r2v/92_video_MiniMax_H3_00001_.mp4 > h3-clip.mp4` (once PR #13 is merged, the file is at `fixtures/golden/h3_r2v/` on `main`). Open both in browser tabs.
- Rehearse once with your face photos: click **Create identity** on `/identity` and check that at least 3 photos pass. The first check also loads the face detector, so it is faster on stage.

## 0:00 – 0:30 · Landing

- Open http://127.0.0.1:3000. The heading reads *"Open-weights product studio on ComfyUI"*.
- Point at the rail on the left: **Product Shoot**, **Listing Images**, **Identity**, **Motion**. All four are live.
- Scroll to **Tools**: all four cards are marked **ready**. The Listing card mentions the gallery and story panels; the Motion card reads *"A person photo and your product in one short reference-to-video clip."*
- Point at the status dot at the bottom of the rail: **"Demo · local mock"**. Say it out loud.

## 0:30 – 1:30 · Product Shoot

- Click **Product Shoot**. Click **Upload product photo** and pick the mug.
- Under **Mode**, pick **Product shot**. Under **Count**, pick **4** (the most a mode allows). The line under Notes reads *"5 jobs · cutout + 4 × … frames"*.
- Click the orange **SHOOT 4** button. One click is one run; the client never resubmits on its own.
- Narrate the states: the cutout runs first, then each frame goes *waiting → developing → done*. The browser polls `GET /api/pipelines/photoshoot/{runId}`, starting at 1 s and backing off to 5 s.
- **Reload the page mid-run.** The run resumes: the run id is kept in sessionStorage, and the run itself is a durable JSON document on the server.
- Each frame's caption shows its variation (preset, lighting, angle, palette). Click **Download** under a frame: a real PNG from our own route, `/api/pipelines/photoshoot/{runId}/files/…`. The browser never sees a Comfy URL or a key. (A failed frame shows **Retry · 1 job**, which re-runs just that frame with a new seed.)

## 1:30 – 2:30 · Listing Images: hero, gallery panels, ZIP

- Click **Listing Images**. Pick the **Gallery · 6** chip (the hero plus five panels). Leave **Copy for the panels** empty.
- Upload `product-bottle-transparent.png` and click **Generate 6 images**.
- The hero is cut out, placed at 85% fill on a pure #FFFFFF 2000×2000 canvas and checked against A1–A7 and C3 (white border, fill, canvas size, real transparency, one product, source size, visible on white, centred and not cropped). Show the checks and the **compliant** pill.
- Point at **Callouts** and **Contents**: they say *needs input*, because their copy is empty. Panel text is drawn exactly as typed; nothing is made up. The other panels build on the hero image.
- Click **Download ZIP**: the hero and every finished panel in one file.
- Honest limit: on Cloud, the generated panels (Angles, Detail, In use) can drift from the product's colour and material, and nothing yet checks them against the hero. The hero and the panels drawn in code use the exact cutout.

## 2:30 – 3:40 · Identity

- Click **Identity**. Type a **Name**. Tick **"These are photos of me, or I have this person's permission."** The photo picker stays locked until you tick it, and unticking it drops any photos already picked.
- Pick your 5–12 face photos. Optionally type a **Look** line. Click **Create identity**.
- The photo check runs on our server with the YuNet face detector (MIT, CPU, no network), even in the mock. This part is not mocked. Each photo gets a plain-words result: **Chosen**, **Passed**, or a reason such as *"No face found"*, *"More than one person"* or *"Face is blurry"*. The best 3–6 photos become the reference crops. No training.
- Click **Render preview sheet**. A status pill shows the run's state; when it finishes, the sheet appears. On the mock, the sheet is a placeholder built from a reference crop; on Cloud it is a generated sheet (17.6 s in the manual run reported in PR #13).
- Click **Download .identity.zip**: a portable bundle (`identity.json` plus the crops) that you keep. **Import a .identity.zip** on the right brings it back, after its own consent tick. Point at the warning: anyone holding the bundle can generate this face.

## 3:40 – 4:20 · Motion

- Click **Motion**. Under **Picture 1 · person**, click **Upload person photo** and pick one of your face photos. Under **Picture 2 · product**, upload `product-bottle-confetti.png`.
- Point at the prompt: `[Person] holds [Product] up to the light and smiles`. Pick **5 s**, **9:16** and **Preview** (the 4-step turbo). The estimate reads *"1 job · 4 steps · 124 frames"*.
- Click **Roll clip**. The clip area shows its progress while the job runs. Say it: **the mock has no video model, so the player that appears has nothing real to play.** The run, the job, the polling and the **Download MP4** link are real.
- Point at the licence notice under the clip: MiniMax H3 is under a conditional community licence, not a permissive one.
- Say it: in this build Motion takes an uploaded person photo; picking a saved identity here is switched off. Product Shoot does not use identities at all (product photo only).

## 4:20 – 5:00 · Real Comfy Cloud runs and open weights

- Switch to the tab with `docs/images/comfy-cloud-outputs.png`: real Comfy Cloud outputs. If you fetched it, play the real H3 clip, and say what it is: the bare H3 graph run by the golden-run script with a bottle and a mug as its two pictures, not a `/motion` run.
- Say what has run on Cloud:
  - **Product Shoot:** a two-frame shoot. **Listing hero:** compliant. (Recorded on `main`: README.)
  - **MiniMax H3 graph:** a 5 s clip with audio in about 40 s, run by `scripts/golden-run.mjs` with two product stills; the `/motion` page itself has not run on Cloud. (Record in PR #13.)
  - **Listing gallery:** 6 of 6 images in about 62 s. **Story:** 8 of 8 in about 42 s. ZIP export works. (Manual run, reported in PR #13.)
  - **Identity:** a fictional AI-generated person, 4 references chosen, preview sheet in 17.6 s, exported bundle valid. (Manual run, reported in PR #13.)
- The two limits again: Listing panels can drift in colour and material, and the Identity sharpness check rejects small faces.
- Go back to the landing and scroll to **Open weights**. Every row comes from `models/manifest.json`, the same file CI checks against the workflow graphs: FLUX.2 Klein 4B and its Qwen3-4B encoder (**Apache-2.0**), BiRefNet (**MIT**), SeedVR2 (**Apache-2.0**), and MiniMax H3 (**conditional**, shown in amber, not green).
- Don't switch to Cloud on stage. A Cloud run follows L4 in `docs/eval/testing-strategy.md`: a spend-capped key, the production build with `HANDLE_SECRET` and a `STUDIO_ACCESS_CODE` of at least 12 characters, and the graphs in `workflows/*.api.json`. The mock speaks the same `/api/v2` surface the `@comfyorg/sdk` uses (asset upload, job submit, job poll, output download), which is why the demo exercises the real client code end to end.

## If something goes wrong on stage

- **A route is slow the first time.** That is the dev compiler. Keep talking; it happens once per route.
- **A frame fails.** Click **Retry · 1 job** under it. That creates exactly one new job.
- **Identity says "Need at least 3 usable photos."** Read the per-photo reasons aloud: that is the check doing its job. If it says *"Face is blurry"* on sharp photos, the faces are too small (the known limit); use closer crops.
- **The Listing hero fails.** You probably uploaded a photo with a background. The run explains why in plain words and offers **Upload a different photo**: the marketplace gate in action.
- **Port 3000 or 8199 is busy.** Run `PORT=3001 DEMO_PORT=8299 pnpm demo`.
- **Mock only** (for example, when driving the app from another terminal): `pnpm mock`, then `COMFY_BASE_URL=http://127.0.0.1:8199 COMFY_API_KEY=demo pnpm dev`.
