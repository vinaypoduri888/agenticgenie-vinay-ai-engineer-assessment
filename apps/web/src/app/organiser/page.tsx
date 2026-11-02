"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "../../lib/useSession";
import { useMemberships } from "../../lib/useMemberships";
import { Badge, Card, EmptyState, Icon, PageHeader, SkeletonCard } from "../../components/ui";

export default function OrganiserIndexPage() {
  const { user } = useSession();
  const memberships = useMemberships();
  const router = useRouter();

  useEffect(() => {
    if (user === null) window.location.href = "/login?next=/organiser";
  }, [user]);

  // With one organiser there is nothing to choose.
  useEffect(() => {
    if (memberships?.length === 1) router.replace(`/organiser/${memberships[0]!.organiserId}`);
  }, [memberships, router]);

  if (memberships === null || memberships.length === 1) return <SkeletonCard />;

  return (
    <div style={{ maxWidth: 640 }}>
      <PageHeader title="Your organisers" description="Choose an organiser to manage." />
      {memberships.length === 0 && <EmptyState title="No organiser access" description="You aren't a member of an organiser yet. Ask an admin to add your email to their team." />}
      {memberships.map((membership) => (
        <Link key={membership.organiserId} href={`/organiser/${membership.organiserId}`} style={{ textDecoration: "none", color: "inherit", display: "block", marginBottom: 12 }}>
          <Card interactive>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <strong style={{ flex: 1 }}>{membership.organiserName}</strong>
              <Badge tone={membership.role === "ADMIN" ? "info" : "default"}>{membership.role === "ADMIN" ? "Admin" : "Staff"}</Badge>
              <Icon name="arrow" />
            </div>
          </Card>
        </Link>
      ))}
    </div>
  );
}
