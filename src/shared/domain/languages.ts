/** Subtitle languages (ISO 639-1) with Polish names, in the order shown in the UI. */
export const SUBTITLE_LANGUAGES = [
  { code: 'pl', name: 'polski' },
  { code: 'en', name: 'angielski' },
  { code: 'de', name: 'niemiecki' },
  { code: 'fr', name: 'francuski' },
  { code: 'es', name: 'hiszpański' },
  { code: 'it', name: 'włoski' },
  { code: 'pt', name: 'portugalski' },
  { code: 'nl', name: 'niderlandzki' },
  { code: 'cs', name: 'czeski' },
  { code: 'sk', name: 'słowacki' },
  { code: 'uk', name: 'ukraiński' },
  { code: 'ru', name: 'rosyjski' },
  { code: 'hu', name: 'węgierski' },
  { code: 'ro', name: 'rumuński' },
  { code: 'bg', name: 'bułgarski' },
  { code: 'hr', name: 'chorwacki' },
  { code: 'sr', name: 'serbski' },
  { code: 'sl', name: 'słoweński' },
  { code: 'lt', name: 'litewski' },
  { code: 'lv', name: 'łotewski' },
  { code: 'et', name: 'estoński' },
  { code: 'fi', name: 'fiński' },
  { code: 'sv', name: 'szwedzki' },
  { code: 'no', name: 'norweski' },
  { code: 'da', name: 'duński' },
  { code: 'el', name: 'grecki' },
  { code: 'tr', name: 'turecki' },
  { code: 'he', name: 'hebrajski' },
  { code: 'ar', name: 'arabski' },
  { code: 'hi', name: 'hindi' },
  { code: 'ja', name: 'japoński' },
  { code: 'ko', name: 'koreański' },
  { code: 'zh', name: 'chiński' },
  { code: 'vi', name: 'wietnamski' },
  { code: 'th', name: 'tajski' },
  { code: 'id', name: 'indonezyjski' },
] as const;

export type LanguageCode = (typeof SUBTITLE_LANGUAGES)[number]['code'];

export const LANGUAGE_CODES = SUBTITLE_LANGUAGES.map((l) => l.code) as [LanguageCode, ...LanguageCode[]];

export function languageName(code: string): string {
  return SUBTITLE_LANGUAGES.find((l) => l.code === code)?.name ?? code;
}
