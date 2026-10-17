import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { AppError } from '@shared/errors';

// Official Android SDK Platform-Tools, pinned. The SHA-1 published in Google's repository catalogue
// (https://dl.google.com/android/repository/repository2-3.xml) matches this archive; we pin its SHA-256.
export const PLATFORM_TOOLS = {
  file: 'platform-tools_r37.0.1-win.zip',
  sha256: '45f4d63113e895ebde0c90f194099a4676b6ac653bd28d54314a9e022bbc1a99',
} as const;

/** adb and the two DLLs it loads on Windows; nothing else from the archive is extracted. */
const FILES = ['adb.exe', 'AdbWinApi.dll', 'AdbWinUsbApi.dll'];

/**
 * adb for Deploy to TV without an Android SDK on the PC (like the automatic Samsung tools): the official archive is
 * downloaded once (~8 MB), checked against the pinned checksum and kept in userData/tv-deploy/tools.
 */
export async function prepareAutomaticAdb(
  cacheDir: string,
  signal: AbortSignal,
  download: typeof fetch = fetch,
): Promise<string> {
  await mkdir(cacheDir, { recursive: true });
  const path = join(cacheDir, PLATFORM_TOOLS.file);
  const valid = (b: Uint8Array | null) => b && createHash('sha256').update(b).digest('hex') === PLATFORM_TOOLS.sha256;
  let bytes: Uint8Array | null = await readFile(path).catch(() => null);
  if (!valid(bytes)) {
    signal.throwIfAborted();
    const response = await download(`https://dl.google.com/android/repository/${PLATFORM_TOOLS.file}`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
    });
    if (!response.ok) throw new AppError('DEPLOY_TOOL_MISSING', `Android tools download: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (!valid(bytes)) throw new AppError('DEPLOY_PACKAGE_MISSING', 'Android tools checksum mismatch');
    await writeFile(`${path}.tmp`, bytes);
    await rename(`${path}.tmp`, path);
  }
  signal.throwIfAborted();
  const archive = unzipSync(bytes!, { filter: (f) => FILES.some((name) => f.name === `platform-tools/${name}`) });
  const dir = join(cacheDir, 'platform-tools');
  await mkdir(dir, { recursive: true });
  for (const name of FILES) {
    const content = archive[`platform-tools/${name}`];
    if (!content) throw new AppError('DEPLOY_PACKAGE_MISSING', name);
    const target = join(dir, name);
    // A running adb server keeps its executable open: only replace a file that changed.
    const existing = await readFile(target).catch(() => null);
    if (!existing?.equals(Buffer.from(content))) await writeFile(target, content);
  }
  return join(dir, 'adb.exe');
}
