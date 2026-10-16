import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { PairingCreated, PairingRequest, PairingStatus, TvPendingPairing } from '@shared/contracts/tv';
import { AppError } from '@shared/errors';
import { Emitter } from '../util/emitter';
import { hashToken, matchesHash } from './devices';

export const PAIRING_TTL_MS = 120_000;
const MAX_PENDING = 3;
const POLL_MS = 1_500;

interface Pairing {
  id: string;
  code: string;
  claimHash: string;
  request: PairingRequest;
  address: string;
  expiresAt: number;
  status: 'pending' | 'approved' | 'denied';
  /** Set on approval; handed out once to the TV that knows the claim secret, then forgotten. */
  result: { token: string; deviceId: string } | null;
}

export interface PairingDeps {
  /** Creates the device on approval (DB) and returns its one-time token. */
  createDevice: (request: PairingRequest, address: string) => { token: string; deviceId: string };
  now?: () => number;
}

/**
 * Pairing (1.0, D-82): a TV asks, the PC shows the request with a 6-digit code, the user approves it on the PC, and
 * only then the TV can collect a device token with the secret it got when asking. The code is a comparison aid, not a
 * password; the token is the long-lived credential. Everything here lives in memory and expires after 120 s.
 */
export class PairingManager extends Emitter<{ changed: undefined }> {
  private pairings = new Map<string, Pairing>();

  constructor(private readonly deps: PairingDeps) {
    super();
  }

  private now() {
    return (this.deps.now ?? Date.now)();
  }

  private sweep() {
    const now = this.now();
    let changed = false;
    for (const [id, p] of this.pairings) {
      // Approved results wait for the TV a bit longer than the request itself.
      if (p.expiresAt + (p.status === 'pending' ? 0 : PAIRING_TTL_MS) < now) {
        this.pairings.delete(id);
        changed = true;
      }
    }
    if (changed) this.emit('changed', undefined);
  }

  pending(): TvPendingPairing[] {
    this.sweep();
    return [...this.pairings.values()]
      .filter((p) => p.status === 'pending')
      .map((p) => ({
        id: p.id,
        code: p.code,
        deviceName: p.request.deviceName,
        platform: p.request.platform,
        address: p.address,
        expiresAt: p.expiresAt,
      }));
  }

  request(request: PairingRequest, address: string): PairingCreated {
    this.sweep();
    if (this.pending().length >= MAX_PENDING) throw new AppError('TV_PAIRING_BUSY');
    const claimSecret = randomBytes(24).toString('base64url');
    const pairing: Pairing = {
      id: randomUUID(),
      code: String(randomInt(0, 1_000_000)).padStart(6, '0'),
      claimHash: hashToken(claimSecret),
      request,
      address,
      expiresAt: this.now() + PAIRING_TTL_MS,
      status: 'pending',
      result: null,
    };
    this.pairings.set(pairing.id, pairing);
    this.emit('changed', undefined);
    return { pairingId: pairing.id, code: pairing.code, claimSecret, expiresAt: pairing.expiresAt, pollMs: POLL_MS };
  }

  private pendingById(id: string): Pairing {
    this.sweep();
    const p = this.pairings.get(id);
    if (!p || p.status !== 'pending') throw new AppError('TV_PAIRING_EXPIRED');
    return p;
  }

  /** Desktop: the user compared the codes and accepted. */
  approve(id: string): void {
    const p = this.pendingById(id);
    p.result = this.deps.createDevice(p.request, p.address);
    p.status = 'approved';
    this.emit('changed', undefined);
  }

  deny(id: string): void {
    const p = this.pendingById(id);
    p.status = 'denied';
    this.emit('changed', undefined);
  }

  /** TV polling with the claim secret. The token is returned once; the pairing is then forgotten. */
  claim(id: string, claimSecret: string): PairingStatus {
    this.sweep();
    const p = this.pairings.get(id);
    if (!p) return { status: 'expired' };
    if (!matchesHash(claimSecret, p.claimHash)) throw new AppError('FORBIDDEN');
    if (p.status === 'pending') return { status: 'pending' };
    this.pairings.delete(id);
    this.emit('changed', undefined);
    if (p.status === 'denied' || !p.result) return { status: 'denied' };
    return { status: 'approved', ...p.result };
  }

  clear(): void {
    this.pairings.clear();
    this.emit('changed', undefined);
  }
}
