import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { AppError } from '@shared/errors';

// Official Tizen Studio package catalogue, pinned rather than executing a downloaded installer.
// https://download.tizen.org/sdk/tizenstudio/official/pkg_list_windows-64
export const TIZEN_PACKAGES = {
  sdb: {
    file: 'sdb_4.2.36_windows-64.zip',
    sha256: '829c504db12ce3e9a598a457762a030d606836cec916c45438623618fc94333c',
  },
  certificates: {
    file: 'certificate-generator_0.1.4_windows-64.zip',
    sha256: '87e812545fc0495e3f2673c54d0a1aa02e5598a19ab7770a70117fb4a50f0590',
  },
} as const;

export interface AutomaticTizenTools {
  sdb: string;
  certificates: Record<string, Uint8Array>;
}

export async function prepareAutomaticTizen(
  cacheDir: string,
  signal: AbortSignal,
  download: typeof fetch = fetch,
): Promise<AutomaticTizenTools> {
  await mkdir(cacheDir, { recursive: true });
  const archives: Record<string, Uint8Array> = {};
  for (const [name, pkg] of Object.entries(TIZEN_PACKAGES)) {
    signal.throwIfAborted();
    const path = join(cacheDir, pkg.file);
    let bytes = await readFile(path).catch(() => null);
    const valid = (b: Uint8Array | null) => b && createHash('sha256').update(b).digest('hex') === pkg.sha256;
    if (!valid(bytes)) {
      const response = await download(`https://download.tizen.org/sdk/tizenstudio/official/binary/${pkg.file}`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
      });
      if (!response.ok) throw new AppError('DEPLOY_TOOL_MISSING', `Tizen tools download: HTTP ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
      if (!valid(bytes)) throw new AppError('DEPLOY_PACKAGE_MISSING', 'Tizen tools checksum mismatch');
      await writeFile(`${path}.tmp`, bytes);
      await rename(`${path}.tmp`, path);
    }
    archives[name] = bytes!;
  }
  signal.throwIfAborted();
  const sdb = unzipSync(archives['sdb']!);
  // Extract only the executable at a fixed path; never execute the archive's installation scripts.
  const executable = sdb['data/tools/sdb.exe'];
  if (!executable) throw new AppError('DEPLOY_PACKAGE_MISSING');
  const path = join(cacheDir, 'sdb.exe');
  // An sdb server may still hold the executable from the previous installation.
  const existing = await readFile(path).catch(() => null);
  if (!existing?.equals(Buffer.from(executable))) await writeFile(path, executable);
  return { sdb: path, certificates: unzipSync(archives['certificates']!) };
}
