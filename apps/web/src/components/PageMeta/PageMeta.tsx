import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Page } from '@tablinum/shared';
import { useBacklinks } from '../../api/hooks';
import { absoluteTime, relativeTime } from '../../lib/format';
import { pageHref } from '../../lib/href';
import type { PanelState } from '../../lib/panels';
import { Close } from '../ui/Icon';
import { HistoryPanel } from './HistoryPanel';
import './pagemeta.css';

interface PageMetaProps {
  page: Page;
  panels: PanelState;
  onClose: () => void;
}

/** The rail beside the page. The page menu decides which parts of it are on. */
export function PageMeta({ page, panels, onClose }: PageMetaProps) {
  return (
    <aside
      className="pagemeta"
      aria-label="Page details"
      // Bound to the rail, so a press in the editor still belongs to the editor.
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        onClose();
      }}
    >
      <div className="pagemeta__head">
        <h2 className="section-label">Page details</h2>
        <button
          type="button"
          className="btn btn--icon"
          onClick={onClose}
          aria-label="Hide the page details"
          title="Hide the page details (⌘⇧.)"
        >
          <Close />
        </button>
      </div>

      <dl className="pagemeta__facts">
        <dt>Created</dt>
        <dd title={absoluteTime(page.created)}>{relativeTime(page.created)}</dd>
        <dt>Updated</dt>
        <dd title={absoluteTime(page.updated)}>{relativeTime(page.updated)}</dd>
        <dt>Path</dt>
        <dd>
          <code className="pagemeta__path">{page.path}</code>
        </dd>
      </dl>

      {panels.backlinks ? (
        <Section label="Backlinks">
          <Backlinks pageId={page.id} />
        </Section>
      ) : null}

      {panels.history ? (
        <Section label="History">
          <HistoryPanel pageId={page.id} enabled />
        </Section>
      ) : null}
    </aside>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="pagemeta__section" aria-label={label}>
      <h2 className="pagemeta__section-head section-label">{label}</h2>
      <div className="pagemeta__section-body">{children}</div>
    </section>
  );
}

function Backlinks({ pageId }: { pageId: string }) {
  const backlinks = useBacklinks(pageId);

  if (backlinks.isLoading) return <p className="empty-note">Loading…</p>;
  if (backlinks.isError) return <p className="empty-note">Backlinks are unavailable.</p>;

  const links = backlinks.data?.backlinks ?? [];
  if (links.length === 0) return <p className="empty-note">No page links here yet.</p>;

  return (
    <ul className="backlinks">
      {links.map((link) => (
        <li key={link.id}>
          <Link className="backlinks__item" to={pageHref(link.path)}>
            <span className="backlinks__title">{link.title}</span>
            <span className="backlinks__path">{link.path}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
