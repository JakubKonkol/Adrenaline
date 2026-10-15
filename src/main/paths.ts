import { join } from 'node:path';
import { app } from 'electron';

const here = import.meta.dirname;

/** Paths of the built app (out/main, out/preload, out/renderer) and of the dev server, if any. */
export const appPaths = {
  preload: join(here, '../preload/index.cjs'),
  rendererIndex: join(here, '../renderer/index.html'),
  devRendererUrl(): string | null {
    const url = process.env['ELECTRON_RENDERER_URL'];
    return !app.isPackaged && url ? url : null;
  },
};
