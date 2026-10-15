/**
 * Redaction for logs and diagnostics (D-23, BR05): tokens, API keys, passwords, magnets, registered secret values
 * and the user's home directory never leave the process in clear text.
 */
const secretValues = new Set<string>();

/** Registers a secret value (API key, token, password) so every later log line masks it. */
export function registerSecret(value: string | null | undefined): void {
  if (value && value.length >= 4) secretValues.add(value);
}

export function clearRegisteredSecrets(): void {
  secretValues.clear();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const PATTERNS: [RegExp, string][] = [
  [/magnet:\?[^\s"'<>]+/gi, 'magnet:?<redacted>'],
  [/\b(Api-Key|X-Api-Key|Authorization):\s*(?:(?:Bearer|Basic)\s+)?\S+/gi, '$1: <redacted>'],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/g, '$1 <redacted>'],
  [/\b(api[_-]?key|apikey|token|access_token|password|passkey|secret)=([^&\s"']+)/gi, '$1=<redacted>'],
  [/("(?:api[_-]?key|apikey|token|password|passkey|secret)"\s*:\s*")([^"]*)(")/gi, '$1<redacted>$3'],
];

export interface RedactOptions {
  /** Home directory to replace with `~` (C:\Users\<name> on Windows). */
  homeDir?: string | undefined;
}

export function redact(text: string, opts: RedactOptions = {}): string {
  let out = text;
  for (const value of secretValues) out = out.split(value).join('<secret>');
  for (const [re, replacement] of PATTERNS) out = out.replace(re, replacement);
  if (opts.homeDir && opts.homeDir.length > 3) {
    const variants = new Set([opts.homeDir, opts.homeDir.replace(/\\/g, '/'), opts.homeDir.replace(/\//g, '\\')]);
    for (const v of variants) out = out.replace(new RegExp(escapeRegExp(v), 'gi'), '~');
  }
  // Other users' profile folders keep only the structure.
  out = out.replace(/([A-Za-z]:[\\/]Users[\\/])[^\\/\s"']+/gi, '$1<user>');
  out = out.replace(/(\/home\/)[^/\s"']+/g, '$1<user>');
  return out;
}
