"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "./api";
import { useSession } from "./useSession";

export interface Membership {
  organiserId: string;
  organiserName: string;
  role: "STAFF" | "ADMIN";
}

/** Only decides what navigation to offer. Every permission is still enforced by
 * the API. `null` while loading. */
export function useMemberships(): Membership[] | null {
  const { user } = useSession();
  const [memberships, setMemberships] = useState<Membership[] | null>(null);

  useEffect(() => {
    if (user === undefined) return;
    if (user === null) {
      setMemberships([]);
      return;
    }
    apiFetch<{ items: Membership[] }>("/me/memberships")
      .then((res) => setMemberships(res.items))
      .catch(() => setMemberships([]));
  }, [user]);

  return memberships;
}
