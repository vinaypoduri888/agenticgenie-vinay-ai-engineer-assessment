/** The authenticated actor + resolved organiser scope + request id that
 * every organiser-scoped mutation needs for its audit log entry. Shared
 * across modules rather than redeclared per-module. */
export interface ActionContext {
  actorUserId: string;
  organiserId: string;
  requestId: string;
}
