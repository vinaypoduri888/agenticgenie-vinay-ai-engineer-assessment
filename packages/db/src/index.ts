import { PrismaClient } from "@prisma/client";

// Standard dev-mode singleton: without it, tsx's watch-mode restarts (and
// Next.js's hot reload, later, if this package is ever imported server-side
// from apps/web) would each spin up a new PrismaClient and exhaust Postgres's
// connection pool.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
