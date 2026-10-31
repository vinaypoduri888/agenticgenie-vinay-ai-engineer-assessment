"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { apiFetch, ApiError, setSession } from "../../lib/api";
import { buttonStyle, inputStyle } from "../../lib/styles";

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await apiFetch<{ token: string; user: { id: string; email: string; name: string } }>(
        "/auth/register",
        { method: "POST", body: { name, email, password } },
      );
      setSession(result.token, result.user);
      window.location.href = "/events";
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Registration failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 360 }}>
      <h1>Create an account</h1>
      <form onSubmit={handleSubmit}>
        <label style={{ display: "block", marginBottom: 12 }}>
          Name
          <input type="text" required value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ display: "block", marginBottom: 12 }}>
          Email
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ display: "block", marginBottom: 12 }}>
          Password (min 8 characters)
          <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} />
        </label>
        {error && <p style={{ color: "#b00020" }}>{error}</p>}
        <button type="submit" disabled={loading} style={buttonStyle}>
          {loading ? "Creating account…" : "Register"}
        </button>
      </form>
      <p style={{ marginTop: 16 }}>
        Already have an account? <Link href="/login">Log in</Link>
      </p>
    </div>
  );
}
