"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { apiFetch, ApiError } from "../../../../../lib/api";
import { PageHeader, Button, Card, Field, TextInput, Select, ErrorBanner, SkeletonCard } from "../../../../../components/ui";

interface Seat {
  id: string;
  label: string;
}
interface Row {
  id: string;
  label: string;
  seats: Seat[];
}
interface Section {
  id: string;
  name: string;
  rows: Row[];
}
interface VenueDetail {
  id: string;
  name: string;
  city: string;
  sections: Section[];
}

export default function OrganiserVenueDetailPage() {
  const { organiserId, venueId } = useParams<{ organiserId: string; venueId: string }>();
  const [venue, setVenue] = useState<VenueDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [sectionName, setSectionName] = useState("");
  const [rowSectionId, setRowSectionId] = useState("");
  const [rowLabel, setRowLabel] = useState("");
  const [seatRowId, setSeatRowId] = useState("");
  const [seatLabel, setSeatLabel] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const detail = await apiFetch<VenueDetail>(`/organisers/${organiserId}/venues/${venueId}`);
      setVenue(detail);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load venue.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organiserId, venueId]);

  // Keep the dropdown selections in sync with real data — without this, the
  // <select>'s displayed value falls back to "the first option" visually
  // while the underlying state (what actually gets submitted) stays empty
  // until the user manually touches the dropdown, silently submitting a
  // blank id otherwise. Caught by browser testing, not a type error, since
  // both sides are plain strings.
  useEffect(() => {
    if (!venue) return;
    const allRows = venue.sections.flatMap((s) => s.rows);
    if (!venue.sections.some((s) => s.id === rowSectionId)) {
      setRowSectionId(venue.sections[0]?.id ?? "");
    }
    if (!allRows.some((r) => r.id === seatRowId)) {
      setSeatRowId(allRows[0]?.id ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venue]);

  async function addSection(e: FormEvent) {
    e.preventDefault();
    setActionError(null);
    try {
      await apiFetch(`/organisers/${organiserId}/venues/${venueId}/sections`, { method: "POST", body: { name: sectionName } });
      setSectionName("");
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not create section.");
    }
  }

  async function addRow(e: FormEvent) {
    e.preventDefault();
    setActionError(null);
    try {
      await apiFetch(`/organisers/${organiserId}/venues/${venueId}/sections/${rowSectionId}/rows`, {
        method: "POST",
        body: { label: rowLabel },
      });
      setRowLabel("");
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not create row.");
    }
  }

  async function addSeat(e: FormEvent) {
    e.preventDefault();
    setActionError(null);
    const section = venue?.sections.find((s) => s.rows.some((r) => r.id === seatRowId));
    if (!section) {
      setActionError("No row selected — create a row first.");
      return;
    }
    // "1-12" adds a whole row in one go; anything else is a single seat label.
    const range = seatLabel.trim().match(/^(\d+)\s*-\s*(\d+)$/);
    const labels = range
      ? Array.from({ length: Math.max(0, Number(range[2]) - Number(range[1]) + 1) }, (_, i) => String(Number(range[1]) + i))
      : [seatLabel.trim()];
    try {
      for (const label of labels) {
        await apiFetch(`/organisers/${organiserId}/venues/${venueId}/sections/${section.id}/rows/${seatRowId}/seats`, {
          method: "POST",
          body: { label },
        });
      }
      setSeatLabel("");
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not create seat.");
    }
  }

  if (loading) return <SkeletonCard />;
  if (error) return <ErrorBanner message={error} />;
  if (!venue) return null;

  const allRows = venue.sections.flatMap((s) => s.rows);

  return (
    <div>
      <PageHeader title={venue.name} description={venue.city} />
      {actionError && <ErrorBanner message={actionError} />}

      {venue.sections.map((section) => (
        <Card key={section.id} style={{ marginBottom: 10 }}>
          <strong>{section.name}</strong>
          {section.rows.map((row) => (
            <div key={row.id} style={{ marginLeft: 12, fontSize: "0.9rem", marginTop: 4 }}>
              Row {row.label}: {row.seats.map((s) => s.label).join(", ") || <span style={{ color: "var(--color-text-faint)" }}>no seats yet</span>}
            </div>
          ))}
        </Card>
      ))}

      <Card style={{ marginBottom: 16, marginTop: 20 }}>
        <h3>Add section</h3>
        <form onSubmit={addSection} style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <TextInput type="text" placeholder="Section name" required value={sectionName} onChange={(e) => setSectionName(e.target.value)} />
          <Button type="submit">Add</Button>
        </form>
      </Card>

      {venue.sections.length > 0 && (
        <Card style={{ marginBottom: 16 }}>
          <h3>Add row</h3>
          <form onSubmit={addRow} style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <Select value={rowSectionId} onChange={(e) => setRowSectionId(e.target.value)} style={{ width: 160 }}>
              {venue.sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            <TextInput type="text" placeholder="Row label" required value={rowLabel} onChange={(e) => setRowLabel(e.target.value)} />
            <Button type="submit">Add</Button>
          </form>
        </Card>
      )}

      {allRows.length > 0 && (
        <Card>
          <h3>Add seat</h3>
          <form onSubmit={addSeat} style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <Select value={seatRowId} onChange={(e) => setSeatRowId(e.target.value)} style={{ width: 200 }}>
              {venue.sections.map((s) =>
                s.rows.map((r) => (
                  <option key={r.id} value={r.id}>
                    {s.name} / Row {r.label}
                  </option>
                )),
              )}
            </Select>
            <TextInput type="text" placeholder="Seat label, or a range like 1-12" required value={seatLabel} onChange={(e) => setSeatLabel(e.target.value)} />
            <Button type="submit">Add</Button>
          </form>
        </Card>
      )}
    </div>
  );
}
