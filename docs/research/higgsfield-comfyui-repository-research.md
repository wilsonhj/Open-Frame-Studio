# Higgsfield and ComfyUI: Repository Research and Reconstruction Guide

Research snapshot: October 28–29, 2026.

## Executive summary

ComfyUI’s public repositories expose much of a working generative-AI stack. Higgsfield’s expose developer integrations, application templates, and a local renderer, but not the complete hosted creative platform. ComfyUI can therefore largely be studied through source-level analysis; reconstructing Higgsfield requires distinguishing published components from services behind an API.

The preceding research inventoried 101 public repositories: 11 under `higgsfield-ai` and 90 under `Comfy-Org`, including forks and archived projects. It reported retrieving 98 READMEs and inspecting selected implementations. This export preserves those findings; it is not a new live audit, a line-by-line review, or an executed benchmark. Counts and availability may change.

“Reverse engineering” in this report means understanding behavior, tracing interfaces, testing authorized installations, and independently implementing compatible functionality—not bypassing authentication, billing, or access controls.

Sources: [Higgsfield repositories](https://github.com/orgs/higgsfield-ai/repositories), [Comfy repositories](https://github.com/orgs/Comfy-Org/repositories).

## What can be reconstructed

| Layer | Higgsfield | ComfyUI |
|---|---|---|
| Application interfaces | Templates expose a generation-studio interface, server actions, model catalogs, and upload handling. | Frontend and standalone applications expose graph editing and task-specific interfaces. |
| Generation clients | Python and TypeScript SDKs expose submission, status, uploads, and agent resources. | SDKs expose workflow and hosted-model interfaces; a proxy adapts self-hosted installations to API v2. |
| Workflow execution | Client code does not establish how the hosted backend is implemented. | Validation, scheduling, caching, node execution, and model management are publicly inspectable. |
| Local rendering | Video Engineer publishes a code-driven WebGPU renderer, separate from hosted AI generation. | Local model inference and supporting optimization libraries are public. |
| Model weights | SDK availability does not provide hosted-model weights. | Workflows still require relevant model files and their separate licenses. |
| Cloud operations | Integrations do not reveal the complete production control plane. | Public components should not be mistaken for the entire commercial cloud service. |

Sources: [Higgsfield SDK](https://github.com/higgsfield-ai/higgsfield-client), [templates](https://github.com/higgsfield-ai/app-templates), [Video Engineer](https://github.com/higgsfield-ai/higgsfield-video-engineer), [ComfyUI](https://github.com/Comfy-Org/ComfyUI), [Comfy frontend](https://github.com/Comfy-Org/ComfyUI_frontend), [API proxy](https://github.com/Comfy-Org/comfy-api-proxy).

Recreating an interface or request protocol is not equivalent to recovering a generation model, its weights, training data, or production infrastructure.

## Higgsfield architecture

### Hosted generation

The Python SDK authenticates, submits model-specific requests, tracks status, and collects output URLs. Uploads and agent sessions are additional resources. Its transport calls a remote API rather than performing model inference inside the client. The TypeScript SDK distinguishes a recommended V2 client, deprecated V1 client, and preview agent API; integrations should pin their target interface.

```text
Application or agent
  -> SDK / CLI / application server
     -> upload reference media
     -> submit generation request
        -> hosted service
           -> status / result / webhook
              -> output assets
```

Sources: [Python implementation](https://github.com/higgsfield-ai/higgsfield-client/tree/main/src/higgsfield_client), [TypeScript SDK](https://github.com/higgsfield-ai/higgsfield-js).

### All 11 Higgsfield repositories

| Repository | Mechanism and inspection direction |
|---|---|
| [higgsfield-client](https://github.com/higgsfield-ai/higgsfield-client) | Python HTTP client with synchronous/asynchronous generation, uploads, retries, request controllers, and agent resources. Trace transport → submission → status → result. |
| [higgsfield-js](https://github.com/higgsfield-ai/higgsfield-js) | TypeScript SDK with V2 requests, schema loading, job abstractions, and agent resources. Compare types, transport, and tests. |
| [skills](https://github.com/higgsfield-ai/skills) | Agent instructions and scripts organize creative tasks. Inspect brief → model selection → parameters → commands → deliverables. |
| [cli](https://github.com/higgsfield-ai/cli) | Terminal generation interface. The checked repository contained documentation, a model reference, installer, and notices—not complete implementation source. |
| [cursor-plugin](https://github.com/higgsfield-ai/cursor-plugin) | MCP configuration, plugin manifest, and command instructions. Trace configuration and authentication handoff. |
| [app-templates](https://github.com/higgsfield-ai/app-templates) | Next.js/shadcn studio scaffolding with model definitions, server calls, uploads, polling, and UI state. Trace one model from catalog to output. |
| [higgsfield-video-engineer](https://github.com/higgsfield-ai/higgsfield-video-engineer) | Local code-based film renderer and agent workflow. Inspect scenes, geometry packing, acceleration structures, shaders, rendering, and encoding. |
| [omagotchi](https://github.com/higgsfield-ai/omagotchi) | QML desktop avatar with generation and sprite-processing scripts. Separate desktop behavior from remote generation and local animation. |
| [homebrew-tap](https://github.com/higgsfield-ai/homebrew-tap) | Distribution formula: versions, downloads, platform selection, checksums. |
| [terraform-aws-alternat](https://github.com/higgsfield-ai/terraform-aws-alternat) | Forked AWS NAT-instance networking with failover and route updates. Ownership does not prove production deployment. |
| [higgsfield](https://github.com/higgsfield-ai/higgsfield) | Archived distributed-training framework for GPU allocation, experiment queues, and sharded training—not the current creative website. |

### SDK analysis

Useful Python entry points include `auth.py`, `http/client.py`, `http/transport.py`, `http/retry.py`, upload mixins, and `agents/resources.py`. They expose credentials, request construction, failure handling, and session resources.

1. Record each public method’s input/output schema.
2. Trace methods into HTTP requests.
3. Create a local mock server for queued, running, completed, failed, and timed-out jobs.
4. Compare synchronous and asynchronous behavior.
5. Implement a compatible client or backend adapter from the observed contract.

This reconstructs client behavior, not hosted-model internals. Source: [Python SDK](https://github.com/higgsfield-ai/higgsfield-client).

### Template analysis

`generation/catalog/models/` contains model definitions. `generation/actions.ts`, `platform.ts`, `upload.ts`, `poll.ts`, and credential handling connect controls to generation. Documentation describes credentials in an HTTP-only cookie and authenticated calls on the server.

A useful independent implementation retains the interface/schema separation but places an authorized backend adapter behind it. Source: [templates](https://github.com/higgsfield-ai/app-templates).

### Video Engineer: a distinct local renderer

Video Engineer is a local, code-driven animation system using Node.js, Chrome, and FFmpeg. It is not simply another hosted diffusion wrapper.

| Component | Role |
|---|---|
| `bin/hve` | Setup, project, render, check, and film commands. |
| `engine/src/scene.mjs` | Scene representation. |
| `geom.mjs`, `pack.mjs`, `bvh.mjs` | Geometry processing, GPU packing, spatial acceleration. |
| `engine/web/pt.wgsl` | GPU path-tracing shader. |
| `renderer.js`, `post.wgsl` | Browser rendering orchestration and post-processing. |
| Tests and proof scenes | Reference cases for renderer behavior. |

Render one primitive, vary one material or light parameter, then compare frames with the relevant shader path. This repository publishes the renderer implementation itself. Source: [Video Engineer](https://github.com/higgsfield-ai/higgsfield-video-engineer).

## ComfyUI architecture

The frontend serializes a runnable graph. The Python server validates and queues it; the executor resolves dependencies, checks caches, invokes nodes, and manages model resources. The inspected core snapshot was [commit 0df1646](https://github.com/Comfy-Org/ComfyUI/commit/0df1646a9cd71d4c990a87014fb37797a2956ead).

```text
Visual workflow
  -> frontend serialization
     -> server validation and queue
        -> dependency scheduling and caching
           -> node implementation
              -> local inference / media processing / optional remote service
                 -> outputs, history, progress
```

Core routes include `/object_info`, `/prompt`, `/queue`, `/history`, uploads, and WebSocket progress. Distinguish those from the newer API-v2 SDK surface. Sources: [server.py](https://github.com/Comfy-Org/ComfyUI/blob/0df1646a9cd71d4c990a87014fb37797a2956ead/server.py), [API proxy](https://github.com/Comfy-Org/comfy-api-proxy).

Classic nodes declare `INPUT_TYPES`, `RETURN_TYPES`, and `FUNCTION`; output nodes identify themselves separately. Newer API mechanisms also exist. Sources: [nodes.py](https://github.com/Comfy-Org/ComfyUI/blob/0df1646a9cd71d4c990a87014fb37797a2956ead/nodes.py), [execution.py](https://github.com/Comfy-Org/ComfyUI/blob/0df1646a9cd71d4c990a87014fb37797a2956ead/execution.py).

```text
server.py                       validation and queue insertion
execution.py                    planning, caching, node invocation
comfy_execution/graph.py         dependency scheduling
nodes.py / extension packages   operation implementations
comfy/model_management.py       model loading and memory management
```

## Complete Comfy-Org repository inventory

Each repository link below identifies the primary source for its description. Forks and historical projects remain included; this is not a list of all independent community extensions.

### Runtime and distribution

| Repository | Mechanism and inspection direction |
|---|---|
| [ComfyUI](https://github.com/Comfy-Org/ComfyUI) | Core graph server and inference runtime; follow validation → queue → execution → node → model. |
| [ComfyUI_frontend](https://github.com/Comfy-Org/ComfyUI_frontend) | Current editor; inspect graph serialization, API calls, extension hooks, and UI state. |
| [Comfy-Desktop](https://github.com/Comfy-Org/Comfy-Desktop) | Current desktop app; inspect independent installation provisioning and process lifecycle. |
| [desktop](https://github.com/Comfy-Org/desktop) | Archived predecessor; historical architecture rather than current starting point. |
| [litegraph.js](https://github.com/Comfy-Org/litegraph.js) | Graph editor with superseded/archived notice; inspect structures and serialization against current integration. |
| [ComfyUI_legacy_frontend](https://github.com/Comfy-Org/ComfyUI_legacy_frontend) | Archived legacy JavaScript interface; historical graph behavior. |
| [ComfyUI_prev](https://github.com/Comfy-Org/ComfyUI_prev) | Core fork; compare commits with canonical runtime. |
| [ComfyUI-Mirror](https://github.com/Comfy-Org/ComfyUI-Mirror) | Additional core codebase; establish provenance and divergence. |
| [ComfyUI-Standalone-Environments](https://github.com/Comfy-Org/ComfyUI-Standalone-Environments) | Environment definitions and PyTorch manifests for desktop provisioning. |
| [python-dependencies](https://github.com/Comfy-Org/python-dependencies) | Sparse packaging repository containing PyInstaller specifications. |
| [wheels](https://github.com/Comfy-Org/wheels) | Prebuilt Windows Python packages; inspect recipes and compatibility. |
| [comfy-angle](https://github.com/Comfy-Org/comfy-angle) | Redistributable ANGLE graphics libraries and compatibility packaging. |
| [comfy-complete](https://github.com/Comfy-Org/comfy-complete) | Curated version-pinned distribution; inspect locks and validation. |

### APIs and agents

| Repository | Mechanism and inspection direction |
|---|---|
| [comfy-cli](https://github.com/Comfy-Org/comfy-cli) | Installation, node/model management, workflow execution, hosted operations. |
| [homebrew-comfy-cli](https://github.com/Comfy-Org/homebrew-comfy-cli) | Homebrew packaging and release provenance. |
| [comfy-python-sdk](https://github.com/Comfy-Org/comfy-python-sdk) | Python API-v2 client: jobs, streaming, outputs, authentication, model calls. |
| [comfy-typescript-sdk](https://github.com/Comfy-Org/comfy-typescript-sdk) | TypeScript API-v2 client; compare types and transport with Python. |
| [comfy-swift-sdk](https://github.com/Comfy-Org/comfy-swift-sdk) | Swift cloud client: submit, stream, retrieve outputs. |
| [comfy-api-proxy](https://github.com/Comfy-Org/comfy-api-proxy) | Adapts self-hosted ComfyUI to API v2; inspect translation and job lifecycle. |
| [comfy-mcp](https://github.com/Comfy-Org/comfy-mcp) | Agent integration; tool schemas, workflow/model calls, spending confirmations. |
| [comfy-cloud-mcp](https://github.com/Comfy-Org/comfy-cloud-mcp) | Archived cloud installer; check replacement guidance. |
| [comfy-skills](https://github.com/Comfy-Org/comfy-skills) | Agent instructions translating image/video/audio/3D intent into operations. |
| [comfy-claude-prompt-library](https://github.com/Comfy-Org/comfy-claude-prompt-library) | Agentic coding prompts and commands, not a generation model. |
| [comfy-codesearch-cli](https://github.com/Comfy-Org/comfy-codesearch-cli) | Searches core, extension, and community code. |
| [comfy-remote-nodes](https://github.com/Comfy-Org/comfy-remote-nodes) | Remote Node Protocol integration; schema discovery, serialization, remote boundaries. |

### Apps and workflow assets

| Repository | Mechanism and inspection direction |
|---|---|
| [comfy-openjutsu](https://github.com/Comfy-Org/comfy-openjutsu) | Character swap: uploaded media → workflow inputs → deployment → output video. |
| [comfy-cinematic-studio](https://github.com/Comfy-Org/comfy-cinematic-studio) | Cinematic prompt composition and Comfy Router response parsing. |
| [comfy-reshoot](https://github.com/Comfy-Org/comfy-reshoot) | Separate depth-analysis and camera-change generation graphs. |
| [comfy-examples](https://github.com/Comfy-Org/comfy-examples) | Application examples demonstrating SDK/backend use. |
| [awesome-comfy](https://github.com/Comfy-Org/awesome-comfy) | Curated discovery resources, not execution code. |
| [fbx-exporter-three](https://github.com/Comfy-Org/fbx-exporter-three) | three.js scene conversion to binary FBX; encoding and target conventions. |
| [quad-wireframe-three](https://github.com/Comfy-Org/quad-wireframe-three) | Polygon-aware wireframes; topology and edge selection. |
| [workflow_templates](https://github.com/Comfy-Org/workflow_templates) | Official graphs, blueprints, metadata, showcase site, model requirements. |
| [workflows](https://github.com/Comfy-Org/workflows) | Graph collection; inspect dependencies and parameters. |
| [example_workflows](https://github.com/Comfy-Org/example_workflows) | Example graph storage with minimal documentation. |
| [Subgraph-Blueprints](https://github.com/Comfy-Org/Subgraph-Blueprints) | Reusable JSON graphs, including cloud-only and blocked subdivisions. |
| [ComfyUI-embedded-workflow-editor](https://github.com/Comfy-Org/ComfyUI-embedded-workflow-editor) | Extract, modify, and write embedded workflow metadata. |
| [creative-campus](https://github.com/Comfy-Org/creative-campus) | Educational workflows and assets with separate dependencies. |

### Models and processing

| Repository | Mechanism and inspection direction |
|---|---|
| [comfy-kitchen](https://github.com/Comfy-Org/comfy-kitchen) | Optimized diffusion kernels; dispatch, tensor layouts, numerical tests, benchmarks. |
| [comfy-aimdo](https://github.com/Comfy-Org/comfy-aimdo) | Model-demand offloading allocator; residency, transfers, synchronization. |
| [comfy-model-tools](https://github.com/Comfy-Org/comfy-model-tools) | Checkpoint packaging and transformation utilities. |
| [comfy-quants](https://github.com/Comfy-Org/comfy-quants) | Quantization utilities; formats, conversions, numerical assumptions. |
| [ComfyUI_Nvidia_VFX_Nodes](https://github.com/Comfy-Org/ComfyUI_Nvidia_VFX_Nodes) | GPU enhancement, HDR, interpolation wrappers around NVIDIA libraries. |
| [NIMnodes](https://github.com/Comfy-Org/NIMnodes) | NVIDIA NIM request/response adapters, not proprietary service internals. |
| [comfystreamerh3](https://github.com/Comfy-Org/comfystreamerh3) | MiniMax-H3-related node definitions and execution integration. |
| [ComfyUI_TensorRT](https://github.com/Comfy-Org/ComfyUI_TensorRT) | TensorRT fork; engine preparation, shape constraints, runtime calls. |
| [ComfyUI_CatVTON_Wrapper](https://github.com/Comfy-Org/ComfyUI_CatVTON_Wrapper) | Virtual-try-on fork; preprocessing, masks, model inputs and outputs. |
| [comfyui-mixlab-nodes](https://github.com/Comfy-Org/comfyui-mixlab-nodes) | Broad extension fork spanning apps, screen sharing, language, speech, 3D. |
| [comfyui-prompt-reader-node](https://github.com/Comfy-Org/comfyui-prompt-reader-node) | Metadata/prompt parser fork and normalized representations. |
| [CustomNodeComfyMath](https://github.com/Comfy-Org/CustomNodeComfyMath) | Small math-node fork; inputs, arithmetic, output types. |
| [ComfyUI-Librarian](https://github.com/Comfy-Org/ComfyUI-Librarian) | Small custom-node project with limited documentation; verify behavior in implementation. |

### Extension infrastructure

| Repository | Mechanism and inspection direction |
|---|---|
| [ComfyUI-Manager](https://github.com/Comfy-Org/ComfyUI-Manager) | Extension management, dependencies, registry metadata, snapshots, security settings. |
| [registry-backend](https://github.com/Comfy-Org/registry-backend) | Registry/CI API handlers, persistence, package metadata, publishing lifecycle. |
| [registry-web](https://github.com/Comfy-Org/registry-web) | Registry UI connected to backend search/package APIs. |
| [Comfy-PR](https://github.com/Comfy-Org/Comfy-PR) | Automates extension publishing setup, pull requests, webhooks, maintenance. |
| [publish-node-action](https://github.com/Comfy-Org/publish-node-action) | Publishes extensions through GitHub Actions and CLI. |
| [cookiecutter-comfy-extension](https://github.com/Comfy-Org/cookiecutter-comfy-extension) | Custom-node scaffolding and packaging. |
| [ComfyUI-React-Extension-Template](https://github.com/Comfy-Org/ComfyUI-React-Extension-Template) | React/TypeScript frontend extension scaffold. |
| [ComfyUI_example_frontend_extension](https://github.com/Comfy-Org/ComfyUI_example_frontend_extension) | Minimal frontend registration and hook example. |
| [ComfyUI_devtools](https://github.com/Comfy-Org/ComfyUI_devtools) | Developer custom-node utilities. |
| [node-diff](https://github.com/Comfy-Org/node-diff) | Node-comparison utility; inspect detected metadata/interface changes. |
| [comfy-multi-player](https://github.com/Comfy-Org/comfy-multi-player) | Yjs shared workflow operations, projections, migrations, concurrent-edit tests. |
| [pyisolate](https://github.com/Comfy-Org/pyisolate) | Separate Python environments with JSON-RPC and tensor sharing; not assumed security isolation. |

### Testing and security

| Repository | Mechanism and inspection direction |
|---|---|
| [comfy-action](https://github.com/Comfy-Org/comfy-action) | Installs ComfyUI and executes workflow JSON in CI. |
| [comfyci-dashboard](https://github.com/Comfy-Org/comfyci-dashboard) | CI result ingestion, storage, presentation. |
| [comfyui-benchmark](https://github.com/Comfy-Org/comfyui-benchmark) | Benchmark extension; timing boundaries and controlled workloads. |
| [Comfy-QA](https://github.com/Comfy-Org/Comfy-QA) | Agent-assisted Playwright QA, recordings, structured reports. |
| [comfyui-ci-container](https://github.com/Comfy-Org/comfyui-ci-container) | Archived browser-test container; historical setup. |
| [comfyci-runpod-worker](https://github.com/Comfy-Org/comfyci-runpod-worker) | GPU regression worker; environment, execution, result collection. |
| [ComfyUI-test-framework](https://github.com/Comfy-Org/ComfyUI-test-framework) | Runtime testing fixtures and correctness assertions. |
| [custom-node-qa](https://github.com/Comfy-Org/custom-node-qa) | Extension QA checks and coverage limitations. |
| [cbyrne-custom-nodes-security-scan](https://github.com/Comfy-Org/cbyrne-custom-nodes-security-scan) | Static-analysis fork; rules and false-negative risks. |
| [ComfyUI-Secure-V2-API-NodeDB](https://github.com/Comfy-Org/ComfyUI-Secure-V2-API-NodeDB) | Registry-node conversion and patch database; transformation compatibility. |
| [comfy-qa-tools](https://github.com/Comfy-Org/comfy-qa-tools) | QA utilities, fixtures, report generation. |
| [comfyui-datadog-monitor](https://github.com/Comfy-Org/comfyui-datadog-monitor) | Monitoring/profiling instrumentation and telemetry export. |
| [gvisor-wsl](https://github.com/Comfy-Org/gvisor-wsl) | WSL/CUDA-oriented gVisor fork; inspect diffs and tests, not assumed isolation guarantees. |

### Documentation and operations

| Repository | Mechanism and inspection direction |
|---|---|
| [docs](https://github.com/Comfy-Org/docs) | Main documentation; compare described contracts with implementation versions. |
| [docs-fork](https://github.com/Comfy-Org/docs-fork) | Documentation fork; check divergence. |
| [embedded-docs](https://github.com/Comfy-Org/embedded-docs) | In-product help content and packaging. |
| [rfcs](https://github.com/Comfy-Org/rfcs) | Design proposals; distinguish proposals from merged behavior. |
| [comfyui-native-port-guide](https://github.com/Comfy-Org/comfyui-native-port-guide) | Native model integration guidance and checkpoint mapping. |
| [translations](https://github.com/Comfy-Org/translations) | Custom-node translations. |
| [github-workflows](https://github.com/Comfy-Org/github-workflows) | Shared CI, permissions, release automation, dependency pinning. |
| [ComfyUI_frontend_setup_action](https://github.com/Comfy-Org/ComfyUI_frontend_setup_action) | Frontend automation setup action. |
| [download-data](https://github.com/Comfy-Org/download-data) | GitHub download collection, SQLite, dashboard—not active-user telemetry. |
| [.github](https://github.com/Comfy-Org/.github) | Organization configuration and community materials. |
| [comfy-cla](https://github.com/Comfy-Org/comfy-cla) | Contributor-agreement signatures. |
| [cla-assistant](https://github.com/Comfy-Org/cla-assistant) | Contributor-agreement automation fork. |
| [strapi-cloud-template-blog-0b026dbccb](https://github.com/Comfy-Org/strapi-cloud-template-blog-0b026dbccb) | Strapi blog scaffold; not generation internals. |
| [lobe-cli-toolbox](https://github.com/Comfy-Org/lobe-cli-toolbox) | Ancillary Git/i18n developer-tooling fork. |

## Three particularly revealing Comfy applications

### Cinematic Studio

Camera, shot, lighting, and look selections become a composed prompt sent by a server route to `bfl/flux-2-pro` through Comfy Router. It does not submit a ComfyUI workflow. Inspect `components/app-runner.tsx` → `lib/prompt.ts` → `app/api/generate/route.ts` → `lib/flux-output.ts`. Recreating this interface is much narrower than recreating its image model. Source: [Cinematic Studio](https://github.com/Comfy-Org/comfy-cinematic-studio).

### Openjutsu

The character-swap app uses a published workflow derived from Akatz Labs’ H3 Character Swap and MiniMax H3. The server uploads a video and reference image, fills graph inputs, submits a deployment job, and retrieves the video. An optional first-frame image request is a separate operation. The documented deployment was tested on a 96 GB GPU; cloning the app does not create the deployment. Name/task similarity does not establish that this reproduces Higgsfield Genjutsu internals. Source: [Openjutsu](https://github.com/Comfy-Org/comfy-openjutsu).

### Reshoot

One graph produces depth geometry for a browser camera preview; another combines MoGe, CrossView Warp, and MiniMax H3 for a changed viewpoint. Inspect the two workflow JSON files, `lib/comfy.ts`, preview handling, and model-build instructions. Its documented 96 GB demonstration is not proof of compatibility with smaller GPUs. Source: [Reshoot](https://github.com/Comfy-Org/comfy-reshoot).

## Reconstruction methodology

### Recover a workflow’s behavior

1. Pin the core commit, frontend version, extensions, and model hashes.
2. Preserve editable and executable API graph representations.
3. Enumerate node classes, links, model references, and external calls.
4. Identify parameters that actually affect generation.
5. Substitute cheap diagnostic outputs where possible.
6. Change one variable at a time and retain intermediate outputs.
7. Rebuild the smallest graph preserving required behavior.

Published templates and app-to-node mappings make this tractable, but model files and environment compatibility remain dependencies. Sources: [templates](https://github.com/Comfy-Org/workflow_templates), [Openjutsu](https://github.com/Comfy-Org/comfy-openjutsu), [Reshoot](https://github.com/Comfy-Org/comfy-reshoot).

### Reimplement an interface

Specify authentication, uploads, parameters, job states, failures, and result handling from public contracts. Keep Comfy core routes, API-v2 proxy, and hosted model routing distinct. A proposed architecture is:

```text
Your interface
  -> your authenticated application server
     -> generation-provider adapter
        -> authorized Higgsfield API
        -> local ComfyUI workflow
        -> Comfy workflow deployment
        -> another authorized provider
```

Normalize job states and output assets at your application boundary, but retain provider-specific parameters. A superficially uniform API can otherwise conceal different costs, capabilities, and failure behavior. Sources: [Higgsfield SDK](https://github.com/higgsfield-ai/higgsfield-client), [Comfy proxy](https://github.com/Comfy-Org/comfy-api-proxy), [Comfy SDK](https://github.com/Comfy-Org/comfy-typescript-sdk).

### Analyze CLI behavior

The checked Higgsfield CLI repository provided distribution material rather than complete implementation source. Begin authorized interoperability analysis with documented help, model schemas, structured outputs, exit codes, and controlled runs under your own account. Where permitted, static binary inspection can clarify packaging/dependencies, but cannot recover the remote generation backend simply because the client calls it. Sources: [CLI](https://github.com/higgsfield-ai/cli), [Homebrew formula](https://github.com/higgsfield-ai/homebrew-tap).

### Study kernels and memory

For Comfy Kitchen and AIMDO, inspect tensor shapes, data types, dispatch, model residency, transfer boundaries, and numerical reference tests. Begin with small deterministic cases and numerical tolerances, then measure under fixed hardware and model settings. Final-image resemblance alone is not a correctness test. Sources: [Kitchen](https://github.com/Comfy-Org/comfy-kitchen), [AIMDO](https://github.com/Comfy-Org/comfy-aimdo).

## Limits and safeguards

- Public availability is not uniform permission: check repository licenses, third-party notices, and model licenses. [Openjutsu](https://github.com/Comfy-Org/comfy-openjutsu) explicitly separates these layers.
- Agent skills expose procedural instructions and orchestration—not necessarily proprietary weights or internal reasoning. Sources: [Higgsfield Skills](https://github.com/higgsfield-ai/skills), [Comfy Skills](https://github.com/Comfy-Org/comfy-skills).
- A public fork does not prove production use or validated security guarantees. Sources: [networking fork](https://github.com/higgsfield-ai/terraform-aws-alternat), [gVisor fork](https://github.com/Comfy-Org/gvisor-wsl).
- Dependency isolation is not automatically a security sandbox. [Pyisolate](https://github.com/Comfy-Org/pyisolate) documents process-based dependency separation and JSON-RPC.
- Review unfamiliar extension code and installation hooks; use disposable environments and keep credentials out of logs and shared graph assets.
- Exact hosted-model cloning is not established: public repositories support compatible interfaces and substantial local components, not recovery of unpublished weights, training data, or complete hosted services.

## Bottom line

For a self-hosted generative-media product, ComfyUI offers a substantially inspectable execution foundation. For a Higgsfield-like managed interface, public templates, SDKs, and skills reveal reusable product and integration patterns, but not the complete hosted backend. Video Engineer is a separate opportunity: an actual published local renderer that can be studied and modified under its license.
