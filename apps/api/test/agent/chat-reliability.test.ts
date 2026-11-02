import { prisma } from "@agenticgenie/db";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { MockProvider } from "@agenticgenie/agent";
import { createApp } from "../../src/app.js";
import { signAccessToken } from "../../src/modules/auth/jwt.js";
import { createTestEvent, createTestOrganiser, createTestUser, createTestVenue, resetFixtures } from "../helpers/fixtures.js";

afterEach(async () => {
  await resetFixtures();
});

function authFor(userId: string) {
  return `Bearer ${signAccessToken(userId)}`;
}

function finalAnswer(answer: string) {
  return JSON.stringify({ answer });
}

describe("POST /agent/chat — provider reliability through the real endpoint", () => {
  it("retries a transient 429 and still succeeds (real HTTP call, no visible failure)", async () => {
    const provider = new MockProvider({
      script: [{ type: "provider_error", category: "rate_limited", retryAfterMs: 1 }, { type: "final", content: finalAnswer("ok now") }],
    });
    const app = createApp({ agentProvider: provider });
    const user = await createTestUser();

    const res = await request(app).post("/agent/chat").set("Authorization", authFor(user.id)).send({ message: "hi" });

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe("success");
    expect(res.body.answer).toBe("ok now");
    expect(provider.calls.length).toBe(2);
  });

  it("never retries quota_exceeded and falls back to a real direct search when the intent matches", async () => {
    const organiser = await createTestOrganiser();
    const venue = await createTestVenue(organiser.id, { city: "Pune" });
    await createTestEvent(organiser.id, venue.id, { status: "PUBLISHED", title: "Fallback Comedy Night" });
    const provider = new MockProvider({ script: [{ type: "provider_error", category: "quota_exceeded" }] });
    const app = createApp({ agentProvider: provider });
    const user = await createTestUser();

    const res = await request(app)
      .post("/agent/chat")
      .set("Authorization", authFor(user.id))
      .send({ message: "show me events in Pune" });

    expect(res.status).toBe(200);
    expect(provider.calls.length).toBe(1); // never retried
    expect(res.body.outcome).toBe("success");
    expect(res.body.degraded).toBe(true);
    expect(res.body.answer).toContain("Fallback Comedy Night");
  });

  it("degrades honestly (never invents an answer) when the provider is down and nothing matches the fallback", async () => {
    const provider = new MockProvider({ script: [{ type: "provider_error", category: "server_error" }] });
    const app = createApp({ agentProvider: provider });
    const user = await createTestUser();

    const res = await request(app)
      .post("/agent/chat")
      .set("Authorization", authFor(user.id))
      .send({ message: "what is the meaning of life?" });

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe("partial");
    expect(res.body.reason).toBe("provider_unavailable_server_error");
    expect(res.body.answer).toContain("Nothing was booked");
    expect(res.body.degraded).toBe(true);
  });

  it("enforces a per-user rate limit on /agent/chat", async () => {
    const provider = new MockProvider({ script: [{ type: "final", content: finalAnswer("ok") }], onExhausted: "repeat-last" });
    const app = createApp({ agentProvider: provider });
    const user = await createTestUser();

    let lastStatus = 200;
    for (let i = 0; i < 25; i++) {
      const res = await request(app).post("/agent/chat").set("Authorization", authFor(user.id)).send({ message: `msg ${i}` });
      lastStatus = res.status;
      if (res.status === 429) break;
    }

    expect(lastStatus).toBe(429);
  });
});

describe("GET /me/conversations/:id — replay context limiting", () => {
  it("caps the replayed history at the most recent messages, not an unbounded history", async () => {
    const user = await createTestUser();
    const conversation = await prisma.agentConversation.create({ data: { userId: user.id } });

    const total = 50;
    await prisma.agentMessage.createMany({
      data: Array.from({ length: total }, (_, i) => ({
        conversationId: conversation.id,
        role: i % 2 === 0 ? ("USER" as const) : ("ASSISTANT" as const),
        content: `message ${i}`,
        createdAt: new Date(Date.now() + i),
      })),
    });

    const { loadReplayMessages } = await import("../../src/modules/agent/conversation.js");
    const replayed = await loadReplayMessages(conversation.id);

    expect(replayed.length).toBeLessThan(total);
    expect(replayed.length).toBeGreaterThan(0);
    // The MOST RECENT messages are kept, not the oldest.
    expect(replayed.at(-1)!.content).toBe(`message ${total - 1}`);
  });
});
