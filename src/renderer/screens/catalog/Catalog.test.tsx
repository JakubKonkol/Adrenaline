import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, Link, Outlet, RouterProvider } from 'react-router';
import type { AdrenalineApi } from '@shared/contracts/api';
import type { CatalogItem, TitleDetails, SeasonDetails } from '@shared/contracts/catalog';
import { Home } from '../Home';
import { Details } from './Details';
import { Season } from './Season';
import { Releases } from './Releases';

const movie: CatalogItem = {
  type: 'movie',
  tmdbId: 10331,
  title: 'Noc żywych trupów',
  originalTitle: 'Night of the Living Dead',
  year: 1968,
  posterPath: '/fixture1968.jpg',
  overview: 'Testowy opis',
  popularity: 25,
};
const show: TitleDetails = {
  ...movie,
  type: 'tv',
  tmdbId: 900001,
  title: 'Przygody Adrenaliny',
  originalTitle: 'Adrenaline Adventures',
  year: 2024,
  posterPath: null,
  imdbId: null,
  genres: ['Przygodowy'],
  runtime: 25,
  seasons: [{ number: 1, name: 'Sezon pierwszy', episodeCount: 2 }],
};
const season: SeasonDetails = {
  tmdbId: 900001,
  number: 1,
  name: 'Sezon pierwszy',
  episodes: [
    { tmdbId: 900003, number: 1, season: 1, title: 'Początek podróży', airDate: '2024-01-01', overview: '' },
    { tmdbId: 900004, number: 2, season: 1, title: 'Nowy szlak', airDate: null, overview: '' },
  ],
};
const success = <T,>(data: T) => ({ ok: true as const, data });
const search = vi.fn<AdrenalineApi['catalog']['search']>();
const details = vi.fn<AdrenalineApi['catalog']['details']>();
const getSeason = vi.fn<AdrenalineApi['catalog']['season']>();
const select = vi.fn<AdrenalineApi['catalog']['select']>();
const secrets = vi.fn<AdrenalineApi['settings']['secretsStatus']>();
const clients: QueryClient[] = [];
const routers: ReturnType<typeof createMemoryRouter>[] = [];

