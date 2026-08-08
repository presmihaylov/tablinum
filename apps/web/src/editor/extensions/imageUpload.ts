import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

export interface ImageUploadOptions {
  /** Uploads one file and resolves to its URL, or null when the upload failed. */
  upload: (file: File) => Promise<string | null>;
}

export const imageUploadPluginKey = new PluginKey('gitdocsImageUpload');

const IMAGE_TYPE = /^image\//;

/** Drops and pastes of image files become uploads, then an image node at the drop point. */
export const ImageUpload = Extension.create<ImageUploadOptions>({
  name: 'gitdocsImageUpload',

  addOptions() {
    return { upload: () => Promise.resolve(null) };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    const options = this.options;

    const insert = (files: File[], at: number | null): void => {
      for (const file of files) {
        void options.upload(file).then((url) => {
          if (!url) return;
          const attrs = { src: url, alt: file.name, title: null };
          const chain = editor.chain().focus();
          if (at === null) chain.insertContent({ type: 'image', attrs }).run();
          if (at !== null) chain.insertContentAt(at, { type: 'image', attrs }).run();
        });
      }
    };

    return [
      new Plugin({
        key: imageUploadPluginKey,
        props: {
          handlePaste: (_view, event) => {
            const files = imageFiles(event.clipboardData);
            if (files.length === 0) return false;
            event.preventDefault();
            insert(files, null);
            return true;
          },
          handleDrop: (view, event, _slice, moved) => {
            if (moved) return false;
            const files = imageFiles(event.dataTransfer);
            if (files.length === 0) return false;
            event.preventDefault();
            const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
            insert(files, at?.pos ?? null);
            return true;
          },
        },
      }),
    ];
  },
});

function imageFiles(source: DataTransfer | null): File[] {
  if (!source) return [];
  return Array.from(source.files).filter((file) => IMAGE_TYPE.test(file.type));
}

export default ImageUpload;
