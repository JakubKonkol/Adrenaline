const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** "1,2 GB" (Polish decimal comma, 1024-based, like Windows Explorer). */
export function formatBytes(bytes: number | null | undefined): string | null {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return null;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits).replace('.', ',')} ${UNITS[unit]}`;
}

/** "przed chwilą", "5 min temu", "3 godz. temu", "2 dni temu". */
export function formatAgo(timestamp: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - timestamp) / 1000));
  if (s < 60) return 'przed chwilą';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min temu`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} godz. temu`;
  const d = Math.round(h / 24);
  return d === 1 ? 'wczoraj' : `${d} dni temu`;
}

/** "1,2 MB/s". */
export function formatRate(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond) ?? '0 B'}/s`;
}

/** "45 s", "4 min", "2 godz. 5 min", "3 dni". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 ? `${h} godz. ${m % 60} min` : `${h} godz.`;
  return `${Math.round(h / 24)} dni`;
}
