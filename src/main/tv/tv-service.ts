import type { TvServerStatus } from '@shared/contracts/tv';
import { AppError } from '@shared/errors';
import type { Logger } from '../logger';
import type { SettingsService } from '../services/settings-service';
import { Emitter } from '../util/emitter';
import { tvRoutes, type TvApiDeps } from './api';
import type { TvDevicesRepository } from './devices';
import { TicketStore } from './media';
import { chooseAddress, listAddresses } from './network';
import { PairingManager } from './pairing';
import { TvHttpServer } from './server';

export interface TvServiceDeps extends Omit<TvApiDeps, 'devices' | 'pairing' | 'tickets' | 'trackStream'> {
  devices: TvDevicesRepository;
  settings: SettingsService;
  log: Logger;
  /** Network interfaces (tests inject a fixed list). */
  addresses?: typeof listAddresses;
  /** A new TV asks to pair (desktop notification). */
  onPairingRequest?: (deviceName: string, code: string) => void;
}

/**
 * The desktop side of the TV feature (1.0): starts/stops the LAN server from the settings, keeps pairing requests,
 * devices and the status shown in the TV tab. Off by default (D-82); a failure to listen never blocks the desktop.
 */
export class TvService extends Emitter<{ status: TvServerStatus }> {
  readonly pairing: PairingManager;
  readonly tickets = new TicketStore();
  private readonly http: TvHttpServer;
  private state: TvServerStatus['state'] = 'stopped';
  private errorCode: string | null = null;
  private boundAddress: string | null = null;
  private boundPort = 0;
  private applying: Promise<void> = Promise.resolve();
  private expiryTimer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: TvServiceDeps) {
    super();
    this.pairing = new PairingManager({
      createDevice: (request, address) => {
        const { device, token } = deps.devices.add({
          name: request.deviceName,
          platform: request.platform,
          clientVersion: request.clientVersion ?? null,
          address,
        });
        deps.log.info(`paired ${request.platform} device ${device.id}`);
        return { token, deviceId: device.id };
      },
    });
    let known = new Set<string>();
    this.pairing.on('changed', () => {
      const pending = this.pairing.pending();
      for (const p of pending) if (!known.has(p.id)) deps.onPairingRequest?.(p.deviceName, p.code);
      known = new Set(pending.map((p) => p.id));
      this.scheduleExpiry();
      this.publish();
    });
    this.http = new TvHttpServer({
      routes: tvRoutes({
        ...deps,
        pairing: this.pairing,
        tickets: this.tickets,
        trackStream: (id, res) => this.http.trackStream(id, res),
      }),
      authenticate: (token) => deps.devices.byToken(token),
      allowedHosts: () => (this.boundAddress ? [this.boundAddress] : []),
      log: deps.log,
    });
    deps.settings.on('changed', ({ patch }) => {
      if (
        patch.tvServerEnabled !== undefined ||
        patch.tvServerPort !== undefined ||
        patch.tvServerAddress !== undefined
      )
        void this.apply();
    });
  }

  private addresses() {
    return (this.deps.addresses ?? listAddresses)();
  }

  status(): TvServerStatus {
    const s = this.deps.settings.get();
    const running = this.state === 'running' && this.boundAddress;
    return {
      enabled: s.tvServerEnabled,
      state: this.state,
      errorCode: this.errorCode,
      address: running ? this.boundAddress : null,
      port: running ? this.boundPort : s.tvServerPort,
      url: running ? `http://${this.boundAddress}:${this.boundPort}` : null,
      addresses: this.addresses(),
      pending: this.pairing.pending(),
      devices: this.deps.devices.list(),
    };
  }

  private publish() {
    this.emit('status', this.status());
  }

  /** Re-reads the settings and starts, restarts or stops the server (serialized). */
  apply(): Promise<void> {
    this.applying = this.applying.then(() => this.applyNow()).catch(() => undefined);
    return this.applying;
  }

  private async applyNow(): Promise<void> {
    const s = this.deps.settings.get();
    if (!s.tvServerEnabled) {
      await this.stopServer();
      return;
    }
    const address = chooseAddress(s.tvServerAddress, this.addresses());
    if (!address) {
      await this.stopServer();
      this.state = 'error';
      this.errorCode = 'TV_NO_NETWORK';
      this.publish();
      return;
    }
    if (this.state === 'running' && this.boundAddress === address && this.boundPort === s.tvServerPort) return;
    this.state = 'starting';
    this.errorCode = null;
    this.publish();
    try {
      await this.http.close();
      this.boundAddress = address;
      this.boundPort = await this.http.listen(address, s.tvServerPort);
      this.state = 'running';
      this.deps.log.info(`tv server listening on ${address}:${this.boundPort}`);
    } catch (error) {
      this.boundAddress = null;
      this.state = 'error';
      this.errorCode = error instanceof AppError ? error.code : 'TV_SERVER_FAILED';
      this.deps.log.warn('tv server could not start', error);
    }
    this.publish();
  }

  private async stopServer(): Promise<void> {
    await this.http.close();
    this.pairing.clear();
    this.tickets.clear();
    this.boundAddress = null;
    this.state = 'stopped';
    this.errorCode = null;
    this.publish();
  }

  /** Quit: stop accepting requests and close every connection (streams included). */
  async stop(): Promise<void> {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    await this.applying;
    await this.stopServer();
  }

  approve(id: string): void {
    this.pairing.approve(id);
  }

  deny(id: string): void {
    this.pairing.deny(id);
  }

  /** Revoke: the token stops working at once, media tickets die and open streams are cut. */
  revoke(deviceId: string): void {
    this.deps.devices.remove(deviceId);
    this.tickets.revokeDevice(deviceId);
    this.http.dropDevice(deviceId);
    this.publish();
  }

  /** Pending requests disappear from the TV tab when they expire. */
  private scheduleExpiry() {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    const next = Math.min(...this.pairing.pending().map((p) => p.expiresAt));
    if (!Number.isFinite(next)) return;
    this.expiryTimer = setTimeout(() => this.publish(), Math.max(0, next - Date.now()) + 50);
  }
}
