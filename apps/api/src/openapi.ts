/**
 * Hand-written OpenAPI skeleton. Part A endpoints are added here as they're
 * implemented in later stages — kept as a plain literal (no codegen) so it's
 * easy to read and diff in review.
 */
export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "Agentic Genie Ticketing API",
    version: "0.1.0",
    description:
      "Multi-organiser event ticketing API. Endpoints beyond /health are added incrementally as Part A is implemented.",
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
  },
} as const;
