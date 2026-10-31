import bcrypt from "bcryptjs";
import { env } from "../../env.js";

/** bcryptjs over a native bcrypt/argon2 binding — see docs/DECISIONS.md:
 * no node-gyp/native-build step keeps `npm install` reliable across the
 * reviewer's OS, which matters more here than the marginal GPU-crack-cost
 * edge of Argon2id. bcrypt remains an OWASP-acceptable choice. */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, env.BCRYPT_SALT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
