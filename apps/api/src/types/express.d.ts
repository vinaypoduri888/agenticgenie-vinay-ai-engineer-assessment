import type { MembershipRole } from "@prisma/client";

export {};

declare global {
  namespace Express {
    interface Request {
      /** Set by requestId middleware; present on every request. */
      requestId: string;
      /** Set by validateQuery — see that middleware's comment for why this
       * isn't just a re-parsed req.query. */
      validatedQuery?: unknown;
      /**
       * Set by requireAuth once the bearer token's signature, expiry, and
       * subject (an existing user) are all verified. Never derived from a
       * client-supplied body/param/header value.
       */
      user?: {
        id: string;
        email: string;
        name: string;
      };
      /**
       * Set by requireOrganiserMembership / requireOrganiserRole once the
       * authenticated user's membership for the resolved organiserId is
       * confirmed to exist (and, for requireOrganiserRole, to have a
       * sufficient role).
       */
      membership?: {
        organiserId: string;
        role: MembershipRole;
      };
    }
  }
}
