import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_EXPIRES_IN: z.string().default("12h"),
  BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),
  HOLD_EXPIRY_MINUTES: z.coerce.number().int().min(1).max(60).default(10),
  // How often the server sweeps expired holds and settles stuck checkouts.
  // 0 turns the timer off (lazy expiry on read still applies).
  SWEEP_INTERVAL_SECONDS: z.coerce.number().int().min(0).default(30),
  // The fake payment provider's outcome when a request doesn't pick one with
  // X-Payment-Scenario. Also what the agent's purchase tool gets.
  FAKE_PAYMENT_SCENARIO: z.enum(["success", "decline", "timeout_then_success", "timeout_then_decline"]).default("success"),

  // --- Part B: AI agent provider (Stage B1 — fields only, nothing reads
  // these yet; Stage B2 constructs the real provider from them). Default
  // "mock" means the app never requires a paid API key to run.
  AI_PROVIDER: z.enum(["mock", "nemotron"]).default("mock"),
  NEMOTRON_BASE_URL: z.string().optional(),
  NEMOTRON_API_KEY: z.string().optional(),
  NEMOTRON_MODEL: z.string().optional(),
  NEMOTRON_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),

  // Per-turn agent budgets. Every limit here is enforced by the loop, not by
  // anything the model is told.
  AGENT_MAX_STEPS: z.coerce.number().int().min(1).max(20).default(6),
  AGENT_TOKEN_BUDGET: z.coerce.number().int().positive().default(24_000),
  AGENT_TOOL_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    console.error(
      "Invalid environment configuration:",
      z.flattenError(parsed.error).fieldErrors,
    );
    throw new Error("Invalid environment configuration");
  }
  return parsed.data;
}

export const env = loadEnv();
