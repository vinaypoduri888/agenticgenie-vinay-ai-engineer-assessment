import { prisma } from "@agenticgenie/db";
import { ApiError } from "../../lib/errors.js";
import { signAccessToken } from "./jwt.js";
import { hashPassword, verifyPassword } from "./password.js";
import type { LoginBody, RegisterBody } from "./schemas.js";

export interface AuthResult {
  token: string;
  user: { id: string; email: string; name: string; createdAt: Date };
}

export async function registerUser(input: RegisterBody): Promise<AuthResult> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new ApiError(409, "EMAIL_ALREADY_REGISTERED", "An account with this email already exists");
  }

  const passwordHash = await hashPassword(input.password);
  const user = await prisma.user.create({
    data: { email: input.email, passwordHash, name: input.name },
    select: { id: true, email: true, name: true, createdAt: true },
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
