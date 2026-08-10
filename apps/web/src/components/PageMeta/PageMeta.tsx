import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Page } from '@tablinum/shared';
import { useBacklinks, useRemoveDatabase, useSetDatabase } from '../../api/hooks';
import { absoluteTime, relativeTime } from '../../lib/format';
import { pageHref } from '../../lib/href';
import { useToast } from '../../lib/toast';
import { ChevronRight } from '../ui/Icon';
import { HistoryPanel } from './HistoryPanel';
import './pagemeta.css';

interface PageMetaProps {
  page: Page;
}

export function PageMeta({ page }: PageMetaProps) {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    backlinks: true,
    history: false,
  });

  const toggle = (id: string): void =>
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));

  return (
    <aside className="pagemeta" aria-label="Page details">
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

      <DatabaseToggle page={page} />

      <Section id="backlinks" label="Backlinks" open={openSections['backlinks'] ?? false} onToggle={toggle}>
        <Backlinks pageId={page.id} enabled={openSections['backlinks'] ?? false} />
      </Section>

      <Section id="history" label="History" open={openSections['history'] ?? false} onToggle={toggle}>
        <HistoryPanel pageId={page.id} enabled={openSections['history'] ?? false} />
      </Section>
    </aside>
  );
}

interface SectionProps {
  id: string;
  label: string;
  open: boolean;
  onToggle: (id: string) => void;
  children: ReactNode;
}

function Section({ id, label, open, onToggle, children }: SectionProps) {
  return (
    <section className="pagemeta__section">
      <button
        type="button"
        className="pagemeta__section-head"
        onClick={() => onToggle(id)}
        aria-expanded={open}
      >
        <ChevronRight size={11} className={open ? 'pagemeta__caret pagemeta__caret--open' : 'pagemeta__caret'} />
        <span className="section-label">{label}</span>
      </button>
      {open ? <div className="pagemeta__section-body">{children}</div> : null}
    </section>
  );
}

/** Turn the page into a database, or take the database off it. The rows stay either way. */
function DatabaseToggle({ page }: { page: Page }) {
  const toast = useToast();
  const setDatabase = useSetDatabase();
  const removeDatabase = useRemoveDatabase();
  const busy = setDatabase.isPending || removeDatabase.isPending;

  if (page.database !== undefined) {
    return (
      <div className="pagemeta__section">
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() =>
            removeDatabase.mutate(page.id, {
              onError: (error) => toast.pushError(error, 'The database could not be removed'),
            })
          }
        >
          Remove the database
        </button>
      </div>
    );
  }

  return (
    <div className="pagemeta__section">
      <button
        type="button"
        className="btn"
        disabled={busy}
        onClick={() =>
          setDatabase.mutate(
            { pageId: page.id },
            { onError: (error) => toast.pushError(error, 'The database could not be created') },
          )
        }
      >
        Turn into a database
      </button>
    </div>
  );
}

function Backlinks({ pageId, enabled }: { pageId: string; enabled: boolean }) {
  const backlinks = useBacklinks(enabled ? pageId : undefined);

  if (!enabled) return null;
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
