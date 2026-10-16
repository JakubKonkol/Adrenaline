import { networkInterfaces } from 'node:os';
import type { TvAddress } from '@shared/contracts/tv';

export function isPrivateIpv4(address: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** Names of adapters that are usually not the home LAN (VPN, virtual machines, WSL, Docker). */
const VIRTUAL = /(vethernet|virtualbox|vmware|hyper-v|wsl|docker|loopback|tailscale|zerotier|wireguard|vpn|tap|tun)/i;

/**
 * IPv4 addresses the TV server can listen on. Loopback and link-local (169.254/16) are left out; private LAN addresses
 * of physical adapters come first, so the default is the address a TV on the same Wi-Fi can reach.
 */
export function listAddresses(source: ReturnType<typeof networkInterfaces> = networkInterfaces()): TvAddress[] {
  const out: (TvAddress & { virtual: boolean })[] = [];
  for (const [name, entries] of Object.entries(source)) {
    for (const e of entries ?? []) {
      if (e.family !== 'IPv4' || e.internal || e.address.startsWith('169.254.')) continue;
      out.push({
        address: e.address,
        interfaceName: name,
        private: isPrivateIpv4(e.address),
        virtual: VIRTUAL.test(name),
      });
    }
  }
  out.sort((a, b) => Number(b.private) - Number(a.private) || Number(a.virtual) - Number(b.virtual));
  return out.map(({ virtual: _virtual, ...rest }) => rest);
}

/** The configured address when it still exists, otherwise the first private LAN address (DHCP may change it). */
export function chooseAddress(configured: string, addresses: TvAddress[]): string | null {
  if (configured && addresses.some((a) => a.address === configured)) return configured;
  return addresses.find((a) => a.private)?.address ?? null;
}

/**
 * DNS rebinding guard: requests must name this server by its IP (or localhost for local tests), never by a domain a
 * web page could point at the PC.
 */
export function isAllowedHost(host: string | undefined, port: number, allowed: readonly string[]): boolean {
  if (!host) return false;
  const m = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(host.trim().toLowerCase());
  if (!m) return false;
  const name = m[1]!;
  if (m[2] !== undefined && Number(m[2]) !== port) return false;
  return name === 'localhost' || allowed.includes(name);
}
