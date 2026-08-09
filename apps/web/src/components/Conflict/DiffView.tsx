import { useMemo } from 'react';
import { collapseUnchanged, diffLines } from '../../lib/diff';
import './conflict.css';

interface DiffViewProps {
  before: string;
  after: string;
  beforeLabel: string;
  afterLabel: string;
}

const CLASS: Record<string, string> = {
  same: 'diff__row',
  add: 'diff__row diff__row--add',
  del: 'diff__row diff__row--del',
};

const SIGN: Record<string, string> = { same: ' ', add: '+', del: '-' };

/** A unified diff of the two copies. Read-only: the decision is made by the buttons. */
export function DiffView({ before, after, beforeLabel, afterLabel }: DiffViewProps) {
  const rows = useMemo(() => collapseUnchanged(diffLines(before, after)), [before, after]);

  return (
    <div className="diff">
      <header className="diff__head">
        <span className="diff__label diff__label--del">{beforeLabel}</span>
        <span className="diff__label diff__label--add">{afterLabel}</span>
      </header>
      <pre className="diff__body scroll-y">
        {rows.map((row, index) =>
          row === 'gap' ? (
            <div key={`gap-${index}`} className="diff__gap">
              ⋯
            </div>
          ) : (
            <div key={`${row.kind}-${index}`} className={CLASS[row.kind] ?? 'diff__row'}>
              <span className="diff__sign">{SIGN[row.kind] ?? ' '}</span>
              {row.text.length > 0 ? row.text : ' '}
            </div>
          ),
        )}
      </pre>
    </div>
  );
}
