import type { ReactNode } from "react";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import { Ambient } from "../components/Ambient";
import { Nav } from "../components/Nav";
import "./globals.css";

export const metadata = {
  title: "Agentic Genie — AI Event Discovery & Ticketing",
  description: "Discover and book events through natural conversation, or browse the catalogue directly.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Ambient />
        <Nav />
        <main className="app-main">{children}</main>
      </body>
    </html>
  );
}
