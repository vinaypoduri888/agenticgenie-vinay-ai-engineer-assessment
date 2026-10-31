import { describe, expect, it } from "vitest";
import { canRefundOrder } from "../../src/modules/auth/policies.js";

describe("canRefundOrder", () => {
  it("forbids staff from refunding their own order", () => {
    expect(canRefundOrder({ actorRole: "STAFF", isOwnOrder: true })).toBe(false);
  });

  it("allows staff to refund another attendee's order", () => {
    expect(canRefundOrder({ actorRole: "STAFF", isOwnOrder: false })).toBe(true);
  });

  it("allows admin to refund their own order (the documented exception)", () => {
    expect(canRefundOrder({ actorRole: "ADMIN", isOwnOrder: true })).toBe(true);
  });

  it("allows admin to refund another attendee's order", () => {
    expect(canRefundOrder({ actorRole: "ADMIN", isOwnOrder: false })).toBe(true);
  });
});
