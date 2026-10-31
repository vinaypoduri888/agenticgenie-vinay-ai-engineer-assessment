# Decisions Log

Important architecture/implementation decisions, in plain language, for interview defensibility.

---

### D-001: Technology stack

- **Decision:** Next.js + TS frontend, Express 5 + TS backend, Prisma + PostgreSQL, Redis + BullMQ
  for background jobs only, custom TypeScript agent harness, NVIDIA Nemotron via an
  OpenAI-compatible endpoint as the real model provider, Vitest/Playwright/k6/Postman for testing,
  Docker Compose for local env, GitHub Actions for CI.
- **Why we chose it:** The assessment grants full stack freedom and only requires ≤5-command setup,
  Postgres (preferred) as the source of truth, and a custom (non-framework-hidden) agent loop. This
  stack is a modern, strongly-typed, end-to-end TypeScript stack the candidate already has direct
  experience with (Node/Express, Next.js, Prisma, Postgres, Redis), which supports fast, defensible
  delivery under a ~12–16 hour time budget, and keeps one language across frontend/backend/agent so
  Zod schemas can be shared instead of duplicated.
- **Alternative considered:** Python/FastAPI backend (also suggested by the PDF) — rejected because
  it would split the stack across two languages for no functional benefit, and the Zod-based typed
  tool schemas Part B asks for are more natural in TypeScript.
- **Trade-off:** More moving parts (Prisma, Redis/BullMQ, Docker Compose) than a minimal SQLite +
  single-process solution; mitigated by keeping Redis usage narrow (hold-expiry sweeper only — never
  the inventory source of truth) and Docker Compose optional-but-provided for the 5-command setup.
- **Interview explanation:** "I picked a stack I could move fastest and most correctly in under a
  tight deadline, while keeping every component swappable — the agent loop doesn't care which model
  provider or DB client it's talking to, because those sit behind small interfaces."

---

### D-002: Confidential material handling

- **Decision:** The assessment PDF and the candidate's own docx notes paraphrasing it are excluded
  from git via `.gitignore`, never committed.