function mount(path = '/') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  clients.push(client);
  const router = createMemoryRouter(
    [
      {
        element: (
          <>
            <nav>
              <Link to="/downloads">Pobrane</Link>
            </nav>
            <Outlet />
          </>
        ),
        children: [
          { path: '/', element: <Home /> },
          { path: '/title/:type/:id', element: <Details /> },
          { path: '/title/tv/:id/season/:n', element: <Season /> },
          { path: '/releases', element: <Releases /> },
          { path: '/downloads', element: <h1>Lista pobrań</h1> },
          { path: '/settings', element: <h1>Ustawienia kont</h1> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  routers.push(router);
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

beforeEach(() => {
  vi.resetAllMocks();
  secrets.mockResolvedValue(
    success({
      encryptionAvailable: true,
      set: { 'tmdb.token': true, 'opensubtitles.apiKey': false, 'opensubtitles.password': false },
    }),
  );
  search.mockResolvedValue(success([movie, { ...movie, tmdbId: 19185, year: 1990, posterPath: '/fixture1990.jpg' }]));
  details.mockResolvedValue(success(show));
  getSeason.mockResolvedValue(success(season));
  select.mockResolvedValue(
    success({
      kind: 'episode',
      tmdbId: 900001,
      title: show.title,
      originalTitle: show.originalTitle,
      year: 2024,
      season: 1,
      episode: 2,
    }),
  );
  // Only this screen's IPC surface is used; nothing contacts a real provider.
  Object.defineProperty(window, 'adrenaline', {
    configurable: true,
    value: {
      catalog: { search, details, season: getSeason, select },
      settings: { secretsStatus: secrets },
      // Stage 5: the releases screen starts a search; no source is enabled here.
      releases: {
        startSearch: vi.fn().mockResolvedValue(success({ sessionId: 's1' })),
        session: vi.fn().mockResolvedValue(success(null)),
      },
      events: { on: () => () => undefined },
    },
  });
});
afterEach(() => {
  cleanup();
  routers.splice(0).forEach((router) => router.dispose());
  clients.splice(0).forEach((client) => client.clear());
});

describe('catalog screens', () => {
  it('shows different years and posters, supports keyboard navigation and movie filter', async () => {
    mount('/?q=Night');
    const first = await screen.findByRole('link', { name: /1968/ });
    const second = screen.getByRole('link', { name: /1990/ });
    expect(first.querySelector('img')?.src).not.toBe(second.querySelector('img')?.src);
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(second);
    fireEvent.click(screen.getByRole('button', { name: 'Filmy' }));
    await waitFor(() => expect(search).toHaveBeenLastCalledWith({ query: 'Night', type: 'movie' }));
  });

  it('debounces input and submits immediately with Enter/form submit', async () => {
    mount();
    await screen.findByText('Zacznij od tytułu filmu lub serialu.');
    const input = screen.getByRole('searchbox');
    fireEvent.change(input, { target: { value: 'N' } });
    fireEvent.change(input, { target: { value: 'Night' } });
    expect(search).not.toHaveBeenCalled();
    await waitFor(() => expect(search).toHaveBeenCalledExactlyOnceWith({ query: 'Night' }));
    fireEvent.change(input, { target: { value: 'Living' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(search).toHaveBeenLastCalledWith({ query: 'Living' }));
  });

  it('links missing credentials to settings without making requests', async () => {
    secrets.mockResolvedValue(
      success({
        encryptionAvailable: true,
        set: { 'tmdb.token': false, 'opensubtitles.apiKey': false, 'opensubtitles.password': false },
      }),
    );
    mount('/?q=Night');
    fireEvent.click(await screen.findByRole('link', { name: 'Otwórz Ustawienia' }));
    expect(await screen.findByRole('heading', { name: 'Ustawienia kont' })).toBeTruthy();
    expect(search).not.toHaveBeenCalled();
  });

  it('shows empty results and permits downloads navigation during TMDB failure', async () => {
    search.mockResolvedValueOnce(success([]));
    mount('/?q=Unknown');
    expect(await screen.findByText('Nie znaleziono tytułów dla „Unknown”.')).toBeTruthy();
    search.mockResolvedValue({ ok: false, error: { code: 'TMDB_UNAVAILABLE', message: 'TMDB_UNAVAILABLE' } });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Other' } });
    fireEvent.click(screen.getByRole('button', { name: 'Szukaj' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Pobieranie trwa dalej');
    fireEvent.click(screen.getByRole('link', { name: 'Pobrane' }));
    expect(await screen.findByRole('heading', { name: 'Lista pobrań' })).toBeTruthy();
  });

  it('selects season and second episode, then passes SearchTarget through router state', async () => {
    const router = mount('/title/tv/900001');
    fireEvent.click(await screen.findByRole('link', { name: /Sezon 1/ }));
    const episode = (await screen.findByRole('heading', { name: 'Nowy szlak' })).closest('li')!;
    fireEvent.click(within(episode).getByRole('button', { name: 'Szukaj wydań' }));
    expect(await screen.findByTestId('screen-releases')).toBeTruthy();
    expect(select).toHaveBeenCalledExactlyOnceWith({ type: 'tv', tmdbId: 900001, season: 1, episode: 2 });
    expect(router.state.location.state).toMatchObject({
      target: { kind: 'episode', tmdbId: 900001, season: 1, episode: 2 },
    });
    expect(screen.getByText(/Sezon 1 · Odcinek 2/)).toBeTruthy();
  });

  it('rejects invalid route parameters without requesting details', async () => {
    mount('/title/person/not-an-id');
    expect((await screen.findByRole('alert')).textContent).toContain('BAD_REQUEST');
    expect(details).not.toHaveBeenCalled();
  });
});
