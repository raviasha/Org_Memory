import Link from "next/link";

const SECTIONS = [
  {
    href: "/projects",
    title: "Projects",
    description: "Manage org projects and their associated asset collections.",
  },
  {
    href: "/assets",
    title: "Assets",
    description:
      "Browse ingested source assets — documents, URLs, repos, and more.",
  },
  {
    href: "/wiki",
    title: "Wiki",
    description:
      "Explore LLM-generated synthesis pages compiled from your assets.",
  },
] as const;

export default function HomePage() {
  return (
    <>
      <h1 style={{ marginTop: 0 }}>Dashboard</h1>
      <p style={{ color: "#555", marginBottom: 32 }}>
        Welcome to Org Memory. Select a section below to get started.
      </p>
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "grid",
          gap: 16,
          gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
        }}
      >
        {SECTIONS.map(({ href, title, description }) => (
          <li
            key={href}
            style={{
              border: "1px solid #e0e0e0",
              borderRadius: 8,
              padding: 20,
            }}
          >
            <Link
              href={href}
              style={{
                fontWeight: 600,
                fontSize: 16,
                textDecoration: "none",
                color: "#1a1a2e",
              }}
            >
              {title}
            </Link>
            <p style={{ margin: "8px 0 0", color: "#666", fontSize: 14 }}>
              {description}
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}
