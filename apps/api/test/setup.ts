import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

// Auth and route-level integration tests in this suite hit the real
// Postgres container (see test/helpers/fixtures.ts), so — unlike Stage 1's
// fully-mocked health test — these tests need a real DATABASE_URL. Load the
// repo-root .env the same way apps/api/src/server.ts does. In CI, this file
// won't exist; dotenv.config() is a silent no-op then, and the workflow's
// own `env:` block (pointing at the CI Postgres service) is what's used.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

process.env.NODE_ENV ??= "test";
process.env.PORT ??= "4000";
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.CORS_ORIGIN ??= "http://localhost:3000";
process.env.JWT_SECRET ??= "test-only-secret-not-used-outside-automated-tests-00000";
process.env.JWT_EXPIRES_IN ??= "12h";
process.env.BCRYPT_SALT_ROUNDS ??= "4"; // weakest allowed cost factor — tests hash many passwords
