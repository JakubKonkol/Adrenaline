import { CheckCircle2, ExternalLink, Loader2, MonitorSmartphone, Trash2, Tv, XCircle } from 'lucide-react';
import { useState } from 'react';
import type { AppSettings } from '@shared/contracts/settings';
import {
  TV_DEPLOY_STEPS,
  type TvDeployRequest,
  type TvDeployState,
  type TvDeployStep,
  type TvServerStatus,
} from '@shared/contracts/tv';
import { ApiError } from '../../api/bridge';
import { useSettings, useUpdateSettings } from '../../api/settings';
import {
  cancelDeploy,
  useApprovePairing,
  useChooseTool,
  useDenyPairing,
  useDeployState,
  useRevokeDevice,
  useStartDeploy,
  useToolchain,
  useTvStatus,
} from '../../api/tv';
import { formatAgo } from '../../format';
import { t } from '../../i18n/t';
import { Button } from '../../ui/Button';
import { ErrorNotice } from '../../ui/ErrorNotice';
import { Field, Section, Select, TextInput, Toggle } from '../../ui/Form';
import { Page } from '../../ui/Page';
import styles from './Tv.module.css';

const LINKS = {
  platformTools: 'https://developer.android.com/tools/releases/platform-tools',
  androidDebugging: 'https://developer.android.com/tools/adb#connect-to-a-device-over-wi-fi',
  tizenStudio: 'https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/installing-tv-sdk.html',
  tizenDevMode: 'https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html',
  tizenCertificate:
    'https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/creating-certificates.html',
};

function Link({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={styles.link}>
      {children} <ExternalLink size={11} aria-hidden />
    </a>
  );
}

export function TvScreen() {
  const { data: status, error } = useTvStatus();
  const { data: settings } = useSettings();
  return (
    <Page title={t('tv.title')} label={t('nav.tv')} testId="screen-tv">
      <p className={styles.muted}>{t('tv.subtitle')}</p>
      {error ? <ErrorNotice error={error} /> : null}
      {status && settings ? (
        <div className={styles.sections}>
          <ServerSection status={status} settings={settings} />
          {status.pending.length > 0 ? <PairingSection status={status} /> : null}
          <DevicesSection status={status} />
          <DeploySection status={status} settings={settings} />
          <PlaybackSection status={status} settings={settings} />
        </div>
      ) : (
        <p role="status">{t('app.loading')}</p>
      )}
    </Page>
  );
}

