import type { ReactNode } from "react";
import { Nav } from "../components/Nav";

export const metadata = {
  title: "Agentic Genie Ticketing",
  description: "Multi-organiser event ticketing platform.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f7f7f8", color: "#111" }}>
        <Nav />
        <main style={{ maxWidth: 960, margin: "0 auto", padding: "24px 20px" }}>{children}</main>
      </body>
    </html>
  );
}
