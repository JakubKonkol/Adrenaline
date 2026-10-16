import type { Direction } from './focus';

export type KeyAction = Direction | 'select' | 'back' | 'playPause' | 'play' | 'pause' | 'stop' | 'forward' | 'rewind';

/** Tizen remote key codes (Samsung TV input device) and standard keys used by Android TV and browsers. */
const BY_CODE: Record<number, KeyAction> = {
  37: 'left',
  38: 'up',
  39: 'right',
  40: 'down',
  13: 'select',
  27: 'back',
  10009: 'back', // Tizen RETURN
  166: 'back', // BrowserBack
  10252: 'playPause', // Tizen MediaPlayPause
  179: 'playPause',
  415: 'play',
  19: 'pause',
  413: 'stop',
  178: 'stop',
  417: 'forward',
  228: 'forward',
  412: 'rewind',
  227: 'rewind',
};

const BY_KEY: Record<string, KeyAction> = {
  ArrowLeft: 'left',
  ArrowUp: 'up',
  ArrowRight: 'right',
  ArrowDown: 'down',
  Enter: 'select',
  Escape: 'back',
  GoBack: 'back',
  BrowserBack: 'back',
  MediaPlayPause: 'playPause',
  MediaPlay: 'play',
  MediaPause: 'pause',
  MediaStop: 'stop',
  MediaFastForward: 'forward',
  MediaRewind: 'rewind',
  MediaTrackNext: 'forward',
  MediaTrackPrevious: 'rewind',
};

export function keyAction(e: Pick<KeyboardEvent, 'key' | 'keyCode'>): KeyAction | null {
  return BY_KEY[e.key] ?? BY_CODE[e.keyCode] ?? null;
}

/** Keys that end text entry on a TV keyboard (Tizen IME "Done"/"Cancel", Enter, arrows up/down, Back). */
export function endsTextEntry(e: Pick<KeyboardEvent, 'key' | 'keyCode'>): boolean {
  return (
    e.keyCode === 65376 ||
    e.keyCode === 65385 ||
    ['Enter', 'ArrowUp', 'ArrowDown', 'Escape', 'GoBack'].includes(e.key) ||
    e.keyCode === 10009
  );
}
