import { describe, expect, it } from 'vitest';
import { nullLogger } from '../logger';
import { openDatabase } from '../persistence/db';
import { hashToken, matchesHash, TvDevicesRepository } from './devices';
import { parseRange, srtToVtt, TicketStore, videoMime } from './media';
import { chooseAddress, isAllowedHost, isPrivateIpv4, listAddresses } from './network';
import { PAIRING_TTL_MS, PairingManager } from './pairing';

describe('network', () => {
  it('knows private IPv4 ranges', () => {
    expect(['10.0.0.5', '172.16.1.1', '172.31.255.1', '192.168.1.20'].every(isPrivateIpv4)).toBe(true);
    expect(['172.32.0.1', '8.8.8.8', '127.0.0.1', '169.254.1.1', 'fe80::1', 'x'].some(isPrivateIpv4)).toBe(false);
  });

  it('prefers physical private adapters and skips loopback and link-local', () => {
    const list = listAddresses({
      'vEthernet (WSL)': [{ address: '172.20.0.1', family: 'IPv4', internal: false, netmask: '', mac: '', cidr: null }],
      'Wi-Fi': [
        { address: '192.168.1.20', family: 'IPv4', internal: false, netmask: '', mac: '', cidr: null },
        { address: 'fe80::1', family: 'IPv6', internal: false, netmask: '', mac: '', cidr: null, scopeid: 1 },
      ],
      Loopback: [{ address: '127.0.0.1', family: 'IPv4', internal: true, netmask: '', mac: '', cidr: null }],
      Auto: [{ address: '169.254.3.3', family: 'IPv4', internal: false, netmask: '', mac: '', cidr: null }],
      Public: [{ address: '85.1.2.3', family: 'IPv4', internal: false, netmask: '', mac: '', cidr: null }],
    });
    expect(list.map((a) => a.address)).toEqual(['192.168.1.20', '172.20.0.1', '85.1.2.3']);
    expect(chooseAddress('', list)).toBe('192.168.1.20');
    expect(chooseAddress('172.20.0.1', list)).toBe('172.20.0.1');
    expect(chooseAddress('10.9.9.9', list)).toBe('192.168.1.20');
    expect(chooseAddress('', [{ address: '85.1.2.3', interfaceName: 'x', private: false }])).toBeNull();
  });

  it('accepts only this server by IP in the Host header (DNS rebinding)', () => {
    expect(isAllowedHost('192.168.1.20:18790', 18790, ['192.168.1.20'])).toBe(true);
    expect(isAllowedHost('192.168.1.20', 18790, ['192.168.1.20'])).toBe(true);
    expect(isAllowedHost('localhost:18790', 18790, [])).toBe(true);
    expect(isAllowedHost('evil.example:18790', 18790, ['192.168.1.20'])).toBe(false);
    expect(isAllowedHost('192.168.1.20:80', 18790, ['192.168.1.20'])).toBe(false);
    expect(isAllowedHost(undefined, 18790, ['192.168.1.20'])).toBe(false);
  });
});

describe('media', () => {
  it('parses byte ranges', () => {
    expect(parseRange(undefined, 100)).toEqual({ kind: 'full' });
    expect(parseRange('bytes=0-9', 100)).toEqual({ kind: 'partial', start: 0, end: 9 });
    expect(parseRange('bytes=90-', 100)).toEqual({ kind: 'partial', start: 90, end: 99 });
    expect(parseRange('bytes=-10', 100)).toEqual({ kind: 'partial', start: 90, end: 99 });
    expect(parseRange('bytes=50-500', 100)).toEqual({ kind: 'partial', start: 50, end: 99 });
    expect(parseRange('bytes=0-1, 5-6', 100)).toEqual({ kind: 'partial', start: 0, end: 1 });
    // 64-bit sizes: films over 4 GiB.
    expect(parseRange('bytes=5000000000-', 6_000_000_000)).toEqual({
      kind: 'partial',
      start: 5_000_000_000,
      end: 5_999_999_999,
    });
    for (const bad of ['bytes=100-', 'bytes=9-3', 'bytes=-0', 'bytes=-', 'items=0-1', 'bytes=a-b'])
      expect(parseRange(bad, 100), bad).toEqual({ kind: 'invalid' });
  });

  it('converts SRT to WebVTT without adding markup', () => {
    const vtt = srtToVtt('﻿1\r\n00:00:01,500 --> 00:00:02,000\r\nZażółć <b>gęślą</b>\r\n');
    expect(vtt).toBe('WEBVTT\n\n1\n00:00:01.500 --> 00:00:02.000\nZażółć <b>gęślą</b>\n');
  });

  it('maps video types', () => {
    expect(videoMime('a/Film.MKV')).toBe('video/x-matroska');
    expect(videoMime('Film.mp4')).toBe('video/mp4');
    expect(videoMime('Film.iso')).toBe('application/octet-stream');
  });

  it('issues tickets that extend on use, expire and die with the device', () => {
    let now = 0;
    const store = new TicketStore(() => now);
    const a = store.issue('dev1', 'job~0');
    const b = store.issue('dev2', 'job~0');
    expect(store.use(a)).toMatchObject({ deviceId: 'dev1', itemId: 'job~0' });
    now = 5 * 60 * 60_000;
    expect(store.use(a)).not.toBeNull(); // extended at time 0, used again before 6 h
    now += 7 * 60 * 60_000;
    expect(store.use(a)).toBeNull();
    store.revokeDevice('dev2');
    expect(store.use(b)).toBeNull();
    expect(store.use('unknown')).toBeNull();
  });
});

