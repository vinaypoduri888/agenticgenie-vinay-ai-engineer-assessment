"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch, ApiError } from "../../../../lib/api";
import { Button, Card, Field, PageHeader, TextInput, ErrorBanner, SkeletonCard } from "../../../../components/ui";

interface Venue {
  id: string;
  name: string;
  city: string;
  address: string;
}

export default function OrganiserVenuesPage() {
  const { organiserId } = useParams<{ organiserId: string }>();
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<{ items: Venue[] }>(`/organisers/${organiserId}/venues`);
      setVenues(result.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load venues.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organiserId]);

  async function createVenue(e: FormEvent) {
    e.preventDefault();
    setCreateError(null);
    try {
      await apiFetch(`/organisers/${organiserId}/venues`, { method: "POST", body: { name, city, address } });
      setName("");
      setCity("");
      setAddress("");
      await load();
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "Could not create venue.");
    }
  }

  if (loading) return <SkeletonCard />;
  if (error) return <ErrorBanner message={error} />;

  return (
    <div>
      <PageHeader title="Venues" description="A venue holds the seat map your events sell from." />
      <Card style={{ marginBottom: 24 }}>
        <h3>Create venue</h3>
        <form onSubmit={createVenue}>
          <Field label="Name" htmlFor="venue-name"><TextInput id="venue-name" type="text" required value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="City" htmlFor="venue-city"><TextInput id="venue-city" type="text" required value={city} onChange={(e) => setCity(e.target.value)} /></Field>
          <Field label="Address" htmlFor="venue-address"><TextInput id="venue-address" type="text" required value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
          {createError && <ErrorBanner message={createError} />}
          <Button type="submit">Create venue</Button>
        </form>
      </Card>

      {venues.map((v) => (
        <Link key={v.id} href={`/organiser/${organiserId}/venues/${v.id}`} style={{ textDecoration: "none", color: "inherit", display: "block" }}>
          <Card interactive style={{ marginBottom: 10 }}>
            <strong>{v.name}</strong> — {v.city}
            <div style={{ color: "var(--color-text-muted)", fontSize: "0.88rem" }}>{v.address}</div>
          </Card>
        </Link>
      ))}
    </div>
  );
}
