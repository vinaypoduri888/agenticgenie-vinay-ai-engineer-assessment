/**
 * Thrown by route handlers / middleware to produce the PDF's documented
 * error envelope: {"error": {"code", "message", "request_id"}}. Express 5
 * forwards both sync throws and rejected async-handler promises to
 * errorHandler automatically — no try/catch wrapping needed at call sites.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
