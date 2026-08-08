import { describe, expect, it, vi, type Mock } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { PropValue } from '@gitdocs/shared';
import { PropsTable } from '../src/components/PageMeta/PropsTable';
import {
  convertPropValue,
  coercePropValue,
  formatPropValue,
  inferPropType,
  inferTypeFromInput,
  parsePropInput,
} from '../src/lib/propTypes';

describe('inferPropType', () => {
  it('reads the type of a value already in frontmatter', () => {
    expect(inferPropType('draft')).toBe('text');
    expect(inferPropType(42)).toBe('number');
    expect(inferPropType(true)).toBe('boolean');
    expect(inferPropType(['a', 'b'])).toBe('multi');
    expect(inferPropType([])).toBe('multi');
    expect(inferPropType('2026-03-01')).toBe('date');
    expect(inferPropType('2026-03-01T09:30:00Z')).toBe('date');
    expect(inferPropType(null)).toBe('text');
  });

  it('does not mistake a version string for a date', () => {
    expect(inferPropType('2026-13-45')).toBe('text');
    expect(inferPropType('1.2.3')).toBe('text');
  });
});

describe('inferTypeFromInput', () => {
  it('guesses the type of freshly typed text', () => {
    expect(inferTypeFromInput('true')).toBe('boolean');
    expect(inferTypeFromInput('false')).toBe('boolean');
    expect(inferTypeFromInput('2026-03-01')).toBe('date');
    expect(inferTypeFromInput('42')).toBe('number');
    expect(inferTypeFromInput('-3.5')).toBe('number');
    expect(inferTypeFromInput('a, b, c')).toBe('multi');
    expect(inferTypeFromInput('shipping')).toBe('text');
    expect(inferTypeFromInput('')).toBe('text');
  });

  it('prefers boolean and date over number', () => {
    expect(inferTypeFromInput(' true ')).toBe('boolean');
    expect(inferTypeFromInput('2026-03-01')).not.toBe('number');
  });
});

describe('coercePropValue', () => {
  it('turns raw text into the stored value', () => {
    expect(parsePropInput('42')).toBe(42);
    expect(parsePropInput('true')).toBe(true);
    expect(parsePropInput('a, b ,, c')).toEqual(['a', 'b', 'c']);
    expect(parsePropInput('  ')).toBeNull();
    expect(coercePropValue('yes', 'boolean')).toBe(true);
    expect(coercePropValue('nope', 'boolean')).toBe(false);
    expect(coercePropValue('not a number', 'number')).toBe('not a number');
  });

  it('round-trips through the display string', () => {
    const values: PropValue[] = ['draft', 12, true, ['a', 'b'], null];
    for (const value of values) {
      expect(convertPropValue(value, inferPropType(value))).toEqual(value);
    }
    expect(formatPropValue(['a', 'b'])).toBe('a, b');
    expect(formatPropValue(null)).toBe('');
  });

  it('converts a value when the user switches the type', () => {
    expect(convertPropValue(42, 'text')).toBe('42');
    expect(convertPropValue('true', 'boolean')).toBe(true);
    expect(convertPropValue('draft', 'boolean')).toBe(false);
    expect(convertPropValue(['a', 'b'], 'text')).toBe('a, b');
    expect(convertPropValue('a, b', 'multi')).toEqual(['a', 'b']);
  });
});

type PropsChange = (props: Record<string, PropValue>) => void;

function setup(value: Record<string, PropValue> = {}) {
  const onChange = vi.fn<PropsChange>();
  render(<PropsTable value={value} resetKey="pg_test" onChange={onChange} />);
  return { onChange };
}

function lastCall(onChange: Mock<PropsChange>): Record<string, PropValue> {
  return onChange.mock.calls.at(-1)?.[0] ?? {};
}

