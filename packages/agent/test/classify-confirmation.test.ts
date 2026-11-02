import { describe, expect, it } from "vitest";
import { classifyConfirmationIntent } from "../src/confirmation/classify.js";

describe("classifyConfirmationIntent", () => {
  const confirmCases = ["yes", "Yes", "y", "confirm", "confirmed", "go ahead", "Go ahead.", "do it", "proceed", "yes please", "sure, go ahead"];
  for (const text of confirmCases) {
    it(`treats "${text}" as an unambiguous confirmation`, () => {
      expect(classifyConfirmationIntent(text)).toBe("confirm");
    });
  }

  const denyCases = ["no", "cancel", "Cancel that idea.", "nevermind", "stop"];
  for (const text of denyCases) {
    it(`treats "${text}" as an unambiguous denial`, () => {
      expect(classifyConfirmationIntent(text)).toBe("deny");
    });
  }

  const ambiguousCases = [
    "Maybe later.",
    "What happens if I confirm?",
    "Yes, but for another event.",
    "ok",
    "sounds good",
    "I guess",
    "yes I think so",
  ];
  for (const text of ambiguousCases) {
    it(`treats "${text}" as ambiguous — never executes anything`, () => {
      expect(classifyConfirmationIntent(text)).toBe("ambiguous");
    });
  }
});
