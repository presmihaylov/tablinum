import { useEffect, useState, type KeyboardEvent } from 'react';
import { Close } from '../ui/Icon';

interface TagsEditorProps {
  tags: string[];
  resetKey: string;
  onChange: (tags: string[]) => void;
}

export function TagsEditor({ tags, resetKey, onChange }: TagsEditorProps) {
  const [draft, setDraft] = useState('');

  useEffect(() => {
    setDraft('');
  }, [resetKey]);

  const add = (raw: string): void => {
    const tag = raw.trim().replace(/^#/, '');
    if (tag.length === 0) return;
    if (tags.includes(tag)) {
      setDraft('');
      return;
    }
    onChange([...tags, tag]);
    setDraft('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      add(draft);
      return;
    }
    if (event.key === 'Backspace' && draft.length === 0 && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  };

  return (
    <div className="tags">
      {tags.map((tag) => (
        <span className="chip tags__chip" key={tag}>
          {tag}
          <button
            type="button"
            className="tags__remove"
            aria-label={`Remove tag ${tag}`}
            onClick={() => onChange(tags.filter((entry) => entry !== tag))}
          >
            <Close size={9} />
          </button>
        </span>
      ))}
      <input
        className="tags__input"
        value={draft}
        placeholder={tags.length === 0 ? 'Add a tag…' : ''}
        aria-label="Add a tag"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => add(draft)}
      />
    </div>
  );
}
