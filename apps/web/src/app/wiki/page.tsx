/**
 * /wiki — Session 8
 *
 * LLM Wiki Explorer — read-only first pass.
 * Lists all wiki pages grouped by type with slug, title, source asset count,
 * cross-reference counts, and freshness indicator.
 *
 * Full wiki navigation (index tree, page graph, page-level content view)
 * is delivered in a later session.
 */

import WikiExplorer from "./WikiExplorer";

export const metadata = { title: "Wiki — Org Memory" };

export default function WikiPage() {
  return (
    <>
      <h1 style={{ marginTop: 0 }}>LLM Wiki Explorer</h1>
      <p style={{ color: "#555", marginBottom: 24 }}>
        Read-only view of all compiled wiki pages — index, log, summaries,
        entities, concepts, comparisons, and syntheses. Pages are authored and
        updated by wiki shaping jobs running after each ingest.
      </p>
      <WikiExplorer />
    </>
  );
}
