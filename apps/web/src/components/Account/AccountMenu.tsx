import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLogout } from '../../api/accounts';
import { useAuth } from '../../lib/auth';
import { Menu } from '../ui/Menu';
import { Settings, SignOut } from '../ui/Icon';
import { Avatar } from './Avatar';
import './account.css';

/** The avatar in the sidebar: the two things an account ever needs, and nothing else. */
export function AccountMenu() {
  const { user } = useAuth();
  const logout = useLogout();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const button = useRef<HTMLButtonElement | null>(null);

  const signOut = (): void => {
    logout.mutate(undefined, {
      // A full reload is the simplest way to drop every cached page and the live socket.
      onSettled: () => window.location.assign('/'),
    });
  };

  // The shell is only reached by a signed-in account, but the auth state lands a tick later.
  if (user === null) return null;

  return (
    <div className="account-menu">
      <button
        ref={button}
        type="button"
        className="account-menu__button"
        onClick={() => setMenuOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label="Your account"
      >
        <Avatar person={user} size={24} title={user.name} />
      </button>

      {menuOpen ? (
        // The avatar sits at the left of the sidebar, so a panel hung off its right edge ran off
        // the screen. Lined up on the right edge of the avatar, it keeps clear of every edge.
        <Menu
          label="Your account"
          anchor={button}
          align="right"
          className="account-menu__panel"
          onClose={() => setMenuOpen(false)}
        >
          <div className="account-menu__who">
            <Avatar person={user} size={32} />
            <div>
              <div className="account-menu__name">{user.name}</div>
              <div className="account-menu__sub">{user.email}</div>
            </div>
          </div>

          <div className="account-menu__sep" />

          <button
            type="button"
            role="menuitem"
            className="account-menu__item"
            onClick={() => {
              setMenuOpen(false);
              navigate('/settings');
            }}
          >
            <Settings />
            Settings
          </button>

          <button
            type="button"
            role="menuitem"
            className="account-menu__item account-menu__item--danger"
            onClick={signOut}
          >
            <SignOut />
            Log out
          </button>
        </Menu>
      ) : null}
    </div>
  );
}
