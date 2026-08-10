import { useNavigate, useParams } from 'react-router-dom';
import type { Account } from '@tablinum/shared';
import { useAuth } from '../lib/auth';
import { AgentsPanel } from '../components/Account/AgentsPanel';
import { EmojiPanel } from '../components/Account/EmojiPanel';
import { PeoplePanel } from '../components/Account/PeoplePanel';
import { ProfilePanel } from '../components/Account/ProfilePanel';
import { WorkspacePanel } from '../components/Workspace/WorkspacePanel';
import { Bot, DocIcon, People, Settings, Smiley, UserIcon } from '../components/ui/Icon';
import './settings.css';

/** One entry in the left column of the settings page. */
interface Section {
  id: string;
  label: string;
  title: string;
  icon: JSX.Element;
  adminOnly?: boolean;
}

const SECTIONS: Section[] = [
  { id: 'account', label: 'My account', title: 'My account', icon: <UserIcon /> },
  { id: 'emoji', label: 'Custom emoji', title: 'Custom emoji', icon: <Smiley /> },
  { id: 'workspace', label: 'Workspace', title: 'Workspace', icon: <Settings /> },
  { id: 'people', label: 'People and invites', title: 'People and invites', icon: <People />, adminOnly: true },
  { id: 'agents', label: 'Agents', title: 'Agents', icon: <Bot />, adminOnly: true },
];

export const DEFAULT_SETTINGS_SECTION = 'account';

/** Everything that used to sit behind a dialog, on a page of its own. */
export function SettingsRoute() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const params = useParams();

  // The shell is only reached by a signed-in account, but the auth state lands a tick later.
  if (user === null) return null;

  const visible = SECTIONS.filter((section) => !section.adminOnly || user.role === 'admin');
  const wanted = params['section'] ?? DEFAULT_SETTINGS_SECTION;
  const current = visible.find((section) => section.id === wanted) ?? visible[0];
  if (current === undefined) return null;

  return (
    <div className="settings">
      <nav className="settings__nav" aria-label="Settings">
        <button type="button" className="settings__back" onClick={() => navigate('/')}>
          <DocIcon />
          Back to the pages
        </button>
        {visible.map((section) => (
          <button
            key={section.id}
            type="button"
            aria-current={section.id === current.id ? 'page' : undefined}
            className={
              section.id === current.id ? 'settings__link settings__link--on' : 'settings__link'
            }
            onClick={() => navigate(`/settings/${section.id}`)}
          >
            {section.icon}
            {section.label}
          </button>
        ))}
      </nav>

      <section className="settings__body" aria-label={current.title}>
        <h1 className="settings__title">{current.title}</h1>
        <SectionBody id={current.id} user={user} />
      </section>
    </div>
  );
}

function SectionBody({ id, user }: { id: string; user: Account }) {
  if (id === 'emoji') return <EmojiPanel user={user} />;
  if (id === 'workspace') return <WorkspacePanel />;
  if (id === 'people') return <PeoplePanel me={user} />;
  if (id === 'agents') return <AgentsPanel />;
  return <ProfilePanel user={user} />;
}
