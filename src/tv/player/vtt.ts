export interface Cue {
  start: number;
  end: number;
  text: string;
}

function time(value: string): number | null {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/.exec(value.trim());
  if (!m) return null;
  const [, h, min, s, ms] = m;
  return (Number(h ?? 0) * 3600 + Number(min) * 60 + Number(s)) * 1000 + Number(ms!.padEnd(3, '0'));
}

/**
 * Minimal WebVTT parser for subtitles drawn by the app (AVPlay draws video on its own plane, so <track> is not an
 * option there). Tags like <i> are dropped; the text is later set with textContent, never as HTML.
 */
export function parseVtt(text: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [from, rest] = lines[i]!.split('-->') as [string, string];
    const start = time(from);
    const end = time(rest.trim().split(/\s+/)[0] ?? '');
    if (start === null || end === null || end <= start) continue;
    const body = lines
      .slice(i + 1)
      .join('\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .trim();
    if (body) cues.push({ start, end, text: body });
  }
  return cues.sort((a, b) => a.start - b.start);
}

/** Text shown at `ms` (overlapping cues joined). */
export function cueAt(cues: Cue[], ms: number): string {
  let out = '';
  for (const c of cues) {
    if (c.start > ms) break;
    if (c.end > ms) out = out ? `${out}\n${c.text}` : c.text;
  }
  return out;
}
