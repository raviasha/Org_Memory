/**
 * /projects/[project_id] — Session 8b
 *
 * Project workspace: shows the project header, asset table with add/remove
 * actions, and an Ingest Operations section with soft-delete audit entries.
 */

import WorkspaceClient from "./WorkspaceClient";

export const metadata = { title: "Project Workspace — Org Memory" };

export default async function ProjectWorkspacePage({
  params,
}: {
  params: Promise<{ project_id: string }>;
}) {
  const { project_id } = await params;
  return <WorkspaceClient projectId={project_id} />;
}
