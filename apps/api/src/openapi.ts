/**
 * Hand-written OpenAPI document, kept as a plain literal (no codegen) so it's
 * easy to read and diff in review. Summary-level below the auth routes; the
 * behaviour of each route is pinned down by its test suite.
 */
function summarisedPaths(paths: Record<string, Record<string, string>>) {
  return Object.fromEntries(
    Object.entries(paths).map(([path, operations]) => [
      path,
      Object.fromEntries(
        Object.entries(operations).map(([method, summary]) => [
          method,
          {
            summary,
            parameters: [...path.matchAll(/\{(\w+)\}/g)].map((match) => ({
              name: match[1],
              in: "path",
              required: true,
              schema: { type: "string" },
            })),
            responses: { default: { description: "See summary" } },
          },
        ]),
      ),
    ]),
  );
}

export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "Agentic Genie Ticketing API",
    version: "1.0.0",
    description:
      "Multi-organiser event ticketing API and AI assistant. Errors are {error: {code, message, request_id}}. Out-of-scope ids return 404, never 403. Bearer token from POST /auth/login.",
  },
  servers: [{ url: "http://localhost:4000" }],
  paths: {
    "/health": {
      get: {
        summary: "Liveness and DB-connectivity check",
        responses: {
          "200": {
            description: "Service and database are healthy",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", enum: ["ok"] },
                    service: { type: "string" },
                    timestamp: { type: "string", format: "date-time" },
                  },
                  required: ["status", "service", "timestamp"],
                },
              },
            },
          },
          "503": {
            description: "Database unavailable",
          },
        },
      },
    },
    "/auth/register": {
      post: {
        summary: "Create an attendee account",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  email: { type: "string", format: "email" },
                  password: { type: "string", minLength: 8, maxLength: 72 },
                  name: { type: "string", minLength: 1, maxLength: 200 },
                },
                required: ["email", "password", "name"],
              },
            },
          },
        },
        responses: {
          "201": { description: "Account created; returns { token, user }" },
          "409": { description: "Email already registered" },
          "400": { description: "Validation error" },
        },
      },
    },
    "/auth/login": {
      post: {
        summary: "Log in with email and password",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  email: { type: "string", format: "email" },
                  password: { type: "string" },
                },
                required: ["email", "password"],
              },
            },
          },
        },
        responses: {
          "200": { description: "Returns { token, user }" },
          "401": { description: "Incorrect email or password" },
          "400": { description: "Validation error" },
        },
      },
    },
    "/events": {
      get: {
        summary: "Public event catalogue — city/date-range/category/text filters, (createdAt,id) keyset pagination",
        parameters: [
          { name: "city", in: "query", schema: { type: "string" } },
          { name: "from", in: "query", schema: { type: "string", format: "date-time" } },
          { name: "to", in: "query", schema: { type: "string", format: "date-time" } },
          { name: "category", in: "query", schema: { type: "string" } },
          { name: "q", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 50 } },
          { name: "cursor", in: "query", schema: { type: "string" } },
        ],
        responses: { "200": { description: "{ items, next_cursor }" } },
      },
    },
    "/events/{eventId}": {
      get: {
        summary: "Public event detail (not DRAFT) with venue, ticket tiers, and seat availability summary",
        responses: { "200": { description: "Event detail" }, "404": { description: "Not found" } },
      },
    },
    "/organisers/{organiserId}/venues": {
      get: { summary: "List the organiser's venues (any member)", responses: { "200": { description: "{ items }" } } },
      post: { summary: "Create a venue (admin only)", responses: { "201": { description: "Created" } } },
    },
    "/organisers/{organiserId}/venues/{venueId}": {
      get: { summary: "Venue detail with full seat map (any member)", responses: { "200": { description: "Venue" } } },
      patch: { summary: "Update venue details (admin only)", responses: { "200": { description: "Updated" } } },
    },
    "/organisers/{organiserId}/venues/{venueId}/sections": {
      post: { summary: "Create a section (admin only)", responses: { "201": { description: "Created" }, "409": { description: "Duplicate name" } } },
    },
    "/organisers/{organiserId}/venues/{venueId}/sections/{sectionId}/rows": {
      post: { summary: "Create a row within a section (admin only)", responses: { "201": { description: "Created" } } },
    },
    "/organisers/{organiserId}/venues/{venueId}/sections/{sectionId}/rows/{rowId}/seats": {
      post: { summary: "Create a seat within a row (admin only)", responses: { "201": { description: "Created" } } },
    },
    "/organisers/{organiserId}/events": {
      post: { summary: "Create an event as DRAFT (admin only)", responses: { "201": { description: "Created" } } },
    },
    "/organisers/{organiserId}/events/{eventId}": {
      get: { summary: "Event detail for organiser members, any status", responses: { "200": { description: "Event" } } },
      patch: { summary: "Update event info — only while DRAFT/PUBLISHED (admin only)", responses: { "200": { description: "Updated" } } },
    },
    "/organisers/{organiserId}/events/{eventId}/publish": {
      post: {
        summary: "DRAFT -> PUBLISHED, after validating at least one ticket tier or generated seat exists (admin only)",
        responses: { "200": { description: "Published" }, "409": { description: "Invalid transition" }, "422": { description: "No inventory configured" } },
      },
    },
    "/organisers/{organiserId}/events/{eventId}/ticket-tiers": {
      post: { summary: "Create a GA ticket tier (admin only)", responses: { "201": { description: "Created" } } },
    },
    "/organisers/{organiserId}/events/{eventId}/seats/generate": {
      post: {
        summary: "One-time bulk-generate EventSeat rows from priced venue sections (admin only)",
        responses: { "201": { description: "{ seatsCreated }" }, "409": { description: "Already generated" } },
      },
    },
    ...summarisedPaths({
      "/holds": {
        get: "The caller's live holds; filter with event_id",
        post: "Hold seats or GA tickets. Body {event_id, seat_ids[] | tier_id+qty} (camelCase also accepted). 201 {hold_id, expires_at} | 409. Idempotency-Key optional",
      },
      "/holds/{id}": { delete: "Release a hold. 409 CHECKOUT_IN_PROGRESS while a charge is in flight" },
      "/orders": {
        post: "Convert a hold into an order. Idempotency-Key required; X-Payment-Scenario optional. 201 paid | 202 outcome unknown, retry with the same key | 402 declined | 409 expired or in progress | 422 key reused",
      },
      "/orders/{id}/refund": { post: "Refund all or some tickets. Idempotency-Key required. 200 | 403 | 404 | 409 | 422" },
      "/me/orders": { get: "The caller's own orders; cursor paginated" },
      "/me/memberships": { get: "Organisers the caller belongs to" },
      "/me/conversations": { get: "The caller's assistant conversations" },
      "/me/conversations/{id}": { get: "One conversation, with display messages and any live confirmation" },
      "/agent/chat": { post: "One assistant turn. {conversationId?, message} returns answer, citations, confirmation state and tool activity" },
      "/tickets/{code}/checkin": { post: "Check a ticket in, once. 200 | 409 already checked in | 404" },
      "/events/{eventId}/seats": { get: "Seats for an event. Each id is what POST /holds takes" },
      "/events/{eventId}/reviews": { get: "Reviews, public; cursor paginated", post: "Review an event you attended, once it has completed" },
      "/events/{eventId}/cancel": { post: "Cancel an event and refund paid orders exactly once (organiser admin). Same as the nested route" },
      "/audit": { get: "Audit entries scoped by role. entity=Type:id for members; the unfiltered feed is admin-only; organiser_id narrows it" },
      "/organisers/{organiserId}/events/{eventId}/on-sale": { post: "Put an event on sale (admin)" },
      "/organisers/{organiserId}/events/{eventId}/complete": { post: "Mark an event completed (admin)" },
      "/organisers/{organiserId}/events/{eventId}/cancel": { post: "Cancel an event and refund paid orders exactly once (admin)" },
      "/organisers/{organiserId}/orders": { get: "This organiser's orders, newest first; event_id and q filters (members)" },
      "/organisers/{organiserId}/reports/sales": { get: "Net sales aggregated with group_by=event|day|tier, from and to (members)" },
      "/organisers/{organiserId}/audit": { get: "This organiser's audit trail. entity=Type:id for members; the whole feed is admin-only" },
      "/organisers/{organiserId}/members": { get: "List members (admin)", post: "Add a member by email (admin)" },
      "/organisers/{organiserId}/members/{userId}": { patch: "Change a member's role (admin)", delete: "Remove a member (admin). 409 if they're the last admin" },
    }),
  },
} as const;
