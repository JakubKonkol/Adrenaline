/** Subtitle languages (ISO 639-1) with English names, in the order shown in the UI. */
export const SUBTITLE_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'pl', name: 'Polish' },
  { code: 'de', name: 'German' },
  { code: 'fr', name: 'French' },
  { code: 'es', name: 'Spanish' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'nl', name: 'Dutch' },
  { code: 'cs', name: 'Czech' },
  { code: 'sk', name: 'Slovak' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'ru', name: 'Russian' },
  { code: 'hu', name: 'Hungarian' },
  { code: 'ro', name: 'Romanian' },
  { code: 'bg', name: 'Bulgarian' },
  { code: 'hr', name: 'Croatian' },
  { code: 'sr', name: 'Serbian' },
  { code: 'sl', name: 'Slovenian' },
  { code: 'lt', name: 'Lithuanian' },
  { code: 'lv', name: 'Latvian' },
  { code: 'et', name: 'Estonian' },
  { code: 'fi', name: 'Finnish' },
  { code: 'sv', name: 'Swedish' },
  { code: 'no', name: 'Norwegian' },
  { code: 'da', name: 'Danish' },
  { code: 'el', name: 'Greek' },
  { code: 'tr', name: 'Turkish' },
  { code: 'he', name: 'Hebrew' },
  { code: 'ar', name: 'Arabic' },
  { code: 'hi', name: 'Hindi' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'zh', name: 'Chinese' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'th', name: 'Thai' },
  { code: 'id', name: 'Indonesian' },
] as const;

export type LanguageCode = (typeof SUBTITLE_LANGUAGES)[number]['code'];

export const LANGUAGE_CODES = SUBTITLE_LANGUAGES.map((l) => l.code) as [LanguageCode, ...LanguageCode[]];

export function languageName(code: string): string {
  return SUBTITLE_LANGUAGES.find((l) => l.code === code)?.name ?? code;
}
