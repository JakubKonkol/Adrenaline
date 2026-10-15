import { AppError, type AppErrorCode } from '@shared/errors';

/** Engine error codes (02-protokol-silnika.md) → stable app codes shown in the UI. */
const MAP: Record<string, AppErrorCode> = {
  BAD_REQUEST: 'ENGINE_ERROR',
  UNKNOWN_OP: 'ENGINE_PROTOCOL_MISMATCH',
  JOB_NOT_FOUND: 'JOB_NOT_FOUND',
  JOB_EXISTS_DIFFERENT_HASH: 'DUPLICATE_JOB',
  INVALID_MAGNET: 'INVALID_MAGNET',
  INVALID_TORRENT: 'INVALID_TORRENT',
  METADATA_TIMEOUT: 'METADATA_TIMEOUT',
  DISK_FULL: 'DISK_FULL',
  DISK_ERROR: 'DISK_MISSING',
  PATH_ERROR: 'PATH_NOT_WRITABLE',
  INTERNAL: 'ENGINE_ERROR',
};

export function mapEngineErrorCode(code: string, reason?: string): AppErrorCode {
  if (code === 'DISK_ERROR' && reason === 'disk_full') return 'DISK_FULL';
  return MAP[code] ?? 'ENGINE_ERROR';
}

/** Error returned by the engine for a request (`ok: false`). */
export class EngineRequestError extends Error {
  constructor(
    readonly engineCode: string,
    message: string,
  ) {
    super(message);
    this.name = 'EngineRequestError';
  }

  toAppError(): AppError {
    return new AppError(mapEngineErrorCode(this.engineCode), this.message);
  }
}
