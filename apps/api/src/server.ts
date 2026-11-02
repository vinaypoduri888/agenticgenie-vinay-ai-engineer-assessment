import path from "node:path";
import dotenv from "dotenv";

// Both `npm run dev -w apps/api` (tsx watch src/server.ts) and
// `npm run start -w apps/api` (node dist/src/server.js) run with apps/api
// as the working directory — but `__dirname`-relative traversal is NOT
// stable between the two: the compiled output sits one level deeper
// (dist/src/ vs src/), so a fixed "../../../.env" silently resolved to the
// wrong path (apps/.env) under `npm start`, a real bug caught only by
// actually running the production build rather than just compiling it.
// `process.cwd()` is stable across both invocations, so anchor there.
dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });

const { env } = await import("./env.js");
const { createApp } = await import("./app.js");
const { startBackgroundJobs } = await import("./jobs.js");

const app = createApp();
startBackgroundJobs();

app.listen(env.PORT, () => {
  console.log(`[api] listening on http://localhost:${env.PORT}`);
  console.log(`[api] docs at http://localhost:${env.PORT}/docs`);
});
