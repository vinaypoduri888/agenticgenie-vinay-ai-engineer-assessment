"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useMemberships } from "../../../lib/useMemberships";
import { Badge, Icon, type IconName } from "../../../components/ui";

const NAV: { path: string; label: string; icon: IconName; adminOnly?: boolean }[] = [
  { path: "", label: "Overview", icon: "home" },
  { path: "events", label: "Events", icon: "calendar" },
  { path: "orders", label: "Orders & refunds", icon: "list" },
  { path: "checkin", label: "Check-in", icon: "scan" },
  { path: "reports", label: "Sales", icon: "chart" },
  { path: "venues", label: "Venues", icon: "building" },
  { path: "team", label: "Team", icon: "users", adminOnly: true },
  { path: "audit", label: "Audit log", icon: "history" },
];

/** The sidebar only decides what to offer. Each page's API call is what's
 * actually permission-checked, so a staff member forcing a URL gets the server's
 * refusal, not a hidden button. */
export default function OrganiserLayout({ children }: { children: ReactNode }) {
  const { organiserId } = useParams<{ organiserId: string }>();
  const pathname = usePathname();
  const memberships = useMemberships();
  const membership = memberships?.find((m) => m.organiserId === organiserId);
  const base = `/organiser/${organiserId}`;

  return (
    <div className="org-shell">
      <aside className="org-sidebar">
        <div className="org-identity">
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong>{membership?.organiserName ?? "Organiser"}</strong>
            {memberships && memberships.length > 1 && (
              <small>
                <Link href="/organiser">Switch organiser</Link>
              </small>
            )}
          </div>
          {membership && <Badge tone={membership.role === "ADMIN" ? "info" : "default"}>{membership.role === "ADMIN" ? "Admin" : "Staff"}</Badge>}
        </div>
        <nav className="org-nav" aria-label="Organiser">
          {NAV.filter((item) => !item.adminOnly || membership?.role === "ADMIN").map((item) => {
            const href = item.path ? `${base}/${item.path}` : base;
            const active = item.path ? pathname.startsWith(href) : pathname === base;
            return (
              <Link key={item.label} href={href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>
                <Icon name={item.icon} size={16} />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}
