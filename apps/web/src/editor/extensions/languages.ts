import { common, createLowlight } from 'lowlight';
import { MERMAID_LANGUAGE } from '../mermaid';

export const lowlight = createLowlight(common);

/**
 * Languages offered by the code block picker, in menu order. `mermaid` is not a
 * lowlight grammar: it is there so a plain fence can be turned into a diagram.
 */
export const CODE_LANGUAGES: readonly string[] = [
  ...Object.keys(common),
  MERMAID_LANGUAGE,
].sort();
