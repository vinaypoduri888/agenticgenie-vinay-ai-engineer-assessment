import { randomUUID } from "node:crypto";
import { prisma } from "@agenticgenie/db";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";

const app = createApp();

// These tests register real users through the HTTP endpoint (that's the
// behaviour under test), so each test registers its own uniquely-prefixed
// email and this cleans up exactly the ones *this file* created. (A shared
// "test-auth-" prefix would collide with other test files' fixtures when
// Vitest runs files in parallel — each file's cleanup would delete other
// files' in-flight test data. Keep this prefix distinct from
// test/helpers/fixtures.ts's.)
const emailPrefix = "test-register-login-";
function testEmail() {
  return `${emailPrefix}${randomUUID()}@example.com`;
}

afterEach(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: emailPrefix } } });
});

describe("POST /auth/register", () => {
  it("creates an account and returns a token with no password hash", async () => {
    const email = testEmail();
    const response = await request(app)
      .post("/auth/register")
      .send({ email, password: "correct-horse-battery-staple", name: "Riya" });

    expect(response.status).toBe(201);
    expect(response.body.token).toEqual(expect.any(String));
    expect(response.body.user).toMatchObject({ email, name: "Riya" });
    expect(response.body.user.passwordHash).toBeUndefined();
  });

  it("rejects a second registration with the same email", async () => {
    const email = testEmail();
    const payload = { email, password: "correct-horse-battery-staple", name: "Riya" };

    const first = await request(app).post("/auth/register").send(payload);
    expect(first.status).toBe(201);

    const second = await request(app).post("/auth/register").send(payload);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("EMAIL_ALREADY_REGISTERED");
  });

  it("rejects an invalid payload with a validation error", async () => {
    const response = await request(app)
      .post("/auth/register")
      .send({ email: "not-an-email", password: "short", name: "" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("POST /auth/login", () => {
  it("logs in with the correct credentials", async () => {
    const email = testEmail();
    const password = "correct-horse-battery-staple";
    await request(app).post("/auth/register").send({ email, password, name: "Riya" });

    const response = await request(app).post("/auth/login").send({ email, password });

    expect(response.status).toBe(200);
    expect(response.body.token).toEqual(expect.any(String));
    expect(response.body.user.email).toBe(email);
  });

  it("rejects an incorrect password without revealing that the email exists", async () => {
    const email = testEmail();
    await request(app)
      .post("/auth/register")
      .send({ email, password: "correct-horse-battery-staple", name: "Riya" });

    const wrongPassword = await request(app)
      .post("/auth/login")
      .send({ email, password: "totally-wrong" });
    const unknownEmail = await request(app)
      .post("/auth/login")
      .send({ email: testEmail(), password: "anything" });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    // Same code and message for both — a client can't distinguish "wrong
    // password" from "no such account" and enumerate registered emails.
    expect(wrongPassword.body.error.code).toBe("INVALID_CREDENTIALS");
    expect(unknownEmail.body.error.code).toBe("INVALID_CREDENTIALS");
    expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message);
  });
});
