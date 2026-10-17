/**
 * Player preferences this TV remembers (subtitle look, last chosen languages, picture fit), like Jellyfin's subtitle
 * settings. localStorage may be missing or throw: the defaults apply then.
 */
export type SubtitleSize = 'small' | 'normal' | 'large' | 'xlarge';
export type SubtitleBackground = 'box' | 'shadow';
export type PictureFit = 'fit' | 'fill';

export interface PlayerPrefs {
  subtitleSize: SubtitleSize;
  subtitleBackground: SubtitleBackground;
  /** Lift above the bottom edge, in percent of the screen height. */
  subtitlePosition: number;
  fit: PictureFit;
  /** Language of the last subtitle track chosen ('' = subtitles off, null = never chosen). */
  subtitleLang: string | null;
}

export const SUBTITLE_SIZES: SubtitleSize[] = ['small', 'normal', 'large', 'xlarge'];
export const SUBTITLE_POSITIONS = [4, 9, 15, 22];

const KEY = 'adrenaline.player.v1';
const DEFAULTS: PlayerPrefs = {
  subtitleSize: 'normal',
  subtitleBackground: 'box',
  subtitlePosition: 9,
  fit: 'fit',
  subtitleLang: null,
};

export function loadPrefs(): PlayerPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    const value = raw ? (JSON.parse(raw) as Partial<PlayerPrefs>) : {};
    return {
      subtitleSize: SUBTITLE_SIZES.includes(value.subtitleSize!) ? value.subtitleSize! : DEFAULTS.subtitleSize,
      subtitleBackground: value.subtitleBackground === 'shadow' ? 'shadow' : 'box',
      subtitlePosition: SUBTITLE_POSITIONS.includes(value.subtitlePosition!)
        ? value.subtitlePosition!
        : DEFAULTS.subtitlePosition,
      fit: value.fit === 'fill' ? 'fill' : 'fit',
      subtitleLang: typeof value.subtitleLang === 'string' ? value.subtitleLang.slice(0, 16) : null,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(prefs: PlayerPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* the defaults apply next time */
  }
}

/** Next value in a list, wrapping around (for left/right on a setting). */
export function cycle<T>(values: readonly T[], current: T, step: 1 | -1): T {
  const i = values.indexOf(current);
  return values[(Math.max(0, i) + step + values.length) % values.length]!;
}
