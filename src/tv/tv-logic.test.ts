import { afterEach, describe, expect, it } from 'vitest';
import { focus, move, register, resetFocusRegistry, score, select } from './focus';
import { errorText, t } from './i18n';
import { endsTextEntry, keyAction } from './keys';
import { cueAt, parseVtt } from './player/vtt';
import { normalizeServer } from './storage';

const box = (left: number, top: number, w = 100, h = 100) => ({
  left,
  top,
  right: left + w,
  bottom: top + h,
  cx: left + w / 2,
  cy: top + h / 2,
});

describe('spatial focus', () => {
  afterEach(() => {
    resetFocusRegistry();
    document.body.innerHTML = '';
  });

  it('scores only elements in the direction, preferring the same row', () => {
    const from = box(0, 0);
    expect(score(from, box(120, 0), 'right')).toBe(20);
    expect(score(from, box(-120, 0), 'right')).toBeNull();
    expect(score(from, box(120, 300), 'right')!).toBeGreaterThan(score(from, box(400, 0), 'right')!);
    expect(score(from, box(0, 150), 'down')).toBe(100);
    expect(score(from, box(0, -150), 'down')).toBeNull();
  });

  it('moves between elements, returns to the remembered item of a row and selects', () => {
    // happy-dom has no layout: give each element a fixed rectangle.
    const make = (id: string, left: number, top: number, group?: string, onSelect?: () => void) => {
      const el = document.createElement('div');
      el.tabIndex = -1;
      el.id = id;
      el.getBoundingClientRect = () => ({
        ...box(left, top),
        x: left,
        y: top,
        width: 100,
        height: 100,
        toJSON: () => ({}),
      });
      document.body.appendChild(el);
      register(el, { ...(group ? { group } : {}), ...(onSelect ? { onSelect } : {}) });
      return el;
    };
    let selected = '';
    const a = make('a', 0, 0, 'row1');
    const b = make('b', 120, 0, 'row1', () => (selected = 'b'));
    const c = make('c', 240, 0, 'row1');
    const d = make('d', 0, 200, 'row2');
    make('e', 120, 200, 'row2');
    focus(a);
    expect(move('right')).toBe(true);
    expect(document.activeElement).toBe(b);
    move('right');
    expect(document.activeElement).toBe(c);
    move('down');
    expect(document.activeElement?.id).toBe('e'); // nearest below c
    move('left');
    expect(document.activeElement).toBe(d);
    move('up');
    expect(document.activeElement).toBe(c); // back to where row 1 was left
    expect(move('up')).toBe(false);
    focus(b);
    expect(select()).toBe(true);
    expect(selected).toBe('b');
  });

  it('keeps focus inside an open dialog', () => {
    const outside = document.createElement('div');
    outside.getBoundingClientRect = () => ({
      ...box(0, 300),
      x: 0,
      y: 300,
      width: 100,
      height: 100,
      toJSON: () => ({}),
    });
    const trap = document.createElement('div');
    trap.setAttribute('data-focus-trap', '');
    const inside = document.createElement('div');
    inside.getBoundingClientRect = () => ({ ...box(0, 0), x: 0, y: 0, width: 100, height: 100, toJSON: () => ({}) });
    trap.appendChild(inside);
    document.body.append(outside, trap);
    for (const el of [outside, inside]) {
      el.tabIndex = -1;
      register(el, {});
    }
    focus(inside);
    expect(move('down')).toBe(false);
    expect(document.activeElement).toBe(inside);
  });
});

describe('remote keys', () => {
  it('maps Tizen and standard key codes', () => {
    expect(keyAction({ key: 'Unidentified', keyCode: 10009 })).toBe('back');
    expect(keyAction({ key: 'ArrowLeft', keyCode: 37 })).toBe('left');
    expect(keyAction({ key: 'Unidentified', keyCode: 10252 })).toBe('playPause');
    expect(keyAction({ key: 'MediaPlayPause', keyCode: 179 })).toBe('playPause');
    expect(keyAction({ key: 'a', keyCode: 65 })).toBeNull();
    expect(endsTextEntry({ key: 'Unidentified', keyCode: 65376 })).toBe(true);
    expect(endsTextEntry({ key: 'a', keyCode: 65 })).toBe(false);
  });
});

describe('PC address', () => {
  it('accepts an IP with or without port and scheme', () => {
    expect(normalizeServer('192.168.1.20')).toBe('http://192.168.1.20:18790');
    expect(normalizeServer(' 192.168.1.20:5000 ')).toBe('http://192.168.1.20:5000');
    expect(normalizeServer('http://10.0.0.2:18790/')).toBe('http://10.0.0.2:18790');
    for (const bad of ['', 'http://x/y', 'http://u:p@10.0.0.2', 'ftp://1.2.3.4', 'http://1.2.3.4/?a'])
      expect(normalizeServer(bad), bad).toBeNull();
  });
});

describe('subtitles', () => {
  it('parses WebVTT cues as plain text', () => {
    const cues = parseVtt(
      'WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.500\n<i>Zażółć</i> &amp; <b>gęślą</b>\n\n00:01:00.000 --> 00:01:01.000 align:start\nLater\n\nbroken\n',
    );
    expect(cues).toEqual([
      { start: 1000, end: 2500, text: 'Zażółć & gęślą' },
      { start: 60_000, end: 61_000, text: 'Later' },
    ]);
    expect(cueAt(cues, 1500)).toBe('Zażółć & gęślą');
    expect(cueAt(cues, 3000)).toBe('');
  });
});

describe('texts', () => {
  it('fills parameters and maps error codes', () => {
    expect(t('discover.results', { query: 'Dune' })).toBe('Results for “Dune”');
    expect(errorText('NETWORK')).toBe('Can’t reach your PC.');
    expect(errorText('WEIRD')).toContain('WEIRD');
  });
});
