import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { defineConfig, env } from "prisma/config";

// packages/db/prisma.config.ts -> repo root .env is 2 levels up. Prisma CLI
// no longer auto-loads .env once a prisma.config.ts is present, so this file
// has to load it itself (as Prisma's own `prisma init` template recommends).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  engine: "classic",
  datasource: {
    url: env("DATABASE_URL"),
  },
});
