# Open Soul Studio: open-model product direction and Higgsfield UX research

Research date: **October 29, 2026 (Pacific)**. Status: research and proposed acceptance criteria; no implementation or generation results are claimed.

## 1. Decision and corrected product objective

Open Soul Studio is aligned with the intended hackathon direction: **an open-source creative application powered primarily by open-weight models through ComfyUI, with an original, easier creative workflow inspired by selected Higgsfield interactions**. Open model access, inspectable workflows and portable work are core product requirements alongside usability. They should not be treated merely as a prize-category optimization.

The repository owner's additional guidance, relaying ComfyUI engineers, is that the hackathon prioritizes open-source/open-weight alternatives as well as UI/UX. This is owner-provided guidance, not an independently verified quotation from the organizers. The public challenge page separately establishes that app code must be published under an open-source license with setup instructions. Its Open Weights Only category excludes partner nodes and closed-source APIs; the general competition still permits partner models. Keep that distinction accurate. The posted deadline is October 30, 2026, 9am Pacific. [S1]

**Recommended product statement:** Build an open-source product-creative studio on ComfyUI. Help a creator reuse a product and optional reference identity, choose an original visual recipe, generate with open-weight models, inspect fidelity, revise selectively and export the result with its workflow and provenance. Prioritize a complete, reproducible open-model experience over matching Higgsfield's full feature inventory.

### Evidence boundaries

- **Repository facts:** `main` at `e43ac9c182d4e95ee9afd5f98cb967d786e9cc57`; PR #2 (`wave1`) at `fbef2e71e25b7d9e63b2fdf5e616201cccff839c`. References to the Wave 1 specs and canonical graphs below concern the PR head, not merged functionality. [R1]
- **Primary-source findings:** public organizer pages, official Higgsfield documentation, Comfy documentation, upstream model cards and license texts. Comfy integration documentation was also checked through Context7.
- **Not observed:** an authenticated Higgsfield session, comparative user testing, downloaded model checksum verification, real Comfy Cloud generation or a real local GPU generation in this research session.
- **Recommendations:** the proposed priorities, UX changes and release gates below. They do not silently change frozen runtime contracts or replace the existing implementation plan.

## 2. What the repository already gets right

| Area | Evidence at the reviewed PR head | Assessment |
|---|---|---|
| Engine boundary | `lib/comfy.ts`, `lib/bindings/`, six API-format graphs and server-side job routes | Reuses the engine and official SDK rather than rebuilding inference. |
| Open-model direction | Klein 4B, BiRefNet, SeedVR2 and H3 workflows | Strong alignment, subject to the artifact and license qualifications below. |
| Original design | `docs/spec/ux.md` sections 1, 11 and 14 | Contact sheets, a separate brief panel, light/dark themes, mobile behavior and accessibility are deliberate design choices. |
| Ownership | Instant reference bundle, workflow JSON, planned editable card rendering | Useful differentiation from a platform-bound creative workflow. |
| Reliable execution | Submit ambiguity handling, planned persisted keys and restart reconciliation | Reliability contributes directly to trust and usability. |
| Scope honesty | Tool pages render `ComingSoon`; product-flow tests include `test.fixme` | Wave 1 is a scaffold/contracts milestone, not a finished studio. |

The prior alignment assessment placed too much emphasis on UI alone. With the clarified objective, selecting and exposing usable open models is part of the product, not incidental infrastructure. The remaining question is whether the complete application can deliver that promise with documented model terms and reproducible execution. [R1]

## 3. Open source, open weights and hosted execution are different

Use these labels separately:

1. **Application code:** this repository's MIT license covers its application code and applicable attributed portions. It does not relicense ComfyUI or model weights.
2. **Model weights:** publicly downloadable parameters can have permissive or conditional licenses. Downloadability alone does not establish unrestricted commercial use.
3. **Execution:** running an open-weight checkpoint through Comfy Cloud is different from calling a closed-model partner node. Cloud hosting alone does not make the underlying model closed; local execution alone does not make its license permissive.
4. **Reproduction:** a filename and graph do not establish which exact bytes ran. Pin artifact revisions and hashes, node/runtime versions and graph hashes.

For the strict open-weight demonstration, use native inference graphs with no partner/closed-model calls, and audit dependencies beyond the headline diffusion model. A class-name grep is a preliminary check, not sufficient proof: custom nodes can call external services and workflows may depend on text encoders, VAEs or LoRAs with separate terms. Record the complete dependency closure and execution evidence. [S1, S2]

## 4. Model and artifact assessment

