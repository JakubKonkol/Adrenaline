import type { DeviceProfile } from '../../src/shared/domain/playback';

/** A 1080p SDR TV with stereo AAC, MP4 and HLS (TV API tests). */
export const PROFILE: DeviceProfile = {
  platform: 'tizen',
  model: null,
  maxWidth: 1920,
  maxHeight: 1080,
  video: [{ codec: 'h264', maxWidth: 1920, maxHeight: 1080, tenBit: false }],
  hdr: { hdr10: false, hdr10plus: false, hlg: false, dolbyVision: [] },
  audioDecode: ['aac'],
  audioPassthrough: [],
  maxAudioChannels: 2,
  containers: ['mp4'],
  hls: true,
};
