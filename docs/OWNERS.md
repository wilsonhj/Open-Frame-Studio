# Path ownership (Wave 2)

Every path in the repo has exactly one owner: one of the seven Wave 2 slices (A–G) or the
orchestrator. A slice branch may only change paths its slice owns. Source: `docs/PLAN.md`
"Wave 2: vertical slices". `scripts/check-owners.mjs` reads the table below; keep its format
(one row per owner, globs in backticks, `!glob` excludes).

Slices request contract, dependency or config changes (anything the orchestrator owns) in their
handbacks; the orchestrator applies them additively at checkpoints. Shared seams are frozen at
the `contracts-v1` tag: `lib/contracts/**`, `lib/types.ts`, `lib/pipeline/{types,kinds}.ts`, and
the export names and signatures of every W2.0 stub (`lib/{soul,photoshoot,cards,motion}/pipeline.ts`,
`lib/soul/registry.ts`, `lib/bindings/prepare.ts`, `components/ui/*`, `components/soul/soul-library.tsx`,
`lib/client/use-run.ts`, `app/api/pipelines/[kind]/**`). The owner fills in a stub's body; any
signature change is additive only.

## Ownership table

| Owner | Name | Owns |
|---|---|---|
| A | Runtime | `lib/pipeline/**`, `!lib/pipeline/{types,kinds}.ts`, `lib/store.ts`, `instrumentation.ts`, `lib/comfy.ts`, `lib/inputs.ts`, `lib/metrics.ts`, `app/api/{jobs,pipelines,runs,status}/**`, `tests/mock-comfy/**`, `tests/{comfy,inputs}.test.ts`, `tests/{pipeline,store}/**`, `docs/spec/api.md` |
| B | Graphs & Cloud | `workflows/**`, `models/**`, `scripts/check-models.mjs`, `lib/bindings/**`, `tests/bindings.test.ts`, `tests/graphs/**`, `fixtures/golden/**`, `scripts/{golden-run,check-object-info,check-derived}.mjs`, `apps/**`, `comfy-pack/**`, `docs/spikes/**` |
| C | Soul | `lib/soul/**`, `app/api/souls/**`, `app/soul/**`, `components/soul/**`, `tests/soul/**`, `tests/e2e/soul.spec.ts`, `docs/spec/soul.md` |
| D | Photoshoot | `lib/enhancer/**`, `lib/photoshoot/**`, `app/photoshoot/**`, `components/photoshoot/**`, `tests/{enhancer,photoshoot}/**`, `tests/e2e/photoshoot.spec.ts`, `docs/spec/photoshoot.md` |
| E | Cards | `lib/cards/**`, `assets/fonts/**`, `app/cards/**`, `components/cards/**`, `tests/cards/**`, `tests/e2e/cards.spec.ts`, `docs/spec/marketplace.md` |
| F | Motion | `lib/motion/**`, `app/motion/**`, `components/motion/**`, `tests/motion/**`, `tests/e2e/motion.spec.ts` |
| G | Shell & DevEx | `app/{layout.tsx,page.tsx,globals.css}`, `app/{runs,smoke}/**`, `components/{shell,ui}/**`, `components/{job-runner,coming-soon}.tsx`, `lib/client/**`, `tests/e2e/{smoke,shell}.spec.ts`, `playwright.config.ts`, `README.md`, `docs/setup/**`, `docs/spec/ux.md`, `docs/submission/**`, `scripts/demo*`, `.env.example`, `.github/**`, `public/**` |
| orchestrator | Orchestrator | `lib/contracts/**`, `lib/types.ts`, `lib/pipeline/{types,kinds}.ts`, `package.json`, `pnpm-lock.yaml`, `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `postcss.config.mjs`, `next-env.d.ts`, `fixtures/products/**`, `fixtures/README.md`, `scripts/make-fixtures.mjs`, `scripts/check-owners.mjs`, `tests/tooling/**`, `docs/PLAN.md`, `docs/OWNERS.md`, `docs/RESEARCH.md`, `docs/research/**`, `docs/eval/**`, `spikes/**`, `AGENTS.md`, `LICENSE`, `.gitignore` |

Glob syntax: `*` (within one path segment), `**` (any depth), `?`, `{a,b}`; a leading `!` excludes
paths from that owner's earlier globs. A path that matches no row, or more than one, is an
error in the audit (`--audit`), which the unit test `tests/tooling/owners.test.ts` runs on every
tracked file.

## Checking a branch

```bash
# explicit slice and base
node scripts/check-owners.mjs C origin/main
# auto: slice from OWNER_SLICE, or from the branch name w2/<slice>... (e.g. w2/c-registry → C);
# base from OWNERS_BASE (default origin/main). No slice detected → prints "skipped", exits 0.
pnpm check:owners
# every tracked file has exactly one owner
node scripts/check-owners.mjs --audit
```

The check runs `git diff --name-only <base>...HEAD` (changes since the merge base, so merging
`main` into a slice branch does not count other slices' files) and fails listing each path the
slice does not own. Name slice branches `w2/<slice letter>-<topic>` (`w2/a-store`, `w2/e1-main`);
CI then runs the check on the pull request against its base branch. The orchestrator's own
branches (`wave2`, merges into `main`) are not checked.
