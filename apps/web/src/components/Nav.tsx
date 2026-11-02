"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "../lib/useSession";
import { useMemberships } from "../lib/useMemberships";
import { Button, Icon } from "./ui";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function Nav() {
  const { user, logout } = useSession();
  const memberships = useMemberships();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const items = [
    { href: "/events", label: "Discover" },
    { href: "/assistant", label: "Assistant" },
    ...(user ? [{ href: "/orders", label: "My tickets" }] : []),
    ...(memberships && memberships.length > 0 ? [{ href: "/organiser", label: "Organiser" }] : []),
  ];

  const links = items.map((item) => {
    const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
    return (
      <Link key={item.href} href={item.href} className={`site-nav-link${active ? " active" : ""}`} aria-current={active ? "page" : undefined} onClick={() => setOpen(false)}>
        {item.label}
      </Link>
    );
  });

  return (
    <nav className="site-nav" aria-label="Main">
      <div className="site-nav-inner">
        <Link href="/" className="site-nav-brand">
          <span className="brand-mark" aria-hidden="true">
            <Icon name="ticket" size={16} />
          </span>
          Agentic Genie
        </Link>
        <div className="site-nav-links">{links}</div>
        <span className="site-nav-spacer" />
        <div className="site-nav-links">
          {user === undefined ? null : user ? (
            <>
              <span className="avatar" title={user.email} aria-hidden="true">
                {initials(user.name)}
              </span>
              <span className="site-nav-user">{user.name}</span>
              <Button variant="ghost" size="sm" onClick={logout}>
                Log out
              </Button>
            </>
          ) : (
            <>
              <Link href="/login" className="site-nav-link">
                Log in
              </Link>
              <Link href="/register" className="btn btn-primary btn-sm">
                Sign up
              </Link>
            </>
          )}
        </div>
        <button className="site-nav-toggle" aria-expanded={open} aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpen((v) => !v)}>
          <Icon name={open ? "close" : "menu"} />
        </button>
      </div>
      {open && (
        <div className="site-nav-mobile">
          {links}
          {user === undefined ? null : user ? (
            <Button variant="secondary" size="sm" onClick={logout}>
              Log out ({user.name})
            </Button>
          ) : (
            <>
              <Link href="/login" className="site-nav-link" onClick={() => setOpen(false)}>
                Log in
              </Link>
              <Link href="/register" className="site-nav-link" onClick={() => setOpen(false)}>
                Sign up
              </Link>
            </>
          )}
        </div>
      )}
    </nav>
  );
}
