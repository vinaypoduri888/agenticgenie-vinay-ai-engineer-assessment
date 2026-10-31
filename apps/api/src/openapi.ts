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
  },
} as const;
