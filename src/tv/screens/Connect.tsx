import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { TV_API_VERSION } from '@shared/contracts/tv-constants';
import { ApiError, publicApi } from '../api';
import { current, focus, focusFirst } from '../focus';
import { t } from '../i18n';
import { endsTextEntry } from '../keys';
import { platform } from '../platform';
import { type Connection, normalizeServer } from '../storage';
import { Button, Focusable, Spinner } from '../ui';
import logo from '../assets/adrenaline-logo-on-dark.svg';

type Step =
  | { kind: 'address'; error: string | null }
  | { kind: 'checking' }
  | {
      kind: 'pairing';
      code: string;
      pairingId: string;
      secret: string;
      pollMs: number;
      server: string;
      serverName: string;
    }
  | { kind: 'failed'; message: string };

/** Text field for the remote: Enter opens the TV keyboard, Done/Back/Up/Down close it. */
export function TextField({
  value,
  onChange,
  placeholder,
  label,
  onSubmit,
  focusKey,
  autoFocus,
  inputMode,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  label: string;
  onSubmit?: () => void;
  focusKey: string;
  autoFocus?: boolean;
  inputMode?: 'text' | 'decimal' | 'search';
}) {
  const input = useRef<HTMLInputElement>(null);
  const wrapper = useRef<HTMLDivElement | null>(null);
  return (
    <Focusable
      className="text-field"
      focusKey={focusKey}
      autoFocus={autoFocus}
      label={label}
      onSelect={() => input.current?.focus()}
    >
      <span ref={(el) => void (wrapper.current = el?.parentElement as HTMLDivElement | null)} />
      <input
        ref={input}
        value={value}
        placeholder={placeholder}
        inputMode={inputMode ?? 'text'}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        tabIndex={-1}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (!endsTextEntry(e.nativeEvent)) return;
          e.preventDefault();
          e.stopPropagation();
          input.current?.blur();
          focus(wrapper.current);
          if (e.key === 'Enter' || e.keyCode === 65376) onSubmit?.();
        }}
      />
    </Focusable>
  );
}

export function Connect({
  initialServer,
  reason,
  auto = false,
  onConnected,
}: {
  initialServer: string | null;
  reason: 'revoked' | null;
  /** First launch after Deploy to TV: start pairing with the PC's address at once. */
  auto?: boolean;
  onConnected: (connection: Connection) => void;
}) {
  const [address, setAddress] = useState(initialServer?.replace(/^https?:\/\//, '') ?? '');
  const [step, setStep] = useState<Step>({
    kind: 'address',
    error: reason === 'revoked' ? t('connect.revoked') : null,
  });
  const deviceName = platform.deviceName();
  // Each step replaces the buttons: focus the new step's default.
  useLayoutEffect(() => {
    if (!current()) focusFirst();
  });

  const connect = async () => {
    const server = normalizeServer(address);
    if (!server) {
      setStep({ kind: 'address', error: t('connect.invalid') });
      return;
    }
    setStep({ kind: 'checking' });
    try {
      const info = await publicApi.info(server);
      if (info.app !== 'adrenaline') throw new ApiError('NOT_ADRENALINE', 0);
      if (info.apiMin > TV_API_VERSION) throw new ApiError('TOO_OLD', 0);
      const pairing = await publicApi.pair(server, deviceName, platform.name);
      setStep({
        kind: 'pairing',
        code: pairing.code,
        pairingId: pairing.pairingId,
        secret: pairing.claimSecret,
        pollMs: pairing.pollMs,
        server,
        serverName: info.serverName,
      });
    } catch (error) {
      const code = error instanceof ApiError ? error.code : 'NETWORK';
      const message =
        code === 'NOT_ADRENALINE' || code === 'BAD_RESPONSE' || code.startsWith('HTTP_')
          ? t('connect.notAdrenaline')
          : code === 'TOO_OLD'
            ? t('connect.tooOld')
            : code === 'TV_PAIRING_BUSY'
              ? t('connect.busy')
              : t('connect.unreachable', { server });
      setStep({ kind: 'address', error: message });
    }
  };

  // Installed from the PC (Deploy to TV): the address is known, so ask for approval right away. Only once: a failed
  // attempt leaves the address on screen to try again.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current || !auto || !initialServer) return;
    autoStarted.current = true;
    void connect();
    // connect() reads the address state set from initialServer on the first render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pairing = step.kind === 'pairing' ? step : null;
  useEffect(() => {
    if (!pairing) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = () => {
      publicApi.claim(pairing.server, pairing.pairingId, pairing.secret).then(
        (status) => {
          if (!alive) return;
          if (status.status === 'approved') {
            onConnected({
              server: pairing.server,
              token: status.token,
              deviceId: status.deviceId,
              serverName: pairing.serverName,
            });
          } else if (status.status === 'pending') {
            timer = setTimeout(poll, pairing.pollMs);
          } else {
            setStep({ kind: 'failed', message: t(status.status === 'denied' ? 'connect.denied' : 'connect.expired') });
          }
        },
        () => {
          if (alive) timer = setTimeout(poll, pairing.pollMs * 2);
        },
      );
    };
    timer = setTimeout(poll, pairing.pollMs);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [pairing, onConnected]);

  return (
    <div className="connect" data-page="">
      <img className="connect-logo" src={logo} alt="Adrenaline" />
      {step.kind === 'pairing' ? (
        <div className="connect-card">
          <h1>{t('connect.pairTitle')}</h1>
          <p>{t('connect.pairBody', { name: deviceName })}</p>
          <div className="pair-code" aria-label={step.code.split('').join(' ')}>
            {step.code.slice(0, 3)}
            <span className="pair-gap" />
            {step.code.slice(3)}
          </div>
          <Spinner label={t('connect.waiting')} />
          <Button autoFocus focusKey="pair-cancel" onSelect={() => setStep({ kind: 'address', error: null })}>
            {t('app.cancel')}
          </Button>
        </div>
      ) : step.kind === 'failed' ? (
        <div className="connect-card">
          <h1>{step.message}</h1>
          <Button primary autoFocus focusKey="pair-again" onSelect={() => setStep({ kind: 'address', error: null })}>
            {t('connect.again')}
          </Button>
        </div>
      ) : (
        <div className="connect-card">
          <h1>{t('connect.title')}</h1>
          <p>{t('connect.body')}</p>
          <TextField
            value={address}
            onChange={setAddress}
            placeholder={t('connect.placeholder')}
            label={t('connect.address')}
            focusKey="connect-address"
            autoFocus={!address}
            inputMode="decimal"
            onSubmit={() => void connect()}
          />
          {step.kind === 'address' && step.error ? <p className="error-text">{step.error}</p> : null}
          {step.kind === 'checking' ? (
            <Spinner label={t('connect.connecting')} />
          ) : (
            <Button primary autoFocus={!!address} focusKey="connect-go" onSelect={() => void connect()}>
              {t('connect.connect')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