describe('PropsTable', () => {
  it('renders one row per property with its inferred type selected', () => {
    setup({ status: 'draft', reviewers: ['ana', 'bo'], shipped: true, effort: 3, due: '2026-03-01' });

    expect(screen.getByLabelText('Type of status')).toHaveValue('text');
    expect(screen.getByLabelText('Type of reviewers')).toHaveValue('multi');
    expect(screen.getByLabelText('Type of shipped')).toHaveValue('boolean');
    expect(screen.getByLabelText('Type of effort')).toHaveValue('number');
    expect(screen.getByLabelText('Type of due')).toHaveValue('date');
    expect(screen.getByLabelText('Value of reviewers')).toHaveValue('ana, bo');
  });

  it('adopts the number type when the user types a number into a fresh row', () => {
    const { onChange } = setup({ effort: null });

    fireEvent.change(screen.getByLabelText('Value of effort'), { target: { value: '42' } });

    expect(screen.getByLabelText('Type of effort')).toHaveValue('number');
    expect(lastCall(onChange)).toEqual({ effort: 42 });
  });

  it('adopts the checkbox type for "true"', () => {
    const { onChange } = setup({ shipped: null });

    fireEvent.change(screen.getByLabelText('Value of shipped'), { target: { value: 'true' } });

    expect(screen.getByLabelText('Type of shipped')).toHaveValue('boolean');
    expect(screen.getByLabelText('Value of shipped')).toBeChecked();
    expect(lastCall(onChange)).toEqual({ shipped: true });
  });

  it('adopts the multi-select type for a comma list', () => {
    const { onChange } = setup({ reviewers: null });

    fireEvent.change(screen.getByLabelText('Value of reviewers'), { target: { value: 'ana, bo' } });

    expect(screen.getByLabelText('Type of reviewers')).toHaveValue('multi');
    expect(lastCall(onChange)).toEqual({ reviewers: ['ana', 'bo'] });
  });

  it('adopts the date type for an ISO date', () => {
    const { onChange } = setup({ due: null });

    fireEvent.change(screen.getByLabelText('Value of due'), { target: { value: '2026-03-01' } });

    expect(screen.getByLabelText('Type of due')).toHaveValue('date');
    expect(lastCall(onChange)).toEqual({ due: '2026-03-01' });
  });

  it('keeps plain words as text', () => {
    const { onChange } = setup({ status: null });

    fireEvent.change(screen.getByLabelText('Value of status'), { target: { value: 'in review' } });

    expect(screen.getByLabelText('Type of status')).toHaveValue('text');
    expect(lastCall(onChange)).toEqual({ status: 'in review' });
  });

  it('converts the value when the user picks another type', () => {
    const { onChange } = setup({ effort: 42 });

    fireEvent.change(screen.getByLabelText('Type of effort'), { target: { value: 'text' } });

    expect(lastCall(onChange)).toEqual({ effort: '42' });
  });

  it('adds a row and reports it once it has a name', () => {
    const { onChange } = setup({ status: 'draft' });

    fireEvent.click(screen.getByRole('button', { name: /add property/i }));
    expect(onChange).not.toHaveBeenCalled();

    const keyInputs = screen.getAllByLabelText('Property name');
    const fresh = keyInputs.at(-1);
    expect(fresh).toBeDefined();
    if (!fresh) return;
    fireEvent.change(fresh, { target: { value: 'owner' } });

    expect(lastCall(onChange)).toEqual({ status: 'draft', owner: null });
  });

  it('removes a row', () => {
    const { onChange } = setup({ status: 'draft', effort: 3 });

    fireEvent.click(screen.getByRole('button', { name: 'Remove effort' }));

    expect(lastCall(onChange)).toEqual({ status: 'draft' });
    expect(screen.queryByLabelText('Type of effort')).toBeNull();
  });

  it('ignores a row whose name is blank', () => {
    const { onChange } = setup({ status: 'draft' });

    fireEvent.change(screen.getByLabelText('Property name'), { target: { value: '   ' } });

    expect(lastCall(onChange)).toEqual({});
  });
});
