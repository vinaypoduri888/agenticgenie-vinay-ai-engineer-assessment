"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { apiFetch, errorMessage, setSession } from "../../lib/api";
import { Button, Card, Chip, ErrorBanner, Field, TextInput } from "../../components/ui";

const DEMO_PASSWORD = "Seed@12345";
const DEMO_LOGINS = [
  { label: "Attendee", email: "attendee1@seed.test" },
  { label: "Organiser admin", email: "admin1@seed.test" },
  { label: "Organiser staff", email: "staff1@seed.test" },
];

/** Only same-site paths, so a crafted link can't bounce a login to another site. */
function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : "/events";
}

function LoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await apiFetch<{ token: string; user: { id: string; email: string; name: string } }>("/auth/login", { method: "POST", body: { email, password } });
      setSession(result.token, result.user);
      window.location.href = safeNext(params.get("next"));
    } catch (err) {
      setError(errorMessage(err, "Login failed. Please try again."));
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <h1>Welcome back</h1>
      <p className="page-description">Log in to book tickets and see your orders.</p>
      <Card>
        <form onSubmit={handleSubmit}>
          <Field label="Email" htmlFor="login-email">
            <TextInput id="login-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </Field>
          <Field label="Password" htmlFor="login-password">
            <TextInput id="login-password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </Field>
          {error && <ErrorBanner message={error} />}
          <Button type="submit" disabled={loading} block>
            {loading ? "Logging in…" : "Log in"}
          </Button>
        </form>
      </Card>
      <p style={{ marginTop: 16, textAlign: "center" }}>
        New here? <Link href="/register" style={{ color: "var(--color-accent-strong)" }}>Create an account</Link>
      </p>
      <details className="demo-logins" open>
        <summary>Demo accounts</summary>
        <div className="chip-row">
          {DEMO_LOGINS.map((login) => (
            <Chip
              key={login.email}
              selected={email === login.email}
              onClick={() => {
                setEmail(login.email);
                setPassword(DEMO_PASSWORD);
              }}
            >
              {login.label}
            </Chip>
          ))}
        </div>
      </details>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
