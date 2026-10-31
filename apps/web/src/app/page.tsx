import Link from "next/link";

export default function HomePage() {
  return (
    <div>
      <h1>Agentic Genie — Event Ticketing</h1>
      <p>A multi-organiser event ticketing platform.</p>
      <p>
        <Link href="/events">Browse events →</Link>
      </p>
    </div>
  );
}
