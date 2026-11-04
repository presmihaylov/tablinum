// Key names as the specs write them ("Control+Shift+ArrowDown") to WebDriver key values.
import { Key } from 'webdriverio';

const NAMED: Record<string, string> = {
  Enter: Key.Enter,
  Tab: Key.Tab,
  Backspace: Key.Backspace,
  Delete: Key.Delete,
  Escape: Key.Escape,
  Space: ' ',
  ArrowUp: Key.ArrowUp,
  ArrowDown: Key.ArrowDown,
  ArrowLeft: Key.ArrowLeft,
  ArrowRight: Key.ArrowRight,
  Home: Key.Home,
  End: Key.End,
  PageUp: Key.PageUp,
  PageDown: Key.PageDown,
  Shift: Key.Shift,
  Control: Key.Control,
  // Linux has no Meta shortcuts in the app, so ControlOrMeta is Control, as Playwright resolves it here.
  ControlOrMeta: Key.Control,
  Alt: Key.Alt,
  Meta: Key.Command,
  Insert: Key.Insert,
  F1: Key.F1,
  F2: Key.F2,
};

export function keyValue(name: string): string {
  const named = NAMED[name];
  if (named !== undefined) return named;
  if ([...name].length === 1) return name;
  throw new Error(`unknown key "${name}"`);
}

// "Control+Shift+Z" to its keys in press order; a lone "+" is the plus key.
export function combo(spec: string): string[] {
  if (spec === '+') return ['+'];
  const parts = spec.endsWith('++') ? [...spec.slice(0, -2).split('+'), '+'] : spec.split('+');
  return parts.map(keyValue);
}