This is a source-level inventory, **not a completed model lockfile**. Official repack cards list filenames matching the graphs; matching names are not checksum verification of installed or Cloud assets.

| Component | Artifact named by PR #2 | Primary-source finding | Recommendation |
|---|---|---|---|
| Image generation/editing | `flux-2-klein-4b.safetensors` | BFL's FLUX.2 Klein 4B release is Apache-2.0 and supports multi-reference editing. Comfy's repack identifies the original release and this filename. [S3, S4] | Keep as the default image baseline; measure product and identity fidelity. Do not inherit another FLUX variant's license or performance claims. |
| Klein text encoder and VAE | `qwen_3_4b.safetensors`; `flux2-vae.safetensors` | Comfy's same repack lists both files; Qwen3-4B upstream is Apache-2.0. [S4, S5] | Inventory and hash these separately; record the actual conversion/revision rather than inferring identity from the filename. |
| Product cutout | `birefnet.safetensors` | Official BiRefNet and Comfy repack identify MIT licensing and background-removal artifacts. [S6, S7] | Keep deterministic product compositing for the main image. Check masks against difficult product edges. |
| Optional restoration/upscale | `seedvr2_3b_int8_convrot.safetensors`; `seedvr2_ema_vae_fp16.safetensors` | Upstream SeedVR2-3B and Comfy's repack identify Apache-2.0; the repack documents conversion and both filenames. [S8, S9] | Optional enhancement after a working base journey. Extra pixels do not prove improved logos, text or identity. |
| Current motion path | H3 reference model, Qwen3-VL encoder, video/audio VAEs and turbo LoRA | Comfy publishes repackaged open weights; H3 uses a custom Community License, not Apache/MIT. The repack also identifies upstream conversion sources. [S10, S11] | Retain as a conditional motion option. Audit every component and applicable deployment terms before promising universal self-host use. |
| Proposed permissive motion alternative | Wan2.2 TI2V-5B or I2V-A14B; not integrated in this repo | Official model release and Comfy native workflow documentation identify Apache-2.0. [S13, S14] | Evaluate as a separate still-to-video recipe. It is not a drop-in replacement for H3's two-reference, native-audio behavior. |

### H3 is open weights with conditions

The upstream H3 Community License defines excluded territories including the EU, UK, South Korea and US, and has additional commercial and use terms. Comfy's license page describes a separate licensing route and says Comfy Cloud subscriptions include commercial rights for generated outputs. Do not generalize that hosted-output statement into unrestricted rights to redistribute, self-host or resell model access. Eligibility for a hackathon category is also separate from a deployment license assessment. [S11, S12]

This finding does **not** establish that H3 is disallowed from the challenge. The organizer explicitly offers an H3 bonus. It establishes that the product must describe it accurately. For a broadly reusable permissive baseline, prioritize the image path and evaluate Wan separately; do not block the image release on video. [S1, S13, S14]

LTX-2 is another open-weight candidate, but its currently published `LICENSE-2` includes revenue and competitive-use conditions. Do not present it as an automatically permissive substitute. This report does not recommend changing video engines without a capability and terms comparison. [S15]

### Required model bill of materials

Before an open-model release claim, record for every checkpoint, encoder, VAE, adapter, detector and tokenizer: role; upstream and repack repositories; immutable revision; file path and SHA-256; license identifier/text reference; conversion/quantization provenance; compatible node/runtime version; and verification status. Record Cloud artifact identity when exposed; otherwise state that provider-side bytes were not independently verified.

Include auxiliary face models and fonts. The PR's identity protocol deliberately chooses YuNet/SFace and excludes InsightFace weights; preserve that decision. A runtime's code license must not be used as a substitute for verifying the exact face-model artifact license. [R2]

## 5. Higgsfield interactions worth selectively retaining

These findings are documented public behavior and product claims, **not live interaction observations**. The original static research remains useful, but its template layout notes should not be labeled a validated account-level UX benchmark. [R3]

| Documented pattern | Useful principle | Proposed Open Soul adaptation |
|---|---|---|
| Preview a template and Recreate it with a product, optional face and edit intent. [S16] | Show the outcome before asking for technical inputs. | A small original preset gallery backed by executable open-model recipes; contact sheets remain the results view. |
| Save a named product and reuse its references across formats; a person is optional. [S16, S17] | Reuse the subject, not only the identity. | Product library beside reference identities; independent starting tasks for product shots, identities and listing images. |
| Editable text/image elements in posters and layouts. [S16] | Revise without regenerating every pixel. | Store card copy and layout as editable data; text-only edits render in code without another image job. |
| Controls differ among Soul models. [S18] | Expose capabilities honestly. | A small recipe capability table drives available references, counts, aspect ratios, audio and quality options. |
| A trained identity is distinct from a per-generation reference. [S19] | Explain the fidelity mechanism accurately. | Label the portable bundle a reference identity and verify reuse across separate jobs; do not claim trained-ID equivalence. |

