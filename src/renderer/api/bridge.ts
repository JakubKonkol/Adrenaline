import type { IpcResult } from '@shared/contracts/ipc';
import type { AppErrorShape } from '@shared/errors';

/** Error thrown by `unwrap` in the renderer; carries the stable code for `errors.<CODE>` messages. */
export class ApiError extends Error {
  constructor(readonly shape: AppErrorShape) {
    super(shape.message);
    this.name = 'ApiError';
  }
  get code() {
    return this.shape.code;
  }
}

export async function unwrap<T>(promise: Promise<IpcResult<T>>): Promise<T> {
  const result = await promise;
  if (!result.ok) throw new ApiError(result.error);
  return result.data;
}

export const api = () => window.adrenaline;
