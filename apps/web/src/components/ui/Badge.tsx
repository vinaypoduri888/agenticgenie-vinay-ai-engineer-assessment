import type { ReactNode } from "react";

type Tone = "default" | "success" | "danger" | "warning" | "info";

export function Badge({ tone = "default", children }: { tone?: Tone; children: ReactNode }) {
  const className = tone === "default" ? "badge" : `badge badge-${tone}`;
  return <span className={className}>{children}</span>;
}

/** One place mapping every order, event and ticket status to a colour. */
export function statusTone(status: string): Tone {
  if (["PAID", "ON_SALE", "PUBLISHED", "VALID", "ACTIVE"].includes(status)) return "success";
  if (["PENDING_PAYMENT", "SOLD_OUT", "PARTIALLY_REFUNDED", "DRAFT"].includes(status)) return "warning";
  if (["REFUNDED", "DECLINED", "CANCELLED"].includes(status)) return "danger";
  if (status === "COMPLETED") return "info";
  return "default";
}
