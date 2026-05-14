import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Org Memory",
  description: "Org memory task launcher and knowledge management",
};

const NAV_LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/projects", label: "Projects" },
  { href: "/assets", label: "Assets" },
  { href: "/wiki", label: "Wiki" },
  { href: "/ingest", label: "Ingest Ops" },
] as const;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif" }}>
        <div style={{ display: "flex", minHeight: "100vh" }}>
          <nav
            aria-label="Main navigation"
            style={{
              width: 220,
              flexShrink: 0,
              background: "#1a1a2e",
              color: "#fff",
              padding: "24px 16px",
            }}
          >
            <p
              style={{
                margin: "0 0 24px",
                fontSize: 18,
                fontWeight: 700,
                letterSpacing: "-0.01em",
              }}
            >
              Org Memory
            </p>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {NAV_LINKS.map(({ href, label }) => (
                <li key={href}>
                  <Link
                    href={href}
                    style={{
                      color: "#c8c8d8",
                      textDecoration: "none",
                      display: "block",
                      padding: "8px 4px",
                      borderRadius: 4,
                    }}
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <main style={{ flex: 1, padding: "32px 40px" }}>{children}</main>
        </div>
      </body>
    </html>
  );
}
