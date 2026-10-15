import { pl } from './pl';

type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

export type TranslationKey = Leaves<typeof pl>;
export type TranslationParams = Record<string, string | number>;

function lookup(key: string): string | undefined {
  let node: unknown = pl;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/** Translates a key; `{param}` placeholders are replaced. Unknown keys return the key (visible in tests). */
export function t(key: TranslationKey, params?: TranslationParams): string {
  const template = lookup(key) ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

/** For keys built at runtime (e.g. error codes); falls back to `fallback` when missing. */
export function tDynamic(key: string, fallback: string, params?: TranslationParams): string {
  const template = lookup(key);
  return template === undefined ? fallback : t(key as TranslationKey, params);
}
