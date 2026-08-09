import { useEffect, useRef, useState } from 'react';
import { useLogout } from '../../api/hooks';
import { useAuth } from '../../lib/auth';
import { Bot, People, SignOut, UserIcon } from '../ui/Icon';
import { AgentsDialog } from './AgentsDialog';
import { Avatar } from './Avatar';
import { PeopleDialog } from './PeopleDialog';
import { ProfileDialog } from './ProfileDialog';
import { SetupDialog } from './SetupDialog';
import './account.css';

type OpenDialog = 'none' | 'profile' | 'people' | 'agents' | 'setup';

/** The avatar in the top bar: your profile, the roster, and the way out. */
export function AccountMenu() {
  const { user, hasAccounts, setupRequired, ready } = useAuth();
  const logout = useLogout();
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<OpenDialog>('none');
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: MouseEvent): void => {
      if (ref.current?.contains(event.target as Node)) return;
      setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const signOut = (): void => {
    logout.mutate(undefined, {
      // A full reload is the simplest way to drop every cached page and the live socket.
      onSettled: () => window.location.assign('/'),
    });
  };

  const choose = (next: OpenDialog): void => {
    setMenuOpen(false);
    setDialog(next);
  };

  // Nothing to show until the server has said whether it has accounts at all.
  if (!ready) return null;
  if (!hasAccounts && !setupRequired) return null;

  return (
    <div className="account-menu" ref={ref}>
      <button
        type="button"
        className="account-menu__button"
        onClick={() => setMenuOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label="Your account"
      >
        {user === null ? (
          <span className="btn btn--icon">
            <UserIcon />
          </span>
        ) : (
          <Avatar person={user} size={24} title={user.name} />
        )}
      </button>

      {!menuOpen ? null : (
        <div className="account-menu__panel" role="menu">
          {user === null ? (
            <div className="account-menu__who">
              <div>
                <div className="account-menu__name">Not signed in</div>
                <div className="account-menu__sub">A token or the shared password got you in.</div>
              </div>
            </div>
          ) : (
            <div className="account-menu__who">
              <Avatar person={user} size={32} />
              <div>
                <div className="account-menu__name">{user.name}</div>
                <div className="account-menu__sub">{user.email}</div>
              </div>
            </div>
          )}

          <div className="account-menu__sep" />

          {setupRequired ? (
            <button type="button" role="menuitem" className="account-menu__item" onClick={() => choose('setup')}>
              <UserIcon />
              Create your account
            </button>
          ) : null}

          {user === null ? null : (
            <button type="button" role="menuitem" className="account-menu__item" onClick={() => choose('profile')}>
              <UserIcon />
              Your account
            </button>
          )}

          {user?.role === 'admin' ? (
            <button type="button" role="menuitem" className="account-menu__item" onClick={() => choose('people')}>
              <People />
              People and invites
            </button>
          ) : null}

          {user?.role === 'admin' ? (
            <button type="button" role="menuitem" className="account-menu__item" onClick={() => choose('agents')}>
              <Bot />
              Agents
            </button>
          ) : null}

          <button
            type="button"
            role="menuitem"
            className="account-menu__item account-menu__item--danger"
            onClick={signOut}
          >
            <SignOut />
            Sign out
          </button>
        </div>
      )}

      {user === null ? null : (
        <ProfileDialog user={user} open={dialog === 'profile'} onClose={() => setDialog('none')} />
      )}
      <PeopleDialog me={user} open={dialog === 'people'} onClose={() => setDialog('none')} />
      <AgentsDialog open={dialog === 'agents'} onClose={() => setDialog('none')} />
      <SetupDialog open={dialog === 'setup'} onClose={() => setDialog('none')} />
    </div>
  );
}