- **Why we chose it:** The PDF is explicitly marked confidential ("Please do not share or publish
  this document") and the assessment is a public/shared GitHub repo deliverable. The docx closely
  restates the PDF's confidential details, so it's treated the same way out of caution.
- **Alternative considered:** Committing a redacted summary — rejected as unnecessary; the extracted
  `docs/ASSESSMENT_REQUIREMENTS.md` already captures everything needed to work and to explain the
  submission, without reproducing the original document.
- **Trade-off:** None meaningful — nothing in these files is needed by a reviewer running the repo.
- **Interview explanation:** "The brief said not to publish the document, so I kept it and my notes
  on it local-only and git-ignored, and committed a derived, non-confidential requirements
  checklist instead."

---

### D-003: npm workspaces monorepo, TS-source packages (no build step for dev)

- **Decision:** `apps/api`, `apps/web`, `packages/db`, `packages/shared` as npm workspaces.
  `packages/db` and `packages/shared` are consumed as raw TypeScript source (via `tsx` for the API,
  Next's `transpilePackages` for the web app, and Vitest's built-in esbuild transform for tests) —
  no compile step is required for local dev.
- **Why we chose it:** npm workspaces ship with npm (no extra tool like pnpm/Turborepo to install
  or explain), and skipping a build step for the internal packages keeps the ≤5-command setup
  genuinely simple — editing a shared Zod schema is visible to the API and web app immediately.
- **Alternative considered:** pnpm + Turborepo — rejected as unnecessary overhead for a 4-package
  monorepo on a tight deadline; could revisit if the agent/evals packages (Part B) make the build
  graph more complex.
- **Trade-off:** `packages/db`/`packages/shared` have no real "build" output, so a production
  deployment would need one added later (out of scope — the assessment doesn't require deployment).
- **Interview explanation:** "I treated the shared packages as source, not build artifacts — tsx,
  Next, and Vitest all transpile TypeScript on the fly, so there's nothing to build until I actually
  need a production bundle, which this assessment doesn't require."

### D-004: Classic `prisma-client-js` generator, not Prisma's new `prisma-client` generator

- **Decision:** `packages/db/prisma/schema.prisma` uses `generator client { provider =
  "prisma-client-js" }`, producing the conventional client importable as `from "@prisma/client"`.
- **Why we chose it:** Prisma 6.19's CLI now defaults `prisma init` to a newer `prisma-client`
  generator that emits raw `.ts` source files (including a platform-specific native binary) into a
  project folder, imported via explicit `.ts` extensions — which requires `allowImportingTsExtensions`
  and reshapes how the typecheck/build config works. Confirmed via a throwaway scratch project
  before deciding (see PROGRESS.md Stage 1). The classic generator avoids all of that for no loss
  of functionality at this project's scale.
- **Alternative considered:** the new `prisma-client` generator — rejected for now as unnecessary
  complexity; may be worth revisiting in the "another week" list in DESIGN.md.
- **Trade-off:** classic generator is the path Prisma is nudging users away from long-term, so a
  future Prisma major version could deprecate it — acceptable risk for a 1-week assessment.
- **Interview explanation:** "I actually tried Prisma's new default generator first, saw it meant
  importing `.ts` files directly and baked-in native binaries, and deliberately stepped back to the
  classic generator — simpler, well-documented, works identically across tsx/Vitest/Next without
  special tsconfig flags."

### D-005: Dependency versions pinned to the latest Node-20-compatible release

- **Decision:** Where a package's npm `latest` tag required a newer Node than the installed 20.17
  (Prisma 7→**6.19.3**, Vitest 5→**4.0.8**, concurrently 10→**9.2.5**), pinned to the newest version
  in the prior major that still declares `engines.node` support for 20.x, instead of upgrading the
  machine's Node install.
- **Why we chose it:** nvm-windows was present but non-functional in this environment (silent
  failures investigated and not worth the detour); changing a shared, system-wide Node install is a
  bigger and less reversible action than pinning a few package.json ranges, and every pinned version
  is still current (not legacy) within its major line.
- **Alternative considered:** upgrade Node to 22/24 via nvm-windows — would unlock the latest major
  of every package, but the tool didn't work out of the box and wasn't worth fighting for a one-week
  assessment; documented here so it's an easy follow-up if the grading machine has a newer Node.
- **Trade-off:** not running the absolute newest major of Prisma/Vitest; functionally irrelevant at
  this project's scope.
- **Interview explanation:** "I checked actual engine requirements with `npm view <pkg> engines`
  before pinning versions, rather than guessing — a few packages had just bumped their Node minimum
  past what was installed here, so I pinned to the latest release that still supported it."

### D-006: Non-default local Docker ports for Postgres/Redis

- **Decision:** `docker-compose.yml` maps Postgres to host port **5434** (container still listens
  on 5432) and Redis to host port **6380** (container still listens on 6379).
- **Why we chose it:** this dev machine already had unrelated Postgres/Redis processes bound to the
  default ports (confirmed via `Get-NetTCPConnection` — one was a native/other local Postgres
  process, the other an unrelated Docker container from a different project: `boc-redis`). Changing
  our own port mapping is the non-invasive fix; stopping someone else's running container/service
  would not be.
- **Alternative considered:** stop the conflicting local services — rejected, they belong to
  unrelated work and are out of scope to touch.
- **Trade-off:** `DATABASE_URL`/`REDIS_URL` in `.env.example` use non-default ports, which a
  reviewer on a clean machine can freely change back to 5432/6379 if they prefer. CI (GitHub
  Actions runners are isolated) uses the real default ports, so this only affects local dev here.
- **Interview explanation:** "Rather than fight for the default ports on a machine already running
  other projects' databases, I remapped the host side only — the containers are still standard
  Postgres 16 / Redis 7 internally."

<!-- Add new decisions below as they're made, each as its own ### D-NNN section. -->
