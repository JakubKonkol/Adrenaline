import type { DeviceProfile } from '@shared/domain/playback';

/**
 * What this TV can play (D-85), sent with every playback request. The PC decides from it between direct play, remux,
 * audio conversion and video conversion.
 */

function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

/**
 * Samsung Tizen. Panel and HDR come from webapis (productinfo/avinfo); codec support by platform year
 * (Tizen 4.0 = 2018, 5.0 = 2019, 5.5 = 2020, 6.0 = 2021, 6.5 = 2022, 7.0 = 2023, 8.0 = 2024). Samsung TVs have no
 * Dolby Vision, no TrueHD and no DTS from Tizen 4 on. FLAC is converted (it plays with an audio delay on Tizen) and
 * MPEG-2/VC-1/PCM/Vorbis play natively, as in Jellyfin's Tizen profile.
 */
export function tizenProfile(): DeviceProfile {
  const w = window.webapis;
  const platformVersion = safe(() =>
    window.tizen?.systeminfo?.getCapability('http://tizen.org/feature/platform.version'),
  );
  const version = typeof platformVersion === 'string' ? Number.parseFloat(platformVersion) : 0;
  const uhd = safe(() => w?.productinfo?.['isUdPanelSupported']?.()) === true;
  const eightK = safe(() => w?.productinfo?.['is8KPanelSupported']?.()) === true;
  const hdr = safe(() => w?.avinfo?.['isHdrTvSupport']?.()) === true;
  const model = safe(() => w?.productinfo?.['getRealModel']?.());
  const maxWidth = eightK ? 7680 : uhd ? 3840 : 1920;
  const maxHeight = eightK ? 4320 : uhd ? 2160 : 1080;
  const video: DeviceProfile['video'] = [
    { codec: 'h264', maxWidth: Math.min(maxWidth, 3840), maxHeight: Math.min(maxHeight, 2160), tenBit: false },
    { codec: 'hevc', maxWidth, maxHeight, tenBit: true },
  ];
  video.push(
    { codec: 'mpeg2video', maxWidth: 1920, maxHeight: 1080, tenBit: false },
    { codec: 'vc1', maxWidth: 1920, maxHeight: 1080, tenBit: false },
  );
  if (version >= 4) video.push({ codec: 'vp9', maxWidth, maxHeight, tenBit: true });
  if (version >= 6 && uhd) video.push({ codec: 'av1', maxWidth, maxHeight, tenBit: true });
  return {
    platform: 'tizen',
    model: typeof model === 'string' ? model.slice(0, 80) : null,
    maxWidth,
    maxHeight,
    video,
    hdr: { hdr10: hdr, hdr10plus: hdr, hlg: hdr, dolbyVision: [] },
    audioDecode: ['aac', 'ac3', 'eac3', 'mp3', 'mp2', 'opus', 'vorbis', 'pcm_s16le', 'pcm_s24le'],
    // Dolby Digital Plus with Atmos goes to a soundbar/AVR over (e)ARC from the 2019 models on.
    audioPassthrough: version >= 5 ? ['ac3', 'eac3', 'eac3-joc'] : ['ac3', 'eac3'],
    maxAudioChannels: 6,
    containers: ['mp4', 'mkv', 'webm', 'ts'],
    hls: true,
  };
}

/** Android TV: the native shell reads MediaCodecList, Display HDR capabilities and AudioCapabilities. */
export function androidProfile(): DeviceProfile {
  const raw = safe(() => window.AdrenalineNative?.deviceProfile?.());
  if (raw) {
    const parsed = safe(() => JSON.parse(raw) as DeviceProfile);
    if (parsed && parsed.platform === 'android') return parsed;
  }
  // Fallback for an older shell: what every Android TV 9+ device decodes.
  return {
    platform: 'android',
    model: null,
    maxWidth: 1920,
    maxHeight: 1080,
    video: [
      { codec: 'h264', maxWidth: 1920, maxHeight: 1080, tenBit: false },
      { codec: 'hevc', maxWidth: 1920, maxHeight: 1080, tenBit: false },
    ],
    hdr: { hdr10: false, hdr10plus: false, hlg: false, dolbyVision: [] },
    audioDecode: ['aac', 'ac3', 'eac3', 'mp3', 'flac', 'opus'],
    audioPassthrough: [],
    maxAudioChannels: 2,
    containers: ['mp4', 'mkv', 'webm', 'ts'],
    hls: true,
  };
}

/** Browser (development): what the <video> element reports. */
export function webProfile(): DeviceProfile {
  const video = document.createElement('video');
  const can = (type: string) => !!video.canPlayType(type);
  const mse = (type: string) => !!safe(() => window.MediaSource?.isTypeSupported(type));
  const codecs: DeviceProfile['video'] = [{ codec: 'h264', maxWidth: 3840, maxHeight: 2160, tenBit: false }];
  if (mse('video/mp4; codecs="hvc1.2.4.L153.B0"'))
    codecs.push({ codec: 'hevc', maxWidth: 3840, maxHeight: 2160, tenBit: true });
  if (mse('video/mp4; codecs="av01.0.12M.10"'))
    codecs.push({ codec: 'av1', maxWidth: 3840, maxHeight: 2160, tenBit: true });
  if (mse('video/webm; codecs="vp9"')) codecs.push({ codec: 'vp9', maxWidth: 3840, maxHeight: 2160, tenBit: false });
  return {
    platform: 'web',
    model: null,
    maxWidth: screen.width * (window.devicePixelRatio || 1),
    maxHeight: screen.height * (window.devicePixelRatio || 1),
    video: codecs,
    hdr: { hdr10: false, hdr10plus: false, hlg: false, dolbyVision: [] },
    audioDecode: ['aac', 'mp3', 'opus', 'flac'].concat(mse('audio/mp4; codecs="ec-3"') ? ['ac3', 'eac3'] : []),
    audioPassthrough: [],
    maxAudioChannels: 2,
    containers: ['mp4', 'webm'],
    hls: can('application/vnd.apple.mpegurl'),
  };
}

export function deviceProfile(platform: DeviceProfile['platform']): DeviceProfile {
  const p = platform === 'tizen' ? tizenProfile() : platform === 'android' ? androidProfile() : webProfile();
  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(v)));
  return { ...p, maxWidth: clamp(p.maxWidth, 320, 7680), maxHeight: clamp(p.maxHeight, 240, 4320) };
}
