/**
 * /assets — Session 5
 *
 * Asset inventory panel.  Lists assets with project, source-type, and
 * lineage metadata.  Includes a quick-action panel to trigger git repo ingest
 * for the prototype corpus (platform-services-repo).
 *
 * This is a Server Component that fetches from the internal API route.
 * Full project/asset management UI is delivered in Session 8b.
 */

import AssetInventory from "./AssetInventory";

export const metadata = { title: "Assets — Org Memory" };

export default function AssetsPage() {
  return (
    <>
      <h1 style={{ marginTop: 0 }}>Assets</h1>
      <p style={{ color: "#555", marginBottom: 24 }}>
        Ingested source assets — documents, images, URLs, git repos, and more.
        Use the panel below to trigger git ingest or browse by project.
      </p>
      <AssetInventory />
    </>
  );
}
