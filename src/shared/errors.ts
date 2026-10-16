/**
 * Stable error codes (NFR09). Each code has a Polish message and a suggested action in the renderer dictionary
 * (`errors.<CODE>.message` / `errors.<CODE>.action`). Never rename a code: logs and stored jobs refer to them.
 */
export const APP_ERROR_CODES = [
  'BAD_REQUEST',
  'FORBIDDEN',
  'INTERNAL',
  'NOT_FOUND',
  'TMDB_NO_KEY',
  'TMDB_UNAUTHORIZED',
  'TMDB_UNAVAILABLE',
  'TMDB_BAD_RESPONSE',
  'TMDB_RATE_LIMITED',
  'SOURCE_TIMEOUT',
  'SOURCE_BAD_RESPONSE',
  'SOURCE_AUTH',
  'SOURCE_UNAVAILABLE',
  'ALL_SOURCES_FAILED',
  'JACKETT_UNAVAILABLE',
  'ENGINE_UNAVAILABLE',
  'ENGINE_CRASHED',
  'ENGINE_PROTOCOL_MISMATCH',
  'ENGINE_TIMEOUT',
  'ENGINE_ERROR',
  'DISK_FULL',
  'DISK_MISSING',
  'PATH_NOT_WRITABLE',
  'PATH_CONFLICT',
  'PATH_TOO_LONG',
  'UNSAFE_TORRENT_PATH',
  'INVALID_MAGNET',
  'INVALID_TORRENT',
  'TORRENT_TOO_LARGE',
  'METADATA_TIMEOUT',
  'NO_PEERS',
  'DUPLICATE_JOB',
  'JOB_NOT_FOUND',
  'FILE_MISSING',
  'SUBS_NOT_FOUND',
  'SUBS_QUOTA',
  'SUBS_AUTH',
  'SUBS_NO_KEY',
  'SUBS_UNAVAILABLE',
  'SUBS_BAD_FILE',
  'SECRETS_UNAVAILABLE',
  'UPDATE_FAILED',
  'TV_UNAUTHORIZED',
  'TV_RATE_LIMITED',
  'TV_PAIRING_BUSY',
  'TV_PAIRING_EXPIRED',
  'TV_PORT_IN_USE',
  'TV_NO_NETWORK',
  'TV_SERVER_FAILED',
  'TV_UNSUPPORTED_MEDIA',
  'TV_TRANSCODE_BUSY',
  'DEPLOY_TOOL_MISSING',
  'DEPLOY_PACKAGE_MISSING',
  'DEPLOY_CONNECT_FAILED',
  'DEPLOY_UNAUTHORIZED',
  'DEPLOY_TIMEOUT',
  'DEPLOY_INSTALL_FAILED',
  'DEPLOY_SIGNATURE_MISMATCH',
  'DEPLOY_NO_SPACE',
  'DEPLOY_CERTIFICATE',
  'DEPLOY_CANCELLED',
] as const;

export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

export interface AppErrorShape {
  code: AppErrorCode;
  message: string;
}

/** Error thrown in main and carried across IPC as `{ code, message }`. */
export class AppError extends Error {
  constructor(
    readonly code: AppErrorCode,
    message?: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message ?? code);
    this.name = 'AppError';
  }

  toShape(): AppErrorShape {
    return { code: this.code, message: this.message };
  }
}

export function isAppErrorCode(value: unknown): value is AppErrorCode {
  return typeof value === 'string' && (APP_ERROR_CODES as readonly string[]).includes(value);
}