The current consumer Soul ID guide describes 20–80 training photos, whereas older CLI-oriented repo research uses 5–20. These are distinct source surfaces and possibly versions. Open Soul's own Instant input requirements should be explicit; neither number should be copied into its UI without reference to the chosen mechanism. [S19, R1]

Recommended primary journey: **saved product → visual recipe → optional identity → readiness check → generate → compare/revise → export**. Identity creation should never appear required for product-only work. The current UX spec's replacement of template galleries with a Soul-first sequence is a design hypothesis to test, not an established improvement. [R4]

## 6. UX requirements created by the open-model objective

- **Readiness before submission:** report backend reachability, required nodes, model-file availability and supported settings. An environment variable being present is not proof the backend is reachable or generation is authorized.
- **Simple task controls, inspectable execution:** present intent and outcomes first. An expandable details panel shows model/license information, the graph and settings. Avoid turning the normal user flow into a node editor.
- **Capability-based alternatives:** when H3 is unavailable, offer a supported still-to-video recipe with its limitations. Do not silently promise equivalent reference control or native audio.
- **Truthful quality labels:** distinguish generation from restoration/upscale. Use measured latency ranges for the chosen hardware/backend; upstream best-case timings are not application guarantees.
- **Reference/result review:** enable side-by-side inspection of product shape, color, logos, packaging text and identity before export. A white-background/image-fill check is not a guarantee of marketplace-wide compliance. [S17]
- **Honest spending and recovery:** one click starts one run, which may contain several jobs. Show planned job counts and labelled estimates or unavailable cost. Keep partial results and reconcile uncertain submissions before offering another paid run. This corrects the spec's one-click/one-job wording. [R4]
- **Portable work:** export graph, inputs or input hashes as appropriate, parameters, model manifest, license references and editable card data. Preserve private inputs under the user's control. A seed is not a promise of pixel-identical output across hardware and software versions.

The official v2 API supports a common SDK integration across Cloud, deployments and the self-host proxy. For local use, the proxy normally fronts ComfyUI on port 8188 and serves v2 on port 8189. The app's local proof should use the proxy, not assume native ComfyUI exposes v2 directly. This was checked in official docs through Context7. [S2, S20]

## 7. Proposed next milestone and acceptance gates

These are recommendations for the next implementation checkpoint, not statements that tests have passed.

| Priority | Deliverable | Required evidence |
|---|---|---|
| P0 | One complete open-weight image journey | Fresh setup → upload/save product → choose original recipe → generate → inspect → revise one output → export, using real inference. |
| P0 | Artifact and license manifest | Every required model component has provenance and terms; installed hashes recorded where possible; unresolved entries explicitly block a blanket verified claim. |
| P0 | Reliable run handling | Refresh/restart preserves state; an ambiguous submit does not create an automatic fresh-key job; completed items survive partial failure. |
| P0 | Direct product-only UX | User reaches a usable result without making a Soul or writing the assembled prompt; mobile and keyboard paths are exercised. |
| P0 for submission | Open-weight evidence bundle | Graph/node inventory, custom-node network behavior review, model manifest, setup instructions and actual run evidence. Publish app code as required by the organizer. |
| P1 | Independently usable self-host path | One actual local/self-hosted image generation through the proxy, with node/model preflight and recorded hardware/runtime. Promote this from P2 if local ownership is a headline promise. |
| P1 | Identity quality and portability | Run the existing blind identity protocol and export/restart/import reuse test; report failures as well as passes. |
| P1 | Optional motion comparison | Evaluate Wan still-to-video and H3 reference/audio separately; record capabilities, terms, runtime and outputs rather than asserting parity. |
| P2 | Broader mode/asset catalog | Expand only after the complete core path works. |

For usability evaluation, compare the same product-shot, listing-image and revision tasks. Record unaided task completion, time to first usable result, required prompt writing, recovery success and fidelity judgments. Separate user interaction time from queue and GPU time. Do not claim the UX is better until comparative evidence exists.

For the demo, keep a clearly labeled pre-run backup and distinguish it from live inference. Publish exact tested recipes, not an unsupported claim that every model or device works. The repository remains a promising foundation; the next proof is a usable, reproducible open-model application. [R1]

