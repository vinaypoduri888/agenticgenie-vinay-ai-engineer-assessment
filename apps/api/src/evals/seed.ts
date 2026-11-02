import type { Express } from "express";
import {
  createTestEvent,
  createTestMembership,
  createTestOrganiser,
  createTestTicketTier,
  createTestUser,
  createTestVenue,
  purchaseGaTickets,
} from "../../test/helpers/fixtures.js";
import { prisma } from "@agenticgenie/db";
import type { SeedStep } from "./types.js";

/** Resolves a seed step's "+7d" / "-1d" relative date shorthand (or a plain
 * ISO string) against one fixed `now`, so every event in one eval run uses
 * a consistent notion of "the present" regardless of how long the run takes. */
function resolveStartsAt(value: string | undefined, now: Date): Date | undefined {
  if (!value) return undefined;
  const relative = /^([+-])(\d+)d$/.exec(value);
  if (!relative) return new Date(value);
  const sign = relative[1] === "-" ? -1 : 1;
  const days = Number(relative[2]);
  return new Date(now.getTime() + sign * days * 86_400_000);
}

export interface SeedRefs {
  [ref: string]: string;
}

/**
 * Interprets one case's `seed` array into real rows via the exact same
 * `apps/api/test/helpers/fixtures.ts` helpers every other integration test
 * in this project uses (and relies on for cleanup — `resetFixtures()` scopes
 * by the organiser/user ids those helpers track, so eval-created rows get
 * swept up the same way). Returns a ref -> real-id map for substituting
 * `{{ref}}` tokens into the case's mockScript/expectations.
 */
export interface SeedOutcome {
  refs: SeedRefs;
  now: Date;
}

export async function applySeed(app: Express, steps: SeedStep[]): Promise<SeedOutcome> {
  const refs: SeedRefs = {};
  const now = new Date();

  for (const step of steps) {
    switch (step.kind) {
      case "organiser": {
        const organiser = await createTestOrganiser(step.name);
        refs[step.ref] = organiser.id;
        break;
      }
      case "venue": {
        const venue = await createTestVenue(refs[step.organiser]!, { city: step.city });
        refs[step.ref] = venue.id;
        break;
      }
      case "event": {
        const event = await createTestEvent(refs[step.organiser]!, refs[step.venue]!, {
          status: step.status,
          title: step.title,
          category: step.category,
          startsAt: resolveStartsAt(step.startsAt, now),
        });
        refs[step.ref] = event.id;
        break;
      }
      case "ticketTier": {
        const tier = await createTestTicketTier(refs[step.event]!, {
          name: step.name,
          totalQuantity: step.totalQuantity,
          priceMinor: step.priceMinor,
        });
        refs[step.ref] = tier.id;
        break;
      }
      case "user": {
        const user = await createTestUser({ email: step.email });
        refs[step.ref] = user.id;
        break;
      }
      case "membership": {
        await createTestMembership(refs[step.organiser]!, refs[step.user]!, step.role);
        break;
      }
      case "review": {
        const review = await prisma.review.create({
          data: { eventId: refs[step.event]!, userId: refs[step.user]!, rating: step.rating, text: step.text },
        });
        if (step.ref) refs[step.ref] = review.id;
        break;
      }
      case "order": {
        const order = await purchaseGaTickets(app, refs[step.user]!, refs[step.event]!, refs[step.tier]!, step.quantity);
        refs[step.ref] = order.id;
        break;
      }
    }
  }

  return { refs, now };
}

const NOW_TOKEN_PATTERN = /^now([+-]\d+)d$/;

/** Deep-substitutes every `{{token}}` string token: `{{now}}` / `{{now+2d}}`
 * / `{{now-1d}}` resolve against the SAME `now` the seed step's own "+Nd"
 * offsets were resolved against (so a case's mock-scripted date filters
 * line up exactly with its seeded events' dates), and anything else is
 * looked up in the seed ref map. Throws loudly on an unknown token rather
 * than silently leaving the literal `{{...}}` string in place, which would
 * otherwise fail confusingly deep inside a tool call instead of at the
 * point of the actual authoring bug. */
export function substituteRefs<T>(value: T, refs: SeedRefs, now: Date): T {
  if (typeof value === "string") {
    return value.replace(/\{\{([a-zA-Z0-9_+-]+)\}\}/g, (whole, token: string) => {
      if (token === "now") return now.toISOString();
      const relative = NOW_TOKEN_PATTERN.exec(token);
      if (relative) return new Date(now.getTime() + Number(relative[1]) * 86_400_000).toISOString();
      if (!(token in refs)) {
        throw new Error(`Eval case references unknown seed ref "{{${token}}}"`);
      }
      return refs[token]!;
    }) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => substituteRefs(item, refs, now)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = substituteRefs(val, refs, now);
    }
    return result as T;
  }
  return value;
}
