import { ReactRenderer } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import type {
  SuggestionKeyDownProps,
  SuggestionOptions,
  SuggestionProps,
} from '@tiptap/suggestion';
import type { ForwardRefExoticComponent, PropsWithoutRef, RefAttributes } from 'react';

export interface SuggestionMenuHandle {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
}

/** Props every suggestion menu receives. A type alias, so it satisfies `Record<string, any>`. */
export type SuggestionMenuProps<I> = {
  items: I[];
  query: string;
  command: (item: I) => void;
};

export type SuggestionMenuComponent<I> = ForwardRefExoticComponent<
  PropsWithoutRef<SuggestionMenuProps<I>> & RefAttributes<SuggestionMenuHandle>
>;

const GAP = 6;
const ESTIMATED_HEIGHT = 300;

/**
 * Mounts a menu component next to the caret and forwards arrow keys to it.
 * Positioning is done by hand rather than with a popper library: the menu is a
 * single fixed box, and one less dependency is one less thing to theme.
 */
export function createSuggestionRenderer<I>(
  Menu: SuggestionMenuComponent<I>,
): NonNullable<SuggestionOptions<I, I>['render']> {
  return () => {
    let renderer: ReactRenderer<SuggestionMenuHandle, SuggestionMenuProps<I>> | null = null;
    let element: HTMLElement | null = null;

    const mount = (props: SuggestionProps<I, I>): void => {
      renderer = new ReactRenderer(Menu, {
        editor: props.editor as Editor,
        props: toMenuProps(props),
        className: 'gd-editor-suggestion',
      });
      element = asHtmlElement(renderer.element);
      if (!element) return;
      document.body.appendChild(element);
      place(element, props.clientRect?.() ?? null);
    };

    const unmount = (): void => {
      element?.remove();
      renderer?.destroy();
      renderer = null;
      element = null;
    };

    return {
      onStart: (props) => mount(props),
      onUpdate: (props) => {
        renderer?.updateProps(toMenuProps(props));
        if (element) place(element, props.clientRect?.() ?? null);
      },
      onKeyDown: (props) => {
        if (props.event.key === 'Escape') {
          unmount();
          return true;
        }
        return renderer?.ref?.onKeyDown(props) ?? false;
      },
      onExit: () => unmount(),
    };
  };
}

function toMenuProps<I>(props: SuggestionProps<I, I>): SuggestionMenuProps<I> {
  return { items: props.items, query: props.query, command: props.command };
}

function asHtmlElement(value: Element): HTMLElement | null {
  return value instanceof HTMLElement ? value : null;
}

function place(element: HTMLElement, rect: DOMRect | null): void {
  if (!rect) return;
  const height = element.offsetHeight || ESTIMATED_HEIGHT;
  const below = rect.bottom + GAP;
  const flip = below + height > window.innerHeight && rect.top - height - GAP > 0;
  element.style.position = 'fixed';
  element.style.zIndex = '60';
  element.style.left = `${Math.round(Math.max(GAP, Math.min(rect.left, window.innerWidth - 300)))}px`;
  element.style.top = `${Math.round(flip ? rect.top - height - GAP : below)}px`;
}
