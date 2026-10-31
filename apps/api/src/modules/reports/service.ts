import { prisma } from "@agenticgenie/db";
import type { SalesReportQuery } from "./schemas.js";

interface RawRow {
  key: string | Date | null;
  label: string | null;
  revenue_minor: bigint | null;
  ticket_count: bigint;
}

/**
 * Net revenue only (VALID tickets — refunded tickets are excluded, so a
 * refund automatically reduces reported sales without a separate
 * subtraction step). Scoped by organiserId; from/to default to an
 * effectively unbounded range when omitted, kept as real Date bounds
 * (rather than building conditional raw SQL fragments) to keep the query
 * static and simple.
 */
export async function getSalesSummary(organiserId: string, query: SalesReportQuery) {
  const from = query.from ? new Date(query.from) : new Date(0);
  const to = query.to ? new Date(query.to) : new Date("9999-12-31T00:00:00.000Z");

  let rows: RawRow[];

  if (query.group_by === "event") {
    rows = await prisma.$queryRaw<RawRow[]>`
      SELECT t.event_id AS key, e.title AS label,
             SUM(t.price_minor) AS revenue_minor, COUNT(*) AS ticket_count
      FROM tickets t
      JOIN orders o ON o.id = t.order_id
      JOIN events e ON e.id = t.event_id
      WHERE e.organiser_id = ${organiserId}
        AND t.status = 'VALID'
        AND o.created_at >= ${from} AND o.created_at <= ${to}
      GROUP BY t.event_id, e.title
      ORDER BY t.event_id
    `;
  } else if (query.group_by === "tier") {
    rows = await prisma.$queryRaw<RawRow[]>`
      SELECT t.ticket_tier_id AS key, tt.name AS label,
             SUM(t.price_minor) AS revenue_minor, COUNT(*) AS ticket_count
      FROM tickets t
      JOIN orders o ON o.id = t.order_id
      JOIN events e ON e.id = t.event_id
      LEFT JOIN ticket_tiers tt ON tt.id = t.ticket_tier_id
      WHERE e.organiser_id = ${organiserId}
        AND t.status = 'VALID'
        AND o.created_at >= ${from} AND o.created_at <= ${to}
      GROUP BY t.ticket_tier_id, tt.name
      ORDER BY t.ticket_tier_id
    `;
  } else {
    rows = await prisma.$queryRaw<RawRow[]>`
      SELECT DATE(o.created_at) AS key, NULL AS label,
             SUM(t.price_minor) AS revenue_minor, COUNT(*) AS ticket_count
      FROM tickets t
      JOIN orders o ON o.id = t.order_id
      JOIN events e ON e.id = t.event_id
      WHERE e.organiser_id = ${organiserId}
        AND t.status = 'VALID'
        AND o.created_at >= ${from} AND o.created_at <= ${to}
      GROUP BY DATE(o.created_at)
      ORDER BY key
    `;
  }

  const groups = rows.map((row) => ({
    key: row.key instanceof Date ? row.key.toISOString().slice(0, 10) : row.key,
    label: row.label,
    revenueMinor: Number(row.revenue_minor ?? 0),
    ticketCount: Number(row.ticket_count),
  }));

  return {
    groupBy: query.group_by,
    from: from.toISOString(),
    to: to.toISOString(),
    totalRevenueMinor: groups.reduce((sum, g) => sum + g.revenueMinor, 0),
    totalTicketCount: groups.reduce((sum, g) => sum + g.ticketCount, 0),
    groups,
  };
}
