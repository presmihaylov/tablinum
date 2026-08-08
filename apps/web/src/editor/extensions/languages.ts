import { common, createLowlight } from 'lowlight';

export const lowlight = createLowlight(common);

/** Languages offered by the code block picker, in menu order. */
export const CODE_LANGUAGES: readonly string[] = Object.keys(common).sort();