## 8. Outstanding questions

- What exact revisions/hashes correspond to models installed on the chosen backend?
- Which H3 components and deployment permissions apply to the intended demonstration and later self-host distribution?
- Does Klein retain both product detail and reference identity in the actual chosen multi-reference graph?
- What are measured runtime, peak resources and failure behavior for the intended machine/backend?
- Does visual preset discovery reduce task friction compared with the current Soul-first home proposal?
- Does a separate Wan recipe provide sufficient motion value without expanding the hackathon scope excessively?

No paid generations, model downloads, comparative usability tests or runtime implementation changes were performed for this report. The real-inference blockers recorded in PR #2 remain unverified here.

## Primary sources

All external sources below were retrieved October 29, 2026 (Pacific). Most external URLs track mutable upstream pages; retrieval date is not an immutable model revision. Recheck and pin the selected artifacts before release. License observations summarize published terms for engineering selection; they do not replace those terms.

- **S1:** [Comfy Open Source Higgsfield challenge](https://comfy.org/open-source-higgsfield): category rules, OSS publication/setup and deadline.
- **S2:** [Comfy API v2 overview](https://docs.comfy.org/api-reference/v2/overview): execution surfaces and SDK integration.
- **S3:** [BFL FLUX.2 Klein 4B model card](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B): Apache-2.0 and editing capabilities.
- **S4:** [Comfy Flux-2-Klein-4B repack](https://huggingface.co/Comfy-Org/Flux-2-Klein-4B): original releases and model/encoder/VAE filenames.
- **S5:** [Qwen3-4B model card](https://huggingface.co/Qwen/Qwen3-4B): upstream encoder family licensing.
- **S6:** [Official BiRefNet model card](https://huggingface.co/ZhengPeng7/BiRefNet): MIT release.
- **S7:** [Comfy BiRefNet repack](https://huggingface.co/Comfy-Org/BiRefNet): background-removal artifact mapping.
- **S8:** [SeedVR2-3B model card](https://huggingface.co/ByteDance-Seed/SeedVR2-3B): Apache-2.0 release.
- **S9:** [Comfy SeedVR2 repack](https://huggingface.co/Comfy-Org/SeedVR2): upstream mapping, conversion and artifact filenames.
- **S10:** [Comfy MiniMax-H3 repack](https://huggingface.co/Comfy-Org/MiniMax-H3): model, encoder, adapter and VAE provenance.
- **S11:** [MiniMax H3 upstream license](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE): territory, commercial and other conditions.
- **S12:** [Comfy MiniMax commercial-license page](https://comfy.org/minimax/license): local licensing and Cloud output rights statements.
- **S13:** [Official Wan2.2 TI2V-5B model card](https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B): Apache-2.0 candidate.
- **S14:** [Comfy Wan2.2 native workflows](https://docs.comfy.org/tutorials/video/wan/wan2_2): supported variants and native setup.
- **S15:** [LTX-2 LICENSE-2](https://github.com/Lightricks/LTX-2/blob/main/LICENSE-2): section 2 and Attachment A(20).
- **S16:** [Higgsfield Marketing Studio](https://higgsfield.ai/marketing-studio-intro): documented preset, Recreate, saved-product and editable-layout patterns.
- **S17:** [Higgsfield product photography guide](https://higgsfield.ai/blog/how-to-make-ai-product-photos-without-a-studio): product references, optional avatars and fidelity review.
- **S18:** [Higgsfield Soul generation guide](https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-use-soul-to-generate-images): model-dependent controls.
- **S19:** [Higgsfield Soul ID guide](https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-create-and-use-a-soul-id-character): trained identity mechanism and current consumer input guidance.
- **S20:** [Comfy SDK guide](https://docs.comfy.org/development/api-development/sdks): backend selection and self-host proxy; checked through Context7.

## Repository evidence

- **R1:** PR #2 (original private repo); the Wave 1 tree; the then-current main tree.
- **R2:** [Identity acceptance protocol](https://github.com/wilsonhj/Open-Frame-Studio/blob/main/docs/eval/identity.md): selected auxiliary models, unimplemented evaluation script and pending results.
- **R3:** [Reverse-engineering provenance](https://github.com/wilsonhj/Open-Frame-Studio/blob/main/docs/research/re-findings.md): static evidence boundaries.
- **R4:** [UX specification](https://github.com/wilsonhj/Open-Frame-Studio/blob/main/docs/spec/ux.md): sections 1, 3, 7 and 10; [implementation plan](https://github.com/wilsonhj/Open-Frame-Studio/blob/main/docs/PLAN.md).
