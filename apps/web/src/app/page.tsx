type ApiHealth = {
  ok: boolean;
  body: unknown;
};

async function getApiHealth(): Promise<ApiHealth> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  try {
    const response = await fetch(`${apiUrl}/health`, { cache: "no-store" });
    const body = await response.json();
    return { ok: response.ok, body };
  } catch (error) {
    return { ok: false, body: { error: (error as Error).message } };
  }
}

export default async function HomePage() {
  const health = await getApiHealth();

  return (
    <main style={{ fontFamily: "sans-serif", padding: "2rem", maxWidth: 640 }}>
      <h1>Agentic Genie — Foundation</h1>
      <p>
        API health check ({health.ok ? "reachable" : "unreachable"}, via{" "}
        <code>{process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/health</code>):
      </p>
      <pre
        style={{
          background: "#111",
          color: "#0f0",
          padding: "1rem",
          borderRadius: 8,
          overflowX: "auto",
        }}
      >
        {JSON.stringify(health.body, null, 2)}
      </pre>
    </main>
  );
}
