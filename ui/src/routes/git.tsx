import { createFileRoute } from '@tanstack/react-router';

function GitPage() {
  return (
    <div className="page">
      <div className="page-head">
        <h1>Git</h1>
        <p className="sub">Repository status, commit and push controls are not implemented in this phase.</p>
      </div>
      <div className="panel empty-state">
        <h2>Git is coming in Phase 5</h2>
        <p>The new endpoint module and system-git adapter are documented in the API gaps.</p>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/git')({
  component: GitPage,
});
