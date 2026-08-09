import { avatarUrl, initialsOf } from '@gitdocs/shared';
import './account.css';

export interface AvatarPerson {
  id: string;
  name: string;
  color: string;
  avatarRev?: string | null;
}

interface AvatarProps {
  person: AvatarPerson;
  size?: number;
  title?: string;
  className?: string;
}

/** A person's picture, or their initials on their own colour while they have none. */
export function Avatar({ person, size = 22, title, className }: AvatarProps) {
  const style = { width: size, height: size, backgroundColor: person.color, fontSize: size * 0.42 };
  const classes = className === undefined ? 'avatar' : `avatar ${className}`;
  const rev = person.avatarRev ?? null;

  if (rev !== null) {
    return (
      <img
        className={classes}
        style={{ width: size, height: size }}
        src={avatarUrl(person.id, rev)}
        alt={person.name}
        title={title ?? person.name}
      />
    );
  }

  return (
    <span className={classes} style={style} title={title ?? person.name} aria-label={person.name}>
      {initialsOf(person.name)}
    </span>
  );
}
