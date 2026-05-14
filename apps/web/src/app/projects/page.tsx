/**
 * /projects — Session 8
 *
 * Project Hub index dashboard.
 * Renders live project KPIs (asset count, indexed count, freshness) from
 * GET /api/v1/projects via the ProjectHub client component.
 */

import ProjectHub from "./ProjectHub";

export const metadata = { title: "Projects — Org Memory" };

export default function ProjectsPage() {
  return (
    <>
      <h1 style={{ marginTop: 0 }}>Projects</h1>
      <p style={{ color: "#555", marginBottom: 24 }}>
        Project hub — asset counts, indexing status, and freshness indicators.
        Click a project name to browse its assets.
      </p>
      <ProjectHub />
    </>
  );
}
