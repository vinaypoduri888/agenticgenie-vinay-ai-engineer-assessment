"use client";

import Link from "next/link";
import { useSession } from "../lib/useSession";

const linkStyle: React.CSSProperties = { color: "#eee", textDecoration: "none", marginRight: 16 };

export function Nav() {
  const { user, logout } = useSession();

  return (
    <nav style={{ background: "#111", padding: "12px 20px", display: "flex", alignItems: "center" }}>
      <Link href="/events" style={{ ...linkStyle, fontWeight: 700 }}>
        Agentic Genie
      </Link>
      <Link href="/events" style={linkStyle}>
        Browse events
      </Link>
      {user && (
        <Link href="/orders" style={linkStyle}>
          My orders
        </Link>
      )}
      {user && (
        <Link href="/organiser" style={linkStyle}>
          Organiser dashboard
        </Link>
      )}
      <span style={{ flex: 1 }} />
      {user === undefined ? null : user ? (
        <>
          <span style={{ color: "#aaa", marginRight: 12 }}>{user.name}</span>
          <button onClick={logout} style={{ background: "none", border: "1px solid #555", color: "#eee", padding: "4px 10px", borderRadius: 4, cursor: "pointer" }}>
            Log out
          </button>
        </>
      ) : (
        <>
          <Link href="/login" style={linkStyle}>
            Log in
          </Link>
          <Link href="/register" style={linkStyle}>
            Register
          </Link>
        </>
      )}
    </nav>
  );
}
