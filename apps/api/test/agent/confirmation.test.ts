import { prisma } from "@agenticgenie/db";
import { afterEach, describe, expect, it } from "vitest";
import { evaluateConfirmation } from "../../src/modules/agent/confirmation.js";
import { createTestUser, resetFixtures } from "../helpers/fixtures.js";

afterEach(async () => {
  await resetFixtures();
});

// Cascades away automatically when resetFixtures() deletes the tracked
// user (AgentConversation -> User is onDelete: Cascade, and
// AgentPendingConfirmation -> AgentConversation is too) — no separate
// cleanup needed.
async function createTestConversation(userId: string) {
  const conversation = await prisma.agentConversation.create({ data: { userId } });
  return conversation.id;
}

describe("evaluateConfirmation — the confirmation state machine", () => {
  it("asks for confirmation (does not execute) on the first call", async () => {
    const user = await createTestUser();
    const conversationId = await createTestConversation(user.id);

    const gate = await evaluateConfirmation({
      conversationId,
      userId: user.id,
      toolName: "purchase",
      targetType: "Hold",
      targetId: "hold_1",
      args: { hold_id: "hold_1", confirm: false },
      latestUserMessage: "I'd like to buy this",
    });

    expect(gate.kind).toBe("needs_confirmation");
    const row = await prisma.agentPendingConfirmation.findFirst({ where: { conversationId } });
    expect(row?.status).toBe("PENDING");
  });

  it("executes exactly once after an explicit, unambiguous confirmation", async () => {
    const user = await createTestUser();
    const conversationId = await createTestConversation(user.id);
    const args = { hold_id: "hold_1", confirm: true };

    await evaluateConfirmation({
      conversationId,
      userId: user.id,
      toolName: "purchase",
      targetType: "Hold",
      targetId: "hold_1",
      args,
      latestUserMessage: "I'd like to buy this",
    });

    const gate = await evaluateConfirmation({
      conversationId,
      userId: user.id,
      toolName: "purchase",
      targetType: "Hold",
      targetId: "hold_1",
      args,
      latestUserMessage: "yes",
    });

    expect(gate.kind).toBe("confirmed");
    const row = await prisma.agentPendingConfirmation.findFirst({ where: { conversationId } });
    expect(row?.status).toBe("CONSUMED");
  });

  const ambiguousPhrases = ["Maybe later.", "What happens if I confirm?", "Yes, but for another event.", "Cancel that idea."];
  for (const phrase of ambiguousPhrases) {
    it(`does not execute on "${phrase}"`, async () => {
      const user = await createTestUser();
      const conversationId = await createTestConversation(user.id);
      const args = { hold_id: "hold_1", confirm: true };

      await evaluateConfirmation({
        conversationId,
        userId: user.id,
        toolName: "purchase",
        targetType: "Hold",
        targetId: "hold_1",
        args,
        latestUserMessage: "I'd like to buy this",
      });

      const gate = await evaluateConfirmation({
        conversationId,
        userId: user.id,
        toolName: "purchase",
        targetType: "Hold",
        targetId: "hold_1",
        args,
        latestUserMessage: phrase,
      });

      expect(gate.kind).toBe("needs_confirmation");
      const rows = await prisma.agentPendingConfirmation.findMany({ where: { conversationId } });
      expect(rows.every((r) => r.status !== "CONSUMED")).toBe(true);
    });
  }

  it("does not execute once the pending confirmation has expired", async () => {
    const user = await createTestUser();
    const conversationId = await createTestConversation(user.id);
    const args = { hold_id: "hold_1", confirm: true };

    const first = await evaluateConfirmation({
      conversationId,
      userId: user.id,
      toolName: "purchase",
      targetType: "Hold",
      targetId: "hold_1",
      args,
      latestUserMessage: "I'd like to buy this",
    });
    expect(first.kind).toBe("needs_confirmation");

    // Force it into the past instead of waiting out a real 5-minute TTL.
    await prisma.agentPendingConfirmation.updateMany({
      where: { conversationId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const gate = await evaluateConfirmation({
      conversationId,
      userId: user.id,
      toolName: "purchase",
      targetType: "Hold",
      targetId: "hold_1",
      args,
      latestUserMessage: "yes",
    });

    expect(gate.kind).toBe("needs_confirmation"); // a fresh ask, not an execution
    const rows = await prisma.agentPendingConfirmation.findMany({ where: { conversationId } });
    expect(rows.some((r) => r.status === "EXPIRED")).toBe(true);
    expect(rows.every((r) => r.status !== "CONSUMED")).toBe(true);
  });

  it("a confirmation for one order cannot be reused to confirm a different order", async () => {
    const user = await createTestUser();
    const conversationId = await createTestConversation(user.id);

    await evaluateConfirmation({
      conversationId,
      userId: user.id,
      toolName: "cancel_order",
      targetType: "Order",
      targetId: "order_A",
      args: { order_id: "order_A", confirm: true },
      latestUserMessage: "cancel order A",
    });

    // Same conversation, same user, a "yes" — but for a DIFFERENT order.
    const gate = await evaluateConfirmation({
      conversationId,
      userId: user.id,
      toolName: "cancel_order",
      targetType: "Order",
      targetId: "order_B",
      args: { order_id: "order_B", confirm: true },
      latestUserMessage: "yes",
    });

    expect(gate.kind).toBe("needs_confirmation");
    const rows = await prisma.agentPendingConfirmation.findMany({ where: { conversationId } });
    expect(rows.every((r) => r.status !== "CONSUMED")).toBe(true);
  });

  it("two genuinely concurrent confirmations resolve to the SAME idempotency key (so the underlying service collapses them into one effect)", async () => {
    const user = await createTestUser();
    const conversationId = await createTestConversation(user.id);
    const args = { hold_id: "hold_1", confirm: true };

    await evaluateConfirmation({
      conversationId,
      userId: user.id,
      toolName: "purchase",
      targetType: "Hold",
      targetId: "hold_1",
      args,
      latestUserMessage: "I'd like to buy this",
    });

    const [a, b] = await Promise.all([
      evaluateConfirmation({
        conversationId,
        userId: user.id,
        toolName: "purchase",
        targetType: "Hold",
        targetId: "hold_1",
        args,
        latestUserMessage: "yes",
      }),
      evaluateConfirmation({
        conversationId,
        userId: user.id,
        toolName: "purchase",
        targetType: "Hold",
        targetId: "hold_1",
        args,
        latestUserMessage: "yes",
      }),
    ]);

    // The real DB-level race can resolve either way — both reads can land
    // before either write (both "confirmed"), or one caller's write can
    // land before the other's read (that caller then sees no live PENDING
    // row and gets a fresh "needs_confirmation" instead). What must NEVER
    // happen is two DIFFERENT idempotency keys both coming back
    // "confirmed" — that would let two independent executions proceed,
    // which is the actual double-charge/double-refund risk this test
    // exists to rule out.
    const confirmed = [a, b].filter((g): g is Extract<typeof a, { kind: "confirmed" }> => g.kind === "confirmed");
    expect(confirmed.length).toBeGreaterThanOrEqual(1);
    const distinctKeys = new Set(confirmed.map((g) => g.idempotencyKey));
    expect(distinctKeys.size).toBe(1);
  });
});
