import type { ReactNode } from 'react';

/**
 * Pieces of the on-screen display of the player (Jellyfin-style OSD): icons, the scrubber, the side sheet with track
 * lists and settings, and the playback info panel. Pure presentation: the player screen owns focus and keys.
 */

const ICONS: Record<string, ReactNode> = {
  play: <path d="M8 5.5v13l11-6.5z" />,
  pause: <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />,
  rewind: (
    <>
      <path d="M12 5V2L7 6l5 4V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z" />
      <text x="12" y="16.2" textAnchor="middle" fontSize="6.5" fontWeight="700">
        10
      </text>
    </>
  ),
  forward: (
    <>
      <path d="M12 5V2l5 4-5 4V7a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8z" />
      <text x="12" y="16.2" textAnchor="middle" fontSize="6.5" fontWeight="700">
        30
      </text>
    </>
  ),
  next: <path d="M6 6l8.5 6L6 18zM16 6h2v12h-2z" />,
  subtitles: (
    <path d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm1 2v10h14V7zm2 6h4v2H7zm6 0h4v2h-4zm-6-3h10v2H7z" />
  ),
  audio: (
    <path d="M4 9v6h4l5 4V5L8 9zm11.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM13 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z" />
  ),
  settings: (
    <path d="M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3h-4l-.4 2.6a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1L11 21h4l.4-2.6a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" />
  ),
};

export function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg className="osd-icon" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      {ICONS[name]}
    </svg>
  );
}

export function OsdButton({ icon, label, focused }: { icon: string; label: string; focused: boolean }) {
  return (
    <div className={`osd-button ${focused ? 'is-focused' : ''}`} role="button" aria-label={label}>
      <Icon name={icon} />
      {focused ? <span className="osd-button-label">{label}</span> : null}
    </div>
  );
}

/** Progress of the film; while scrubbing, the thumb shows the target and its time. */
export function Scrubber({
  time,
  duration,
  preview,
  focused,
  format,
}: {
  time: number;
  duration: number | null;
  preview: number | null;
  focused: boolean;
  format: (ms: number) => string;
}) {
  const at = preview ?? time;
  const pct = duration ? Math.max(0, Math.min(100, (at / duration) * 100)) : 0;
  const played = duration ? Math.max(0, Math.min(100, (time / duration) * 100)) : 0;
  return (
    <div className={`scrubber ${focused ? 'is-focused' : ''}`}>
      <div className="scrubber-track">
        <div className="scrubber-played" style={{ width: `${played}%` }} />
        {preview !== null ? <div className="scrubber-preview" style={{ width: `${pct}%` }} /> : null}
        <div className="scrubber-thumb" style={{ left: `${pct}%` }}>
          {preview !== null ? <span className="scrubber-bubble">{format(preview)}</span> : null}
        </div>
      </div>
    </div>
  );
}

export interface SheetItem {
  label: string;
  /** Current value of a setting (changed with left/right). */
  value?: string;
  selected?: boolean;
  /** A section title inside the list (not focusable). */
  heading?: boolean;
  hint?: string;
}

/** Side sheet with a title and a list (tracks, settings). `row` is the focused item. */
export function Sheet({ title, items, row }: { title: string; items: SheetItem[]; row: number }) {
  // Keep the focused row in view without scrolling APIs (old Chromium on TVs): show a window around it.
  const size = 9;
  const start = Math.max(0, Math.min(row - Math.floor(size / 2), items.length - size));
  return (
    <div className="sheet" role="listbox" aria-label={title}>
      <h3 className="sheet-title">{title}</h3>
      {items.slice(start, start + size).map((item, i) => {
        const index = start + i;
        if (item.heading)
          return (
            <div key={index} className="sheet-heading">
              {item.label}
            </div>
          );
        return (
          <div
            key={index}
            className={`sheet-item ${index === row ? 'is-focused' : ''}`}
            role="option"
            aria-selected={!!item.selected}
          >
            <span className="sheet-check">{item.selected ? '✓' : ''}</span>
            <span className="sheet-label">
              {item.label}
              {item.hint ? <span className="sheet-hint">{item.hint}</span> : null}
            </span>
            {item.value !== undefined ? <span className="sheet-value">‹ {item.value} ›</span> : null}
          </div>
        );
      })}
    </div>
  );
}

/** Playback info (Jellyfin's "Playback Info"): what the file is, what the TV gets and why. */
export function Stats({ rows }: { rows: [string, string][] }) {
  return (
    <div className="stats">
      {rows.map(([k, v]) => (
        <div key={k} className="stats-row">
          <span className="stats-key">{k}</span>
          <span className="stats-value">{v}</span>
        </div>
      ))}
    </div>
  );
}
