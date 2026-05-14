import Link from "next/link";

const PROJECTS = [
  {
    id: "proj-finance-infra-q3",
    name: "Finance — Infra Q3 FY26",
    team: "Finance",
    description: "Capital budgeting and vendor selection for Q3 FY26 infrastructure investment.",
  },
  {
    id: "proj-compliance-privacy",
    name: "Legal/Compliance — Data Privacy",
    team: "Legal",
    description: "GDPR, CCPA, and data governance compliance program.",
  },
  {
    id: "proj-eng-incident-ops",
    name: "Engineering — Incident Ops",
    team: "Engineering",
    description: "Runbooks, on-call rotations, SLA commitments, and incident postmortems.",
  },
  {
    id: "proj-corpdev-targetco-dd",
    name: "CorpDev — TargetCo Due Diligence",
    team: "Corporate Development",
    description: "M&A due diligence materials for TargetCo acquisition.",
  },
  {
    id: "proj-org-shared",
    name: "Org Shared Policies",
    team: "Corporate",
    description: "Canonical org-wide glossary, policies, and process documents.",
  },
];

export default function ProjectsPage() {
  return (
    <>
      <h1 style={{ marginTop: 0 }}>Projects</h1>
      <p style={{ color: "#555", marginBottom: 24 }}>
        Org projects seeded in Session 4. Click a project to view its assets.
      </p>
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
        }}
      >
        {PROJECTS.map((p) => (
          <li
            key={p.id}
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: 8,
              padding: "16px 20px",
            }}
          >
            <Link
              href={`/assets?project_id=${p.id}`}
              style={{
                fontWeight: 600,
                fontSize: 15,
                textDecoration: "none",
                color: "#1a1a2e",
              }}
            >
              {p.name}
            </Link>
            <p style={{ margin: "4px 0", fontSize: 12, color: "#9ca3af" }}>
              {p.team} · <code style={{ fontSize: 11 }}>{p.id}</code>
            </p>
            <p style={{ margin: "6px 0 0", color: "#555", fontSize: 13 }}>
              {p.description}
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}
