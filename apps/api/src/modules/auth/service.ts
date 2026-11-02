import { prisma } from "@agenticgenie/db";
import { ApiError } from "../../lib/errors.js";
import { writeAuditLog } from "../../lib/audit.js";
import { signAccessToken } from "./jwt.js";
import { hashPassword, verifyPassword } from "./password.js";
import type { LoginBody, RegisterBody } from "./schemas.js";

export interface AuthResult {
  token: string;
  user: { id: string; email: string; name: string; createdAt: Date };
}

export async function registerUser(input: RegisterBody, requestId: string): Promise<AuthResult> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new ApiError(409, "EMAIL_ALREADY_REGISTERED", "An account with this email already exists");
  }

  const passwordHash = await hashPassword(input.password);
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: { email: input.email, passwordHash, name: input.name },
      select: { id: true, email: true, name: true, createdAt: true },
    });
    await writeAuditLog(tx, {
      actorUserId: created.id,
      organiserId: null,
      action: "USER_REGISTERED",
      entityType: "User",
      entityId: created.id,
      afterData: { id: created.id, createdAt: created.createdAt },
      requestId,
    });
    return created;
  });

  return { token: signAccessToken(user.id), user };
}

export async function loginUser(input: LoginBody): Promise<AuthResult> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  // Same error for "no such email" and "wrong password" — distinguishing
  // them would let a client enumerate which emails have accounts.
  if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
    throw new ApiError(401, "INVALID_CREDENTIALS", "Incorrect email or password");
  }

  return {
    token: signAccessToken(user.id),
    user: { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt },
  };
}
