/** Reads a response body up to `maxBytes`; returns null when it is larger (checked while streaming). */
export async function readBodyLimited(response: Response, maxBytes: number): Promise<Buffer | null> {
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel();
    return null;
  }
  const reader = response.body?.getReader() as ReadableStreamDefaultReader<Uint8Array> | undefined;
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
