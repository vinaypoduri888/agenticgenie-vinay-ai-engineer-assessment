import type { ReactNode } from "react";

export const metadata = {
  title: "Agentic Genie Ticketing",
  description: "Multi-organiser event ticketing platform — foundation build.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
