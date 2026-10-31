"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { apiFetch, ApiError, setSession } from "../../lib/api";
import { buttonStyle, inputStyle } from "../../lib/styles";

export default function LoginPage() {
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
        "/auth/login",
        { method: "POST", body: { email, password } },
      );
      setSession(result.token, result.user);
      window.location.href = "/events";
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 360 }}>
      <h1>Log in</h1>
      <form onSubmit={handleSubmit}>
        <label style={{ display: "block", marginBottom: 12 }}>
          Email
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ display: "block", marginBottom: 12 }}>
          Password
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} />
        </label>
        {error && <p style={{ color: "#b00020" }}>{error}</p>}
        <button type="submit" disabled={loading} style={buttonStyle}>
          {loading ? "Logging in…" : "Log in"}
        </button>
      </form>
      <p style={{ marginTop: 16 }}>
        No account? <Link href="/register">Register</Link>
      </p>
      <p style={{ marginTop: 24, fontSize: 13, color: "#666" }}>
        Seeded demo logins: <code>admin1@seed.test</code>, <code>staff1@seed.test</code>,{" "}
        <code>attendee1@seed.test</code> … — password <code>Seed@12345</code> for all of them.
      </p>
    </div>
  );
}
