import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import { env } from "../../src/env.js";
import { signAccessToken, verifyAccessToken } from "../../src/modules/auth/jwt.js";

describe("JWT access tokens", () => {
  it("signs and verifies a valid token, round-tripping the subject", () => {
    const token = signAccessToken("user-123");
    const payload = verifyAccessToken(token);
    expect(payload.sub).toBe("user-123");
  });

  it("rejects an expired token", () => {
    const expired = jwt.sign({ sub: "user-123" }, env.JWT_SECRET, { expiresIn: "-10s" });
    expect(() => verifyAccessToken(expired)).toThrow();
  });

  it("rejects a token signed with the wrong secret", () => {
    const wrongSecret = jwt.sign({ sub: "user-123" }, "a-completely-different-secret-value", {
      expiresIn: "1h",
    });
    expect(() => verifyAccessToken(wrongSecret)).toThrow();
  });

  it("rejects a malformed token", () => {
    expect(() => verifyAccessToken("not-a-jwt-at-all")).toThrow();
  });

  it("rejects a token missing a subject claim", () => {
    const noSubject = jwt.sign({ foo: "bar" }, env.JWT_SECRET, { expiresIn: "1h" });
    expect(() => verifyAccessToken(noSubject)).toThrow();
  });
});
