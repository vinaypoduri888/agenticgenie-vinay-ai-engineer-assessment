import { env } from "./env.js";
import { sweepAllExpiredHolds } from "./modules/holds/sweeper.js";
import { reconcileStuckCheckouts } from "./modules/orders/checkout.js";

/**
 * One in-process timer for the two pieces of housekeeping that can't wait for a
 * request: returning expired holds to the catalogue, and settling checkouts
 * nobody came back for. A plain timer is enough because both jobs are safe to
 * run repeatedly and from several processes. Postgres stays the only source of
 * truth, so neither needs a queue.
 */
export function startBackgroundJobs(): () => void {
  if (env.SWEEP_INTERVAL_SECONDS === 0) return () => {};

  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const expired = await sweepAllExpiredHolds();
      const settled = await reconcileStuckCheckouts();
      if (expired > 0 || settled > 0) {
        console.log(JSON.stringify({ type: "housekeeping", expiredHolds: expired, settledCheckouts: settled }));
      }
    } catch (err) {
      console.error(JSON.stringify({ type: "housekeeping_failed", error: err instanceof Error ? err.message : String(err) }));
    } finally {
      running = false;
    }
  }, env.SWEEP_INTERVAL_SECONDS * 1000);
  timer.unref();

  return () => clearInterval(timer);
}
