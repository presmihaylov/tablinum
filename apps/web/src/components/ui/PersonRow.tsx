import { Avatar, type AvatarPerson } from '../Account/Avatar';

/** Somebody an `@` can name. */
export interface MentionCandidate extends AvatarPerson {
  handle: string;
}

/**
 * One person in an `@` menu. The page editor and the comment composer both draw it, so one
 * name looks the same wherever it is written. The box round it belongs to the caller.
 */
export function PersonRow({ person }: { person: MentionCandidate }) {
  return (
    <>
      <Avatar person={person} size={20} className="menu__face" />
      <span className="menu__text">
        <span className="menu__title">{person.name}</span>
        <span className="menu__hint">@{person.handle}</span>
      </span>
    </>
  );
}
