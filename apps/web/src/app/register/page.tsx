"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { apiFetch, ApiError, setSession } from "../../lib/api";
import { Button, Card, Field, TextInput, ErrorBanner } from "../../components/ui";

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
    <div className="auth-page">
      <h1>Create your account</h1>
      <p className="page-description">Book tickets, keep them in one place, and chat with the assistant.</p>
      <Card>
        <form onSubmit={handleSubmit}>
          <Field label="Name" htmlFor="register-name">
            <TextInput id="register-name" type="text" required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </Field>
          <Field label="Email" htmlFor="register-email">
            <TextInput id="register-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </Field>
          <Field label="Password (min 8 characters)" htmlFor="register-password">
            <TextInput id="register-password" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </Field>
          {error && <ErrorBanner message={error} />}
          <Button type="submit" disabled={loading} block>
            {loading ? "Creating account…" : "Register"}
          </Button>
        </form>
      </Card>
      <p style={{ marginTop: 16, textAlign: "center" }}>
        Already have an account? <Link href="/login" style={{ color: "var(--color-accent-strong)" }}>Log in</Link>
      </p>
    </div>
  );
}