function ServerSection({ status, settings }: { status: TvServerStatus; settings: AppSettings }) {
  const update = useUpdateSettings();
  const [port, setPort] = useState(String(settings.tvServerPort));
  const portValue = Number(port);
  const portValid = Number.isInteger(portValue) && portValue >= 1024 && portValue <= 65535;
  return (
    <Section title={t('tv.server.title')} description={t('tv.server.description')} testId="tv-server">
      <Toggle
        label={t('tv.server.enable')}
        description={t('tv.server.enableHint')}
        checked={settings.tvServerEnabled}
        onChange={(v) => update.mutate({ tvServerEnabled: v })}
        testId="tv-server-toggle"
      />
      {settings.tvServerEnabled ? (
        <div className={styles.serverState} data-testid="tv-server-state" data-state={status.state}>
          {status.state === 'running' && status.url ? (
            <>
              <span className={styles.ok}>
                <CheckCircle2 size={14} aria-hidden /> {t('tv.server.running')}
              </span>
              <p>
                {t('tv.server.addressForTv')}{' '}
                <strong className={`mono ${styles.address}`} data-testid="tv-server-url">
                  {status.url.replace(/^http:\/\//, '')}
                </strong>
              </p>
              <p className={styles.muted}>{t('tv.server.keepOn')}</p>
            </>
          ) : status.state === 'error' ? (
            <ErrorNotice
              error={new ApiError({ code: (status.errorCode ?? 'TV_SERVER_FAILED') as never, message: '' })}
              compact
            />
          ) : (
            <span className={styles.muted}>
              <Loader2 size={14} className={styles.spin} aria-hidden /> {t('tv.server.starting')}
            </span>
          )}
        </div>
      ) : null}
      <div className={styles.row}>
        <Field label={t('tv.server.interface')} hint={t('tv.server.interfaceHint')}>
          {(a) => (
            <Select
              {...a}
              value={settings.tvServerAddress}
              onChange={(e) => update.mutate({ tvServerAddress: e.target.value })}
            >
              <option value="">{t('tv.server.auto')}</option>
              {status.addresses.map((x) => (
                <option key={x.address} value={x.address}>
                  {x.address} — {x.interfaceName}
                  {x.private ? '' : ` (${t('tv.server.notLan')})`}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('tv.server.port')} error={portValid ? null : t('tv.server.portInvalid')}>
          {(a) => (
            <div className={styles.inline}>
              <TextInput
                {...a}
                className={styles.narrow}
                inputMode="numeric"
                value={port}
                onChange={(e) => setPort(e.target.value)}
              />
              <Button
                size="sm"
                disabled={!portValid || portValue === settings.tvServerPort}
                onClick={() => update.mutate({ tvServerPort: portValue })}
              >
                {t('common.save')}
              </Button>
            </div>
          )}
        </Field>
      </div>
      {update.error ? <ErrorNotice error={update.error} compact /> : null}
      <p className={styles.note}>{t('tv.server.security')}</p>
    </Section>
  );
}

function PairingSection({ status }: { status: TvServerStatus }) {
  const approve = useApprovePairing();
  const deny = useDenyPairing();
  return (
    <Section title={t('tv.pairing.title')} description={t('tv.pairing.description')} testId="tv-pairing">
      <ul className={styles.list}>
        {status.pending.map((p) => (
          <li key={p.id} className={styles.pairing} data-testid={`tv-pending-${p.id}`}>
            <div>
              <strong>{p.deviceName}</strong>
              <span className={styles.muted}>
                {' '}
                · {t(`tv.platform.${p.platform}`)} · {p.address}
              </span>
            </div>
            <span className={`mono ${styles.code}`} aria-label={t('tv.pairing.code')}>
              {p.code.slice(0, 3)} {p.code.slice(3)}
            </span>
            <div className={styles.inline}>
              <Button variant="primary" size="sm" onClick={() => approve.mutate(p.id)}>
                {t('tv.pairing.approve')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => deny.mutate(p.id)}>
                {t('tv.pairing.deny')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {approve.error ? <ErrorNotice error={approve.error} compact /> : null}
    </Section>
  );
}

function DevicesSection({ status }: { status: TvServerStatus }) {
  const revoke = useRevokeDevice();
  return (
    <Section title={t('tv.devices.title')} description={t('tv.devices.description')} testId="tv-devices">
      {status.devices.length === 0 ? (
        <p className={styles.muted}>{t('tv.devices.empty')}</p>
      ) : (
        <ul className={styles.list}>
          {status.devices.map((d) => (
            <li key={d.id} className={styles.device}>
              <Tv size={16} aria-hidden />
              <div className={styles.grow}>
                <strong>{d.name}</strong>
                <span className={styles.muted}>
                  {' '}
                  · {t(`tv.platform.${d.platform}`)}
                  {d.clientVersion ? ` · ${d.clientVersion}` : ''}
                  {d.lastSeenAt ? ` · ${t('tv.devices.seen', { when: formatAgo(d.lastSeenAt) })}` : ''}
                </span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => revoke.mutate(d.id)} aria-label={t('tv.devices.revoke')}>
                <Trash2 size={13} aria-hidden /> {t('tv.devices.revoke')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

const STEP_LABEL: Record<TvDeployStep, string> = {
  preflight: 'tv.deploy.step.preflight',
  pairing: 'tv.deploy.step.pairing',
  connecting: 'tv.deploy.step.connecting',
  authorizing: 'tv.deploy.step.authorizing',
  packaging: 'tv.deploy.step.packaging',
  installing: 'tv.deploy.step.installing',
  launching: 'tv.deploy.step.launching',
  handshake: 'tv.deploy.step.handshake',
};

function stepsFor(platform: 'android' | 'tizen', pairing: boolean): TvDeployStep[] {
  return TV_DEPLOY_STEPS.filter((s) =>
    platform === 'android' ? s !== 'packaging' && (pairing || s !== 'pairing') : s !== 'pairing',
  );
}

function DeploySection({ status, settings }: { status: TvServerStatus; settings: AppSettings }) {
  const { data: tools } = useToolchain();
  const choose = useChooseTool();
  const { data: state } = useDeployState();
  const start = useStartDeploy();
  const [platform, setPlatform] = useState<'android' | 'tizen'>('android');
  const [address, setAddress] = useState('');
  const [port, setPort] = useState('5555');
  const [pairPort, setPairPort] = useState('');
  const [pairCode, setPairCode] = useState('');
  const [profile, setProfile] = useState(settings.tvTizenProfile);
  const running = state?.status === 'running' || state?.status === 'action';
  const serverReady = status.state === 'running';
  const usePairing = platform === 'android' && pairPort.trim() !== '';

  const request = (): TvDeployRequest | null => {
    if (platform === 'android') {
      const p = Number(port);
      const pp = Number(pairPort);
      if (!Number.isInteger(p)) return null;
      return {
        platform,
        address: address.trim(),
        port: p,
        pairing: usePairing ? { port: pp, code: pairCode.trim() } : null,
      };
    }
    return { platform, address: address.trim(), profile };
  };
  // Android and automatic Samsung installs fetch their tools; only the advanced Samsung path needs Tizen Studio.
  const toolReady = platform === 'android' || !profile || (!!tools?.sdb && !!tools.tizen);

  return (
    <Section title={t('tv.deploy.title')} description={t('tv.deploy.description')} testId="tv-deploy">
      <div className={styles.platforms} role="radiogroup" aria-label={t('tv.deploy.platform')}>
        {(['android', 'tizen'] as const).map((p) => (
          <Button
            key={p}
            size="sm"
            role="radio"
            aria-checked={platform === p}
            variant={platform === p ? 'primary' : 'secondary'}
            disabled={running}
            onClick={() => setPlatform(p)}
          >
            {t(`tv.platform.${p}`)}
          </Button>
        ))}
      </div>

      <ol className={styles.prepare}>
        {platform === 'android' ? (
          <>
            <li>
              {t('tv.deploy.android.devMode')} <Link href={LINKS.androidDebugging}>{t('tv.deploy.howTo')}</Link>
            </li>
            <li>{t('tv.deploy.android.automaticHint')}</li>
            <li>
              <details className={styles.details}>
                <summary>{t('tv.deploy.android.advanced')}</summary>
                {tools?.adb ? (
                  <span className={styles.ok}>
                    <CheckCircle2 size={13} aria-hidden /> adb: <span className="mono">{tools.adb}</span>
                  </span>
                ) : (
                  <>
                    {t('tv.deploy.android.ownAdb')} <Link href={LINKS.platformTools}>{t('tv.deploy.download')}</Link>
                  </>
                )}{' '}
                <Button size="sm" variant="ghost" onClick={() => choose.mutate('adb')}>
                  {t('tv.deploy.choose')}
                </Button>
              </details>
            </li>
          </>
        ) : (
          <>
            <li>
              {t('tv.deploy.tizen.devMode')} <Link href={LINKS.tizenDevMode}>{t('tv.deploy.howTo')}</Link>
            </li>
            <li>{t('tv.deploy.tizen.automaticHint')}</li>
            <li>
              <details className={styles.details}>
                <summary>{t('tv.deploy.tizen.advanced')}</summary>
                {tools?.sdb && tools.tizen ? (
                  <span className={styles.ok}>
                    <CheckCircle2 size={13} aria-hidden /> Tizen Studio:{' '}
                    <span className="mono">{tools.tizenStudio}</span>
                  </span>
                ) : (
                  <>
                    {t('tv.deploy.tizen.needStudio')} <Link href={LINKS.tizenStudio}>{t('tv.deploy.download')}</Link>
                  </>
                )}{' '}
                <Button size="sm" variant="ghost" onClick={() => choose.mutate('tizen')}>
                  {t('tv.deploy.choose')}
                </Button>
                <p>
                  {t('tv.deploy.tizen.certificate')} <Link href={LINKS.tizenCertificate}>{t('tv.deploy.howTo')}</Link>
                  {state?.duid ? (
                    <>
                      {' '}
                      {t('tv.deploy.tizen.duid')} <strong className="mono">{state.duid}</strong>
                    </>
                  ) : null}
                </p>
              </details>
            </li>
          </>
        )}
      </ol>
      {choose.error ? <ErrorNotice error={choose.error} compact /> : null}

      <div className={styles.row}>
        <Field label={t('tv.deploy.address')} hint={t('tv.deploy.addressHint')}>
          {(a) => (
            <TextInput
              {...a}
              value={address}
              placeholder="192.168.1.40"
              inputMode="decimal"
              disabled={running}
              onChange={(e) => setAddress(e.target.value)}
              data-testid="tv-deploy-address"
            />
          )}
        </Field>
        {platform === 'android' ? (
          <Field label={t('tv.deploy.android.port')} hint={t('tv.deploy.android.portHint')}>
            {(a) => (
              <TextInput
                {...a}
                className={styles.narrow}
                value={port}
                inputMode="numeric"
                disabled={running}
                onChange={(e) => setPort(e.target.value)}
              />
            )}
          </Field>
        ) : (
          <Field label={t('tv.deploy.tizen.profile')} hint={t('tv.deploy.tizen.profileHint')}>
            {(a) => (
              <Select {...a} value={profile} disabled={running} onChange={(e) => setProfile(e.target.value)}>
                <option value="">{t('tv.deploy.tizen.automatic')}</option>
                {(tools?.profiles ?? []).map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
      </div>
      {platform === 'android' ? (
        <details className={styles.details}>
          <summary>{t('tv.deploy.android.pairingTitle')}</summary>
          <p className={styles.muted}>{t('tv.deploy.android.pairingHint')}</p>
          <div className={styles.row}>
            <Field label={t('tv.deploy.android.pairPort')}>
              {(a) => (
                <TextInput
                  {...a}
                  className={styles.narrow}
                  value={pairPort}
                  inputMode="numeric"
                  disabled={running}
                  onChange={(e) => setPairPort(e.target.value)}
                />
              )}
            </Field>
            <Field label={t('tv.deploy.android.pairCode')}>
              {(a) => (
                <TextInput
                  {...a}
                  className={styles.narrow}
                  value={pairCode}
                  inputMode="numeric"
                  autoComplete="off"
                  disabled={running}
                  onChange={(e) => setPairCode(e.target.value)}
                />
              )}
            </Field>
          </div>
        </details>
      ) : null}

      <div className={styles.inline}>
        {running ? (
          <Button onClick={() => void cancelDeploy()}>{t('common.cancel')}</Button>
        ) : (
          <Button
            variant="primary"
            disabled={!serverReady || !toolReady || !address.trim() || start.isPending}
            onClick={() => {
              const r = request();
              if (r) start.mutate(r);
            }}
            data-testid="tv-deploy-start"
          >
            <MonitorSmartphone size={14} aria-hidden /> {t('tv.deploy.install')}
          </Button>
        )}
        {!serverReady ? <span className={styles.muted}>{t('tv.deploy.serverFirst')}</span> : null}
      </div>
      {start.error ? <ErrorNotice error={start.error} compact /> : null}
      {state ? (
        <DeployProgress state={state} steps={stepsFor(state.platform, usePairing || state.step === 'pairing')} />
      ) : null}
    </Section>
  );
}

function DeployProgress({ state, steps }: { state: TvDeployState; steps: TvDeployStep[] }) {
  const current = steps.indexOf(state.step);
  return (
    <div className={styles.progress} data-testid="tv-deploy-progress" data-status={state.status}>
      <ol className={styles.steps}>
        {steps.map((s, i) => {
          const done = state.status === 'done' || i < current;
          const active = i === current && state.status !== 'done';
          const failed = active && (state.status === 'error' || state.status === 'cancelled');
          return (
            <li
              key={s}
              className={`${styles.step} ${done ? styles.stepDone : ''} ${active ? styles.stepActive : ''} ${failed ? styles.stepFailed : ''}`}
            >
              {failed ? (
                <XCircle size={13} aria-hidden />
              ) : done ? (
                <CheckCircle2 size={13} aria-hidden />
              ) : active ? (
                <Loader2 size={13} className={styles.spin} aria-hidden />
              ) : (
                <span className={styles.dot} aria-hidden />
              )}
              {t(STEP_LABEL[s] as never)}
            </li>
          );
        })}
      </ol>
      {state.status === 'action' ? (
        <p className={styles.action} role="status">
          {t(state.step === 'authorizing' ? 'tv.deploy.action.authorize' : 'tv.deploy.action.pair')}
        </p>
      ) : null}
      {state.status === 'done' ? (
        <p className={styles.ok} role="status">
          <CheckCircle2 size={14} aria-hidden /> {t('tv.deploy.done')}
        </p>
      ) : null}
      {state.status === 'error' && state.errorCode ? (
        <>
          <ErrorNotice error={new ApiError({ code: state.errorCode as never, message: '' })} compact />
          {state.detail ? <pre className={`mono ${styles.detail}`}>{state.detail}</pre> : null}
        </>
      ) : null}
    </div>
  );
}

function PlaybackSection({ status, settings }: { status: TvServerStatus; settings: AppSettings }) {
  const update = useUpdateSettings();
  return (
    <Section title={t('tv.playback.title')} description={t('tv.playback.description')} testId="tv-playback">
      {!status.ffmpeg ? <p className={styles.warning}>{t('tv.playback.noFfmpeg')}</p> : null}
      <div className={styles.row}>
        <Field label={t('tv.playback.hwAccel')} hint={t('tv.playback.hwAccelHint')}>
          {(a) => (
            <Select
              {...a}
              value={settings.transcodeHwAccel}
              onChange={(e) => update.mutate({ transcodeHwAccel: e.target.value as AppSettings['transcodeHwAccel'] })}
            >
              {(['auto', 'nvenc', 'qsv', 'amf', 'cpu'] as const).map((v) => (
                <option key={v} value={v}>
                  {t(`tv.playback.hw.${v}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('tv.playback.maxHeight')}>
          {(a) => (
            <Select
              {...a}
              value={String(settings.transcodeMaxHeight)}
              onChange={(e) =>
                update.mutate({ transcodeMaxHeight: Number(e.target.value) as AppSettings['transcodeMaxHeight'] })
              }
            >
              {[2160, 1440, 1080, 720].map((h) => (
                <option key={h} value={h}>
                  {h === 2160 ? '4K (2160p)' : `${h}p`}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('tv.playback.maxBitrate')}>
          {(a) => (
            <Select
              {...a}
              value={String(settings.transcodeMaxBitrateMbps)}
              onChange={(e) => update.mutate({ transcodeMaxBitrateMbps: Number(e.target.value) })}
            >
              {[8, 12, 20, 40, 60, 80].map((m) => (
                <option key={m} value={m}>
                  {m} Mb/s
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('tv.playback.cache')} hint={t('tv.playback.cacheHint')}>
          {(a) => (
            <Select
              {...a}
              value={String(settings.transcodeCacheGiB)}
              onChange={(e) => update.mutate({ transcodeCacheGiB: Number(e.target.value) })}
            >
              {[5, 10, 20, 50, 100].map((g) => (
                <option key={g} value={g}>
                  {g} GB
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      {update.error ? <ErrorNotice error={update.error} compact /> : null}
      <h3 className="label">{t('tv.playback.recent')}</h3>
      {status.playbacks.length === 0 ? (
        <p className={styles.muted}>{t('tv.playback.none')}</p>
      ) : (
        <ul className={styles.list} data-testid="tv-playbacks">
          {status.playbacks.map((p) => (
            <li key={`${p.deviceName}-${p.startedAt}`} className={styles.playback}>
              <div className={styles.playbackHead}>
                <strong>{p.title}</strong>
                <span className={`${styles.mode} ${styles[`mode_${p.mode}`] ?? ''}`}>
                  {t(`tv.playback.mode.${p.mode}`)}
                </span>
                <span className={styles.muted}>
                  {p.deviceName} · {formatAgo(p.startedAt)}
                  {p.encoder ? ` · ${p.encoder}` : ''}
                  {p.toneMap !== 'none' ? ` · ${t('tv.playback.toneMap')}` : ''}
                  {p.active && p.speed !== null ? ` · ${p.speed.toFixed(1)}×` : ''}
                </span>
              </div>
              <ul className={styles.reasons}>
                {p.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
