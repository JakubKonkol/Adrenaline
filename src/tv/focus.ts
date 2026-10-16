/**
 * Spatial navigation for the remote (D-pad). Focusable elements register here; arrows move to the nearest element in
 * that direction. Rows remember their last focused item, so going up and down between rows returns to where the user
 * was (like Apple TV). A modal marks itself with `data-focus-trap`: focus stays inside it.
 */
export type Direction = 'up' | 'down' | 'left' | 'right';

export interface FocusMeta {
  onSelect?: () => void;
  /** Elements of one row/list share a group; entering the group restores its last focused element. */
  group?: string;
}

const registry = new Map<HTMLElement, FocusMeta>();
const memory = new Map<string, HTMLElement>();
/** Focus key to restore when its element appears (data loaded after going back to a screen). */
let pendingKey: string | null = null;

export function setPendingFocus(key: string | null): void {
  pendingKey = key;
}

/**
 * Registers an element. Content that loads later still gets focus: the element remembered for this screen, or a
 * `data-autofocus` element when nothing is focused yet.
 */
export function register(el: HTMLElement, meta: FocusMeta): () => void {
  registry.set(el, meta);
  if (pendingKey && el.dataset['focusKey'] === pendingKey) {
    pendingKey = null;
    focus(el);
  } else if (el.hasAttribute('data-autofocus') && !current() && inScope(el)) {
    focus(el);
  }
  return () => {
    registry.delete(el);
    if (meta.group && memory.get(meta.group) === el) memory.delete(meta.group);
  };
}

export function update(el: HTMLElement, meta: FocusMeta): void {
  if (registry.has(el)) registry.set(el, meta);
}

function visible(el: HTMLElement): boolean {
  if (!el.isConnected) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/** The topmost modal, if any: focus may not leave it. */
function activeTrap(): Element | null {
  const traps = document.querySelectorAll('[data-focus-trap]');
  return traps.length ? (traps[traps.length - 1] ?? null) : null;
}

function inScope(el: HTMLElement): boolean {
  const trap = activeTrap();
  return !trap || trap.contains(el);
}

export function current(): HTMLElement | null {
  const el = document.activeElement as HTMLElement | null;
  return el && registry.has(el) ? el : null;
}

/** Keeps the focused element in view: horizontally inside its row, vertically inside the scrolling page. */
function reveal(el: HTMLElement): void {
  const row = el.closest<HTMLElement>('[data-row]');
  if (row) {
    const pad = row.clientWidth * 0.06;
    const left = el.offsetLeft;
    const right = left + el.offsetWidth;
    if (right > row.scrollLeft + row.clientWidth - pad) row.scrollLeft = right - row.clientWidth + pad;
    else if (left < row.scrollLeft + pad) row.scrollLeft = Math.max(0, left - pad);
  }
  const page = el.closest<HTMLElement>('[data-page]');
  if (page) {
    const r = el.getBoundingClientRect();
    const p = page.getBoundingClientRect();
    if (r.top < p.top + p.height * 0.12 || r.bottom > p.bottom - p.height * 0.08) {
      page.scrollTop = Math.max(0, page.scrollTop + (r.top - p.top) - p.height * 0.28);
    }
  }
}

export function focus(el: HTMLElement | null | undefined): boolean {
  if (!el || !visible(el)) return false;
  el.focus({ preventScroll: true });
  reveal(el);
  const group = registry.get(el)?.group;
  if (group) memory.set(group, el);
  return true;
}

/** First element to focus on a new screen: `data-autofocus`, else the first visible focusable in scope. */
export function focusFirst(root: Element | Document = document): boolean {
  const auto = root.querySelector<HTMLElement>('[data-autofocus]');
  if (auto && registry.has(auto) && inScope(auto) && focus(auto)) return true;
  for (const el of registry.keys()) if (inScope(el) && root.contains(el) && focus(el)) return true;
  return false;
}

export function focusKey(key: string): boolean {
  const el = document.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(key)}"]`);
  return el ? focus(el) : false;
}

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
  cx: number;
  cy: number;
}

function box(el: HTMLElement): Box {
  const r = el.getBoundingClientRect();
  return {
    left: r.left,
    right: r.right,
    top: r.top,
    bottom: r.bottom,
    cx: (r.left + r.right) / 2,
    cy: (r.top + r.bottom) / 2,
  };
}

/** Distance score of `to` from `from` in a direction, or null when it is not in that direction. */
export function score(from: Box, to: Box, dir: Direction): number | null {
  const tol = 2;
  let primary: number;
  let secondary: number;
  if (dir === 'right' || dir === 'left') {
    primary = dir === 'right' ? to.left - from.right : from.left - to.right;
    if ((dir === 'right' ? to.cx <= from.cx : to.cx >= from.cx) || primary < -tol - (from.right - from.left) / 2)
      return null;
    const overlap = Math.min(from.bottom, to.bottom) - Math.max(from.top, to.top);
    secondary = overlap > 0 ? 0 : Math.abs(to.cy - from.cy);
    return Math.max(0, primary) + secondary * 3;
  }
  primary = dir === 'down' ? to.top - from.bottom : from.top - to.bottom;
  if ((dir === 'down' ? to.cy <= from.cy : to.cy >= from.cy) || primary < -tol - (from.bottom - from.top) / 2)
    return null;
  const overlap = Math.min(from.right, to.right) - Math.max(from.left, to.left);
  secondary = overlap > 0 ? 0 : Math.abs(to.cx - from.cx);
  return Math.max(0, primary) * 2 + secondary;
}

export function move(dir: Direction): boolean {
  const from = current();
  if (!from) return focusFirst();
  const fromBox = box(from);
  const fromGroup = registry.get(from)?.group;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of registry.keys()) {
    if (el === from || !inScope(el) || !visible(el)) continue;
    const s = score(fromBox, box(el), dir);
    if (s !== null && s < bestScore) {
      best = el;
      bestScore = s;
    }
  }
  if (!best) return false;
  // Entering another row: go back to the item focused there last time.
  const group = registry.get(best)?.group;
  if (group && group !== fromGroup && (dir === 'up' || dir === 'down')) {
    const remembered = memory.get(group);
    if (remembered && remembered !== from && registry.has(remembered) && visible(remembered)) best = remembered;
  }
  return focus(best);
}

export function select(): boolean {
  const el = current();
  const handler = el ? registry.get(el)?.onSelect : undefined;
  if (!handler) return false;
  handler();
  return true;
}

/** Test helper. */
export function resetFocusRegistry(): void {
  registry.clear();
  memory.clear();
}
