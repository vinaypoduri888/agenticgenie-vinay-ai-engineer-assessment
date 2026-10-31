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

<!-- Add new decisions below as they're made, each as its own ### D-NNN section. -->
