"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch, ApiError } from "../../../../lib/api";
import { buttonStyle, cardStyle, errorStyle, inputStyle } from "../../../../lib/styles";

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

  if (loading) return <p>Loading…</p>;
  if (error) return <p style={errorStyle}>{error}</p>;

  return (
    <div>
      <h1>Venues</h1>
      <form onSubmit={createVenue} style={cardStyle}>
        <h3>Create venue</h3>
        <input type="text" placeholder="Name" required value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
        <input type="text" placeholder="City" required value={city} onChange={(e) => setCity(e.target.value)} style={inputStyle} />
        <input type="text" placeholder="Address" required value={address} onChange={(e) => setAddress(e.target.value)} style={inputStyle} />
        {createError && <p style={errorStyle}>{createError}</p>}
        <button type="submit" style={buttonStyle}>
          Create venue
        </button>
      </form>

      {venues.map((v) => (
        <Link key={v.id} href={`/organiser/${organiserId}/venues/${v.id}`} style={{ textDecoration: "none", color: "inherit" }}>
          <div style={cardStyle}>
            <strong>{v.name}</strong> — {v.city}
            <div>{v.address}</div>
          </div>
        </Link>
      ))}
    </div>
  );
}
