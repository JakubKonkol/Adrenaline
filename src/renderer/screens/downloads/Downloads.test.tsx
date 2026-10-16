import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router';
import type { DownloadJob, SubtitleTaskDto } from '@shared/contracts/downloads';
import { Downloads } from './Downloads';

const success = <T,>(data: T) => ({ ok: true as const, data });

const task = (state: SubtitleTaskDto['state']): SubtitleTaskDto => ({
  id: 1,
  fileIndex: 0,
  lang: 'en',
  state,
  errorCode: state === 'error' ? 'SUBS_NO_KEY' : null,
  quotaResetAt: null,
  targetPath: null,
  candidates: [],
});

function job(id: string, patch: Partial<DownloadJob>): DownloadJob {
  return {
    id,
    target: { kind: 'movie', tmdbId: 1, title: `Movie ${id}`, originalTitle: `Movie ${id}`, year: 2020 },
    releaseName: `Movie.${id}.2020.1080p.WEB-DL`,
    sources: ['Test'],
    state: 'seeding',
    pauseReason: null,
    errorCode: null,
    saveDir: '/downloads',
    files: [{ index: 0, path: 'movie.mkv', size: 10, selected: true, doneBytes: 10, kind: 'video' }],
    suggestedFiles: [0],
    totalBytes: 10,
    infoHashV1: null,
    infoHashV2: null,
    seedRatioLimit: 1,
    seedTimeLimitMin: 60,
    subtitleLang: 'en',
    subtitleFallbackLang: null,
    subtitles: [task('error')],
    createdAt: 0,
    completedAt: 1,
    ...patch,
  };
}

const list = vi.fn();
const language = vi.fn();
const clients: QueryClient[] = [];

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const router = createMemoryRouter([{ path: '/downloads', element: <Downloads /> }], {
    initialEntries: ['/downloads'],
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  list.mockResolvedValue(
    success([
      job('attention', {}),
      job('skipped', { subtitleLang: null, subtitles: [task('disabled')] }),
      job('busy', { state: 'downloading', files: [{ ...job('x', {}).files[0]!, doneBytes: 5 }] }),
    ]),
  );
  language.mockResolvedValue(success(undefined));
  Object.defineProperty(window, 'adrenaline', {
    configurable: true,
    value: {
      downloads: { list, progress: vi.fn().mockResolvedValue(success([])) },
      subtitles: { language },
      events: { on: () => () => undefined },
    },
  });
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

describe('downloads list (D-78)', () => {
  it('offers to skip subtitles only when they are all that keeps a finished movie from being ready', async () => {
    mount();
    const attention = await screen.findByTestId('job-attention');
    expect(within(attention).getByTestId('job-status').textContent).toContain('subtitles need attention');
    const skipped = screen.getByTestId('job-skipped');
    expect(within(skipped).getByTestId('job-status').textContent).toContain('Ready');
    expect(within(skipped).getByText('No subtitles')).toBeTruthy();
    expect(within(skipped).queryByTestId('job-skip-subtitles')).toBeNull();
    expect(within(screen.getByTestId('job-busy')).queryByTestId('job-skip-subtitles')).toBeNull();

    fireEvent.click(within(attention).getByTestId('job-skip-subtitles'));
    await waitFor(() => expect(language).toHaveBeenCalledWith({ jobId: 'attention', language: null, fallback: null }));
  });
});
