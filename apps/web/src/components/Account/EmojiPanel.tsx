import { useRef, useState, type ChangeEvent } from 'react';
import {
  CUSTOM_EMOJI_MIME_TYPES,
  MAX_SHORTCODE_LENGTH,
  shortcodeToken,
  type Account,
  type CustomEmoji,
} from '@tablinum/shared';
import { useCustomEmoji, useDeleteEmoji, useUploadEmoji, useUsers } from '../../api/hooks';
import { describeError, useToast } from '../../lib/toast';
import { ConfirmDialog, type ConfirmRequest } from '../ui/ConfirmDialog';
import { EmojiGlyph } from '../ui/EmojiGlyph';
import { Trash } from '../ui/Icon';
import './account.css';

interface EmojiPanelProps {
  user: Account;
}

/** Your own emoji. Everybody sees them all; you delete yours, an admin deletes anybody's. */
export function EmojiPanel({ user }: EmojiPanelProps) {
  const toast = useToast();
  const emoji = useCustomEmoji();
  const users = useUsers(true);
  const uploadEmoji = useUploadEmoji();
  const deleteEmoji = useDeleteEmoji();

  const [shortcode, setShortcode] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const pickFile = (event: ChangeEvent<HTMLInputElement>): void => {
    const chosen = event.target.files?.[0] ?? null;
    event.target.value = '';
    if (chosen === null) return;
    setError(null);
    setFile(chosen);
    // The file name is the obvious name, so offer it and let the person overwrite it.
    if (shortcode.trim().length === 0) setShortcode(nameOf(chosen.name));
  };

  const add = (): void => {
    setError(null);
    const name = shortcode.trim().toLowerCase();
    if (name.length === 0) {
      setError('Give the emoji a name.');
      return;
    }
    if (file === null) {
      setError('Choose an image.');
      return;
    }
    uploadEmoji.mutate(
      { shortcode: name, file },
      {
        onSuccess: () => {
          setShortcode('');
          setFile(null);
          toast.push(`${shortcodeToken(name)} added`, 'success');
        },
        onError: (cause) => setError(describeError(cause, 'Could not add that emoji.')),
      },
    );
  };

  const remove = (one: CustomEmoji): void =>
    setConfirm({
      title: `Delete ${shortcodeToken(one.shortcode)}?`,
      message: 'Pages that use it keep the text, but it stops being a picture.',
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: () =>
        deleteEmoji.mutate(one.id, {
          onError: (cause) => setError(describeError(cause, 'Could not delete that emoji.')),
        }),
    });

  const list = emoji.data?.emoji ?? [];
  const names = new Map((users.data?.users ?? []).map((one) => [one.id, one.name]));

  return (
    <>
      <div className="account-form">
        <div className="account-section__title">Add an emoji</div>
        <div className="account-form__row">
          <input
            className="input"
            placeholder="parrot"
            aria-label="Emoji name"
            maxLength={MAX_SHORTCODE_LENGTH}
            value={shortcode}
            onChange={(event) => setShortcode(event.target.value)}
          />
          <button type="button" className="btn btn--outline" onClick={() => fileRef.current?.click()}>
            {file === null ? 'Choose an image' : file.name}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={add}
            disabled={uploadEmoji.isPending}
          >
            Upload
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          hidden
          accept={CUSTOM_EMOJI_MIME_TYPES.join(',')}
          aria-label="Emoji image"
          onChange={pickFile}
        />
        <p className="account-form__note">
          PNG, JPEG, WebP or GIF, up to 256 KB. Lower-case letters, digits, &quot;_&quot; and
          &quot;-&quot; only. Write {shortcodeToken('name')} on a page to use it.
        </p>

        {error === null ? null : <p className="account-form__error">{error}</p>}

        <div className="account-section">
          <div className="account-section__title">Uploaded emoji</div>
          {list.length === 0 ? <p className="account-form__note">No custom emoji yet.</p> : null}
          {list.map((one) => (
            <div className="people-row" key={one.id}>
              <span className="emoji-row__glyph">
                <EmojiGlyph value={shortcodeToken(one.shortcode)} />
              </span>
              <div className="people-row__who">
                <div className="people-row__name">{shortcodeToken(one.shortcode)}</div>
                <div className="people-row__email">
                  Added by {names.get(one.userId) ?? 'somebody who has left'}
                </div>
              </div>
              {one.userId === user.id || user.role === 'admin' ? (
                <button
                  type="button"
                  className="btn btn--icon"
                  onClick={() => remove(one)}
                  title={`Delete ${shortcodeToken(one.shortcode)}`}
                  aria-label={`Delete ${shortcodeToken(one.shortcode)}`}
                >
                  <Trash />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}

/** `party-parrot.gif` suggests `party-parrot`. Anything the server refuses is edited by hand. */
function nameOf(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, '');
  return stem.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, MAX_SHORTCODE_LENGTH);
}

