import type { Node as PMNode } from '@tiptap/pm/model';
import { CODE_LANGUAGES } from '../extensions/languages';

/** The fence's language, as the schema holds it. */
export function readLanguage(node: PMNode): string {
  return typeof node.attrs['language'] === 'string' ? node.attrs['language'] : '';
}

export interface LanguagePickerProps {
  language: string;
  disabled: boolean;
  className: string;
  onPick: (language: string | null) => void;
}

/** The language `<select>` shared by the code block and the diagram. */
export function LanguagePicker({ language, disabled, className, onPick }: LanguagePickerProps) {
  // A file may name a language lowlight does not know; keep it selectable.
  const languages =
    language === '' || CODE_LANGUAGES.includes(language)
      ? CODE_LANGUAGES
      : [language, ...CODE_LANGUAGES];

  return (
    <select
      className={className}
      aria-label="Code language"
      value={language}
      disabled={disabled}
      contentEditable={false}
      onChange={(event) => {
        const next = event.target.value;
        onPick(next.length > 0 ? next : null);
      }}
    >
      <option value="">plain text</option>
      {languages.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </select>
  );
}

export default LanguagePicker;