describe('devices and pairing', () => {
  const setup = () => {
    let now = 1_000;
    const db = openDatabase(':memory:', { log: nullLogger });
    const devices = new TvDevicesRepository(db, () => now);
    const pairing = new PairingManager({
      createDevice: (r, address) => {
        const { device, token } = devices.add({
          name: r.deviceName,
          platform: r.platform,
          clientVersion: null,
          address,
        });
        return { token, deviceId: device.id };
      },
      now: () => now,
    });
    return { devices, pairing, tick: (ms: number) => (now += ms) };
  };

  it('stores only token hashes and finds devices by token', () => {
    const { devices } = setup();
    const { device, token } = devices.add({
      name: 'Living room',
      platform: 'tizen',
      clientVersion: '1.0.0',
      address: 'x',
    });
    expect(token).toHaveLength(43);
    expect(devices.byToken(token)?.id).toBe(device.id);
    expect(devices.byToken(`${token}x`)).toBeNull();
    expect(matchesHash(token, hashToken(token))).toBe(true);
    expect(matchesHash('other', hashToken(token))).toBe(false);
    expect(devices.serverId()).toBe(devices.serverId());
    devices.saveProgress(device.id, 'j~0', 1000, 5000);
    expect(devices.progress(device.id).get('j~0')).toEqual({ positionMs: 1000, durationMs: 5000 });
    devices.remove(device.id);
    expect(devices.byToken(token)).toBeNull();
  });

  it('hands out the token only after approval on the PC, once, to the TV with the secret', () => {
    const { pairing, devices } = setup();
    const created = pairing.request({ deviceName: 'TV', platform: 'android' }, '192.168.1.30');
    expect(created.code).toMatch(/^\d{6}$/);
    expect(pairing.pending()).toHaveLength(1);
    expect(pairing.claim(created.pairingId, created.claimSecret)).toEqual({ status: 'pending' });
    expect(() => pairing.claim(created.pairingId, 'wrong-secret-of-some-length')).toThrow();
    pairing.approve(created.pairingId);
    const claimed = pairing.claim(created.pairingId, created.claimSecret);
    expect(claimed.status).toBe('approved');
    if (claimed.status === 'approved') expect(devices.byToken(claimed.token)?.name).toBe('TV');
    expect(pairing.claim(created.pairingId, created.claimSecret)).toEqual({ status: 'expired' });
  });

  it('denies, expires and limits waiting requests', () => {
    const { pairing, tick } = setup();
    const denied = pairing.request({ deviceName: 'A', platform: 'web' }, 'x');
    pairing.deny(denied.pairingId);
    expect(pairing.claim(denied.pairingId, denied.claimSecret)).toEqual({ status: 'denied' });
    const late = pairing.request({ deviceName: 'B', platform: 'web' }, 'x');
    tick(PAIRING_TTL_MS + 1);
    expect(() => pairing.approve(late.pairingId)).toThrow();
    expect(pairing.claim(late.pairingId, late.claimSecret)).toEqual({ status: 'expired' });
    for (let i = 0; i < 3; i++) pairing.request({ deviceName: `T${i}`, platform: 'web' }, 'x');
    expect(() => pairing.request({ deviceName: 'T4', platform: 'web' }, 'x')).toThrow();
  });
});
