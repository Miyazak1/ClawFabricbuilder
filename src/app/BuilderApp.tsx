import { Code2, FolderOpen, Plus, Sparkles } from 'lucide-react';

export function BuilderApp() {
  return (
    <main className="builder-shell">
      <aside className="project-rail" aria-label="Projects">
        <header className="brand-row">
          <span className="brand-mark" aria-hidden="true"><Code2 size={18} /></span>
          <strong>ClawFabric Builder</strong>
        </header>
        <button className="new-project-button" type="button" disabled>
          <Plus size={16} aria-hidden="true" />
          New project
        </button>
        <div className="empty-projects">
          <FolderOpen size={20} aria-hidden="true" />
          <span>No saved projects</span>
        </div>
      </aside>

      <section className="workspace" aria-label="Builder workspace">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">New project</p>
            <h1>What do you want to make?</h1>
          </div>
        </header>
        <div className="idea-composer">
          <label htmlFor="builder-idea">Describe your idea</label>
          <textarea
            id="builder-idea"
            disabled
            placeholder="A small tool that helps me..."
            rows={6}
          />
          <div className="composer-actions">
            <span role="status">Builder core is not connected yet.</span>
            <button type="button" disabled>
              <Sparkles size={16} aria-hidden="true" />
              Make it
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
