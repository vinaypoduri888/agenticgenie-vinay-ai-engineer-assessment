import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

// Monorepo layout: apps/api/src/server.ts -> repo root is 3 levels up.
// Loaded explicitly (rather than relying on dotenv's cwd lookup) because
// `npm run dev -w apps/api` runs with apps/api as the working directory.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const { env } = await import("./env.js");
const { createApp } = await import("./app.js");

const app = createApp();

app.listen(env.PORT, () => {
  console.log(`[api] listening on http://localhost:${env.PORT}`);
  console.log(`[api] docs at http://localhost:${env.PORT}/docs`);
});
