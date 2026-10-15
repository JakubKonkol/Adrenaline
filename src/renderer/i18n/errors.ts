import type { AppErrorCode } from '@shared/errors';

/** Message and suggested action for every stable error code (NFR09, 01-architektura.md "Kody błędów"). */
export const errorTexts: Record<AppErrorCode, { message: string; action: string }> = {
  BAD_REQUEST: { message: 'Invalid data.', action: 'Check the values you entered.' },
  FORBIDDEN: { message: 'This action is not allowed.', action: 'Restart the app.' },
  INTERNAL: { message: 'Something unexpected went wrong.', action: 'Try again. Details are in the logs.' },
  NOT_FOUND: { message: 'Not found.', action: 'Refresh the view.' },
  TMDB_NO_KEY: {
    message: 'No TMDB key.',
    action: 'Add a key in Settings → Accounts and keys.',
  },
  TMDB_UNAUTHORIZED: {
    message: 'The TMDB key is invalid.',
    action: 'Check the key in Settings → Accounts and keys.',
  },
  TMDB_UNAVAILABLE: {
    message: 'The movie catalog is temporarily unavailable. Downloads keep running.',
    action: 'Try again in a moment.',
  },
  TMDB_BAD_RESPONSE: {
    message: 'The movie catalog sent an unexpected response.',
    action: 'Try again later.',
  },
  TMDB_RATE_LIMITED: {
    message: 'Too many requests to the movie catalog.',
    action: 'Wait a moment and try again.',
  },
  SOURCE_TIMEOUT: { message: 'The source did not answer in time.', action: 'Try again or turn this source off.' },
  SOURCE_BAD_RESPONSE: {
    message: 'The source sent an invalid response.',
    action: 'Check the source in Settings → Sources.',
  },
  SOURCE_AUTH: { message: 'The source rejected the API key.', action: 'Check the source key in Settings → Sources.' },
  SOURCE_UNAVAILABLE: { message: 'The source is unavailable.', action: 'Try again later.' },
  ALL_SOURCES_FAILED: {
    message: 'Could not search the sources.',
    action: 'Check your internet connection and the source status in Settings.',
  },
  JACKETT_UNAVAILABLE: {
    message: 'The built-in source service is not running.',
    action: 'Restart it in Settings → Sources.',
  },
  ENGINE_UNAVAILABLE: {
    message: 'The download engine is not available.',
    action: 'Reinstall the app if the problem persists.',
  },
  ENGINE_CRASHED: {
    message: 'The download engine stopped working.',
    action: 'Restart it. Downloaded data is kept.',
  },
  ENGINE_PROTOCOL_MISMATCH: {
    message: 'The download engine version does not match the app.',
    action: 'Reinstall the app.',
  },
  ENGINE_TIMEOUT: { message: 'The download engine is not responding.', action: 'Try again in a moment.' },
  ENGINE_ERROR: { message: 'The download engine reported an error.', action: 'Try again. Details are in the logs.' },
  DISK_FULL: {
    message: 'The disk is full.',
    action: 'Free up space or choose another folder, then click “Retry”.',
  },
  DISK_MISSING: {
    message: 'The disk or the download folder is not available.',
    action: 'Reconnect the disk and click “Retry”.',
  },
  PATH_NOT_WRITABLE: {
    message: 'This folder is not writable.',
    action: 'Choose another folder or check its permissions.',
  },
  PATH_CONFLICT: {
    message: 'A file or folder with this name already exists here.',
    action: 'Use another name or choose another folder.',
  },
  PATH_TOO_LONG: {
    message: 'The path is very long and may not work on Windows.',
    action: 'Choose a shorter download folder.',
  },
  UNSAFE_TORRENT_PATH: {
    message: 'The release contains unsafe file paths and was stopped.',
    action: 'Remove the download and choose another release.',
  },
  INVALID_MAGNET: { message: 'The magnet link is invalid.', action: 'Choose another release.' },
  INVALID_TORRENT: { message: 'The torrent file is damaged.', action: 'Choose another release.' },
  TORRENT_TOO_LARGE: { message: 'The torrent file is too large.', action: 'Choose another release.' },
  METADATA_TIMEOUT: {
    message: 'Still looking for peers with the file list.',
    action: 'Wait, retry or cancel the download.',
  },
  NO_PEERS: { message: 'Waiting for peers.', action: 'The download starts when peers show up.' },
  DUPLICATE_JOB: { message: 'This release is already being downloaded.', action: 'Go to the existing download.' },
  JOB_NOT_FOUND: { message: 'Download not found.', action: 'Refresh the download list.' },
  FILE_MISSING: {
    message: 'The downloaded files were not found.',
    action: 'Reconnect the disk or click “Check again”.',
  },
  SUBS_NOT_FOUND: { message: 'No subtitles found.', action: 'Try later, change the language or skip subtitles.' },
  SUBS_QUOTA: {
    message: 'The daily subtitle download limit is used up.',
    action: 'Subtitles can be downloaded once the limit resets, or you can skip them.',
  },
  SUBS_AUTH: {
    message: 'Could not log in to OpenSubtitles.',
    action: 'Log in again in Settings → Accounts and keys, or skip subtitles.',
  },
  SUBS_NO_KEY: {
    message: 'No OpenSubtitles key.',
    action: 'Add a key and an account in Settings → Accounts and keys, or skip subtitles.',
  },
  SUBS_UNAVAILABLE: { message: 'The subtitle service is temporarily unavailable.', action: 'Try again later.' },
  SUBS_BAD_FILE: { message: 'The downloaded subtitle file is invalid.', action: 'Choose other subtitles.' },
  SECRETS_UNAVAILABLE: {
    message: 'The system cannot store keys securely.',
    action: 'Keys are kept only until the app is closed.',
  },
  UPDATE_FAILED: { message: 'The update failed.', action: 'Try again later.' },
};
