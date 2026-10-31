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
  },
} as const;
