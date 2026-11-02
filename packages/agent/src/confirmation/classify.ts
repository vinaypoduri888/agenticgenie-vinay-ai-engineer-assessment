export type ConfirmationIntent = "confirm" | "deny" | "ambiguous";

// A tight allowlist, not a sentiment classifier. Anything with extra
// qualifying content, a question mark, or a hedge word does NOT match —
// that is the point. A model's own `confirm: true` tool-call argument is
// never sufficient to execute `purchase`/`cancel_order`; this is the other,
// independent, server-verified half of the gate (see docs/PART_B_SECURITY.md).
// A genuine confirmation phrased unusually is safely rejected (the user is
// asked to say it more plainly) rather than risk a false positive.
const CONFIRM_PATTERN =
  /^(yes|y|yes please|yes,? please|confirm|confirmed|go ahead|do it|proceed|yes,? do it|sure,? go ahead|sure|ok,? go ahead|okay,? go ahead)[.!]?$/i;

const DENY_PATTERN =
  /^(no|n|cancel|cancel that|cancel that idea|nevermind|never mind|stop|don'?t|no thanks|no,? thanks)[.!]?$/i;

/**
 * Deterministic, code-based — never an LLM judgment call — classification
 * of whether the CURRENT turn's raw human message is an unambiguous
 * affirmation of a pending action. Trimmed, case-insensitive, one optional
 * trailing `.`/`!` tolerated. Anything that doesn't cleanly match either
 * list (a question, a hedge, an affirmation qualified with "but ...", a
 * reply to something else entirely) is "ambiguous" and must NOT execute
 * anything.
 */
export function classifyConfirmationIntent(rawText: string): ConfirmationIntent {
  const text = rawText.trim();
  if (CONFIRM_PATTERN.test(text)) return "confirm";
  if (DENY_PATTERN.test(text)) return "deny";
  return "ambiguous";
}
