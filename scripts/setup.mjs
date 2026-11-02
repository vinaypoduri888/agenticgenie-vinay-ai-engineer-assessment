#!/usr/bin/env node
// One-step local setup: env files, a generated JWT secret, Prisma client,
// migrations and seed data. Safe to re-run; existing env files are kept.
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

function ensureEnvFile(target, example) {
  if (existsSync(target)) return false;
  copyFileSync(example, target);
  return true;
}

if (ensureEnvFile(".env", ".env.example")) {
  const secret = randomBytes(48).toString("hex");
  const contents = readFileSync(".env", "utf8").replace(/^JWT_SECRET=.*$/m, `JWT_SECRET="${secret}"`);
  writeFileSync(".env", contents);
  console.log("Created .env with a generated JWT secret");
}
if (ensureEnvFile("apps/web/.env.local", "apps/web/.env.example")) {
  console.log("Created apps/web/.env.local");
}

for (const command of ["npm run db:generate", "npm run db:migrate:deploy", "npm run db:seed"]) {
  console.log(`\n> ${command}`);
  execSync(command, { stdio: "inherit" });
}
console.log("\nSetup complete. Run: npm run dev");
