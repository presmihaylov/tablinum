// A locator is a list of steps, sent to the page as JSON and resolved there by dom-query.ts.
export type Matcher = { str: string } | { re: string; flags: string };

export interface RoleOptions {
  name?: Matcher;
  exact?: boolean;
  selected?: boolean;
  checked?: boolean;
  pressed?: boolean;
  expanded?: boolean;
  level?: number;
  includeHidden?: boolean;
}

export type Step =
  | { kind: 'css'; selector: string }
  | { kind: 'role'; role: string; options: RoleOptions }
  | { kind: 'text'; text: Matcher; exact?: boolean }
  | { kind: 'label'; text: Matcher; exact?: boolean }
  | { kind: 'attr'; attr: string; value: Matcher; exact?: boolean }
  | { kind: 'nth'; index: number }
  | {
      kind: 'filter';
      hasText?: Matcher;
      hasNotText?: Matcher;
      has?: Step[];
      hasNot?: Step[];
      visible?: boolean;
    };

export const matcher = (value: string | RegExp): Matcher =>
  typeof value === 'string' ? { str: value } : { re: value.source, flags: value.flags };
