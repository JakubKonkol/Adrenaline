import type { RankedSubtitle, SubtitleCandidate } from '../contracts/subtitles';
import { parseReleaseName } from './release-parser';

/** Popularity only breaks ties; it cannot turn a poor release match into an automatic choice. */
export function rankSubtitles(candidates: SubtitleCandidate[], release: string): RankedSubtitle[] {
  const video = parseReleaseName(release);
  return candidates
    .map((candidate): RankedSubtitle => {
      const sub = parseReleaseName(candidate.release);
      const same = (key: 'group' | 'source' | 'resolution') =>
        video[key] !== null && video[key]?.toLowerCase() === sub[key]?.toLowerCase();
      const conflict =
        video.edition !== sub.edition ||
        (video.episode !== null &&
          sub.episode !== null &&
          (video.episode !== sub.episode || video.season !== sub.season)) ||
        (video.year !== null && sub.year !== null && video.year !== sub.year);
      const medium = !conflict && same('group') && same('source') && same('resolution');
      const eligible = !candidate.foreignPartsOnly && !candidate.machineTranslated;
      const confidence = eligible && candidate.moviehashMatch ? 'high' : eligible && medium ? 'medium' : 'low';
      const score =
        (confidence === 'high' ? 100 : confidence === 'medium' ? 50 : 0) +
        (candidate.hearingImpaired ? 0 : 10) +
        (candidate.fromTrusted ? 2 : 0) +
        Math.min(1, Math.max(0, candidate.ratings) / 10) +
        Math.min(1, Math.log10(1 + Math.max(0, candidate.downloadCount)) / 10);
      return { ...candidate, confidence, score };
    })
    .sort((a, b) => b.score - a.score || a.fileId - b.fileId);
}

export function automaticSubtitle(candidates: RankedSubtitle[]): RankedSubtitle | null {
  const best = candidates[0];
  if (!best || best.confidence === 'low') return null;
  // Two equivalent matches need a human choice, even when one has more downloads.
  const next = candidates[1];
  if (next && next.confidence === best.confidence && next.hearingImpaired === best.hearingImpaired) return null;
  return best;
}
