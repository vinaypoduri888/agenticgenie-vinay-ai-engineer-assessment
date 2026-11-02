"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { apiFetch, errorMessage, formatDateTime } from "../../../../lib/api";
import { Button, EmptyState, ErrorBanner, PageHeader, SkeletonCard, TextInput } from "../../../../components/ui";

interface AuditEntry {
  id: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  requestId: string;
  beforeData: unknown;
  afterData: unknown;
  createdAt: string;
}
interface AuditPage {
  items: AuditEntry[];
  next_cursor: string | null;
}

function actionLabel(action: string): string {
  const lower = action.replace(/_/g, " ").toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function AuditInner() {
  const { organiserId } = useParams<{ organiserId: string }>();
  const searchParams = useSearchParams();
  const [entityFilter, setEntityFilter] = useState(searchParams.get("entity") ?? "");
  const [applied, setApplied] = useState(searchParams.get("entity") ?? "");
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(cursor?: string) {
    setError(null);
    try {
      const query = new URLSearchParams({ limit: "25" });
      if (applied) query.set("entity", applied);
      if (cursor) query.set("cursor", cursor);
      const page = await apiFetch<AuditPage>(`/organisers/${organiserId}/audit?${query}`);
      setEntries((previous) => (cursor ? [...(previous ?? []), ...page.items] : page.items));
      setNextCursor(page.next_cursor);
    } catch (err) {
      setEntries([]);
      setError(errorMessage(err, "Could not load the audit log."));
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organiserId, applied]);

  function onFilter(e: FormEvent) {
    e.preventDefault();
    setApplied(entityFilter.trim());
  }

  return (
    <div>
      <PageHeader title="Audit log" description="Append-only: who did what, when, and the request behind it. The whole feed is for admins; staff can look up a specific record." />

      <form onSubmit={onFilter} className="toolbar">
        <TextInput className="grow" type="search" placeholder="Filter by record, e.g. Order:abc123 or Event:abc123" aria-label="Filter by record" value={entityFilter} onChange={(e) => setEntityFilter(e.target.value)} />
        <Button type="submit" variant="secondary">
          Filter
        </Button>
      </form>

      {error && <ErrorBanner message={error} />}
      {entries === null && !error && <SkeletonCard />}
      {entries?.length === 0 && !error && <EmptyState title="No entries found" />}

      {entries && entries.length > 0 && (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>Record</th>
                <th>Actor</th>
                <th>Request</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td style={{ whiteSpace: "nowrap" }} className="small">
                    {formatDateTime(entry.createdAt)}
                  </td>
                  <td>
                    {actionLabel(entry.action)}
                    {(entry.beforeData != null || entry.afterData != null) && (
                      <details className="json-diff">
                        <summary>Before and after</summary>
                        <pre>{JSON.stringify({ before: entry.beforeData, after: entry.afterData }, null, 2)}</pre>
                      </details>
                    )}
                  </td>
                  <td className="small">
                    {entry.entityType}
                    <div className="faint">
                      <code>{entry.entityId.slice(0, 12)}…</code>
                    </div>
                  </td>
                  <td className="small">{entry.actorUserId ? <code>{entry.actorUserId.slice(0, 10)}…</code> : "System"}</td>
                  <td className="small faint">
                    <code>{entry.requestId.slice(0, 13)}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {nextCursor && (
        <div style={{ marginTop: 16, textAlign: "center" }}>
          <Button variant="secondary" onClick={() => load(nextCursor)}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}

export default function OrganiserAuditPage() {
  return (
    <Suspense fallback={<SkeletonCard />}>
      <AuditInner />
    </Suspense>
  );
}
