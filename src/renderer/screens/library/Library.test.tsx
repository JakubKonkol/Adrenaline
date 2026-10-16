import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router';
import type { LibraryItem } from '@shared/contracts/library';
import { episodeCode, groupShows, Library } from './Library';

const success = <T,>(data: T) => ({ ok: true as const, data });

function item(id: string, patch: Partial<LibraryItem> = {}): LibraryItem {
  return {
    id: `${id}~0`,
    jobId: id,
    kind: 'movie',
    tmdbId: 1,
    title: `Movie ${id}`,
    year: 2020,
    season: null,
    episode: null,
    episodeTitle: null,
    posterPath: null,
    fileName: `${id}.mkv`,
    sizeBytes: 1024 * 1024,
    completedAt: 1,
    subtitles: [],
    available: true,
    ...patch,
  };
}

const episode = (id: string, season: number, ep: number) =>
  item(id, { kind: 'episode', tmdbId: 9, title: 'Show', season, episode: ep, episodeTitle: `Ep ${ep}` });

const list = vi.fn();
const play = vi.fn();
const remove = vi.fn();

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: '/library', element: <Library /> }], { initialEntries: ['/library'] });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  play.mockResolvedValue(success(undefined));
  remove.mockResolvedValue(success(undefined));
  Object.defineProperty(window, 'adrenaline', {
    configurable: true,
    value: {
      library: { list, play, remove, showInFolder: vi.fn().mockResolvedValue(success(undefined)) },
      events: { on: () => () => undefined },
    },
  });
});
afterEach(cleanup);

describe('Library screen', () => {
  it('groups episodes by show in season order', () => {
    const shows = groupShows([episode('b', 1, 3), item('m'), episode('a', 1, 1)]);
    expect(shows).toHaveLength(1);
    expect(shows[0]!.episodes.map(episodeCode)).toEqual(['S01E01', 'S01E03']);
  });

  it('shows the empty state', async () => {
    list.mockResolvedValue(success([]));
    mount();
    expect(await screen.findByTestId('library-empty')).toBeTruthy();
  });

  it('plays a movie and disables missing files', async () => {
    list.mockResolvedValue(success([item('a'), item('gone', { available: false }), episode('e', 1, 2)]));
    mount();
    const card = await screen.findByTestId('library-a~0');
    fireEvent.click(within(card).getByRole('button', { name: 'Play Movie a' }));
    await waitFor(() => expect(play).toHaveBeenCalledWith({ id: 'a~0' }));
    const missing = screen.getByTestId('library-gone~0');
    expect(within(missing).getByText('File missing')).toBeTruthy();
    expect(within(missing).getByRole<HTMLButtonElement>('button', { name: 'Play Movie gone' }).disabled).toBe(true);
    expect(within(screen.getByTestId('library-e~0')).getByText('S01E02')).toBeTruthy();
  });

  it('removes an item, keeping the files unless asked', async () => {
    list.mockResolvedValue(success([item('a')]));
    mount();
    const card = await screen.findByTestId('library-a~0');
    fireEvent.click(within(card).getByRole('button', { name: 'Remove from library' }));
    const dialog = await screen.findByTestId('library-remove-dialog');
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith({ id: 'a~0', deleteFiles: true }));
  });
});
