import { CheckCircle2, CircleHelp, Plus, RefreshCw, Trash2, XCircle } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import type { Source } from '@shared/contracts/sources';
import { ApiError } from '../../api/bridge';
import {
  useAddCustomSource,
  useJackettStatus,
  useRemoveSource,
  useRestartJackett,
  useSetSourceEnabled,
  useSources,
  useTestSource,
} from '../../api/releases';
import { formatAgo } from '../../format';
import { t } from '../../i18n/t';
import { Button } from '../../ui/Button';
import { ErrorNotice, errorText } from '../../ui/ErrorNotice';
import { Field, TextInput, Toggle } from '../../ui/Form';
import styles from './Sources.module.css';

function Health({ source }: { source: Source }) {
  const Icon = source.health === 'ok' ? CheckCircle2 : source.health === 'error' ? XCircle : CircleHelp;
  const reason =
    source.health === 'error' && source.healthCode
      ? errorText(new ApiError({ code: source.healthCode as never, message: '' })).message
      : null;
  return (
    <span className={`${styles.health} ${styles[source.health]}`} data-testid={`source-health-${source.id}`}>
      <Icon size={12} aria-hidden />
      {t(`sources.health.${source.health}`)}
      {source.checkedAt ? (
        <span className={styles.ago}> · {t('sources.checked', { ago: formatAgo(source.checkedAt) })}</span>
      ) : null}
      {reason ? <span className={styles.reason}>{reason}</span> : null}
    </span>
  );
}

/** Built-in indexers with on/off switches (used in Settings and in the first-run wizard). */
export function BuiltinSources({ compact }: { compact?: boolean }) {
  const { data: sources } = useSources();
  const setEnabled = useSetSourceEnabled();
  const test = useTestSource();
  const [error, setError] = useState<unknown>(null);
  const builtin = (sources ?? []).filter((s) => s.kind === 'jackett_builtin');
  return (
    <div className={styles.list}>
      {error ? <ErrorNotice error={error} compact /> : null}
      {builtin.map((s) => {
        const busy = setEnabled.isPending && setEnabled.variables?.id === s.id;
        return (
          <div key={s.id} className={styles.row}>
            <Toggle
              label={s.name}
              {...(s.description ? { description: busy ? t('sources.enabling') : s.description } : {})}
              checked={s.enabled}
              testId={`source-toggle-${s.id}`}
              onChange={(enabled) => {
                setError(null);
                setEnabled.mutate({ id: s.id, enabled }, { onError: setError });
              }}
            />
            {compact ? null : (
              <div className={styles.meta}>
                <Health source={s} />
                {s.enabled ? (
                  <Button size="sm" variant="ghost" disabled={test.isPending} onClick={() => test.mutate(s.id)}>
                    {test.isPending && test.variables === s.id ? t('sources.testing') : t('sources.test')}
                  </Button>
                ) : null}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CustomSources() {
  const { data: sources } = useSources();
  const add = useAddCustomSource();
  const remove = useRemoveSource();
  const test = useTestSource();
  const [name, setName] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [apiKey, setApiKey] = useState('');
  const custom = (sources ?? []).filter((s) => s.kind === 'torznab_custom');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate(
      { name: name.trim(), endpoint: endpoint.trim(), apiKey: apiKey.trim() || null },
      {
        onSuccess: () => {
          setName('');
          setEndpoint('');
          setApiKey('');
        },
      },
    );
  };

  return (
    <div className={styles.list}>
      {custom.map((s) => (
        <div key={s.id} className={styles.row}>
          <div className={styles.customHead}>
            <span className={styles.customName}>{s.name}</span>
            <span className={`mono ${styles.endpoint}`}>{s.endpoint}</span>
          </div>
          <div className={styles.meta}>
            <Health source={s} />
            <Button size="sm" variant="ghost" disabled={test.isPending} onClick={() => test.mutate(s.id)}>
              {t('sources.test')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => remove.mutate(s.id)}
              aria-label={`${t('common.remove')} ${s.name}`}
            >
              <Trash2 size={12} aria-hidden />
            </Button>
          </div>
        </div>
      ))}
      <form className={styles.addForm} onSubmit={submit}>
        <p className="label">{t('sources.addTitle')}</p>
        <Field label={t('sources.name')}>
          {(a) => <TextInput {...a} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label={t('sources.endpoint')} hint={t('sources.customHint')}>
          {(a) => (
            <TextInput
              {...a}
              value={endpoint}
              spellCheck={false}
              maxLength={500}
              onChange={(e) => setEndpoint(e.target.value)}
            />
          )}
        </Field>
        <Field label={t('sources.apiKey')}>
          {(a) => (
            <TextInput
              {...a}
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          )}
        </Field>
        {add.error ? <ErrorNotice error={add.error} compact /> : null}
        <div>
          <Button type="submit" disabled={add.isPending || !name.trim() || !endpoint.trim()}>
            <Plus size={14} aria-hidden /> {t('sources.add')}
          </Button>
        </div>
      </form>
    </div>
  );
}

export function SourcesSection() {
  const { data: jackett } = useJackettStatus();
  const restart = useRestartJackett();
  return (
    <div className={styles.section} data-testid="sources-section">
      <p className={styles.description}>{t('sources.description')}</p>
      <div className={styles.jackett}>
        <span className="label">{t('sources.jackett')}</span>
        <span data-testid="jackett-status">
          {jackett ? t(`sources.jackettState.${jackett.state}`) : t('app.loading')}
          {jackett?.version ? <span className={`mono ${styles.ago}`}> · {jackett.version}</span> : null}
        </span>
        {jackett && ['running', 'crashed', 'stopped'].includes(jackett.state) && jackett.state !== 'stopped' ? (
          <Button size="sm" variant="ghost" disabled={restart.isPending} onClick={() => restart.mutate()}>
            <RefreshCw size={12} aria-hidden /> {t('sources.restartJackett')}
          </Button>
        ) : null}
      </div>
      <p className="label">{t('sources.builtin')}</p>
      <BuiltinSources />
      <p className="label">{t('sources.custom')}</p>
      <CustomSources />
    </div>
  );
}
