import { Link } from 'react-router';
import guide from '../../../docs/user-guide.md?raw';
import notices from '../../../resources/licenses/THIRD_PARTY_NOTICES.md?raw';
import { t } from '../i18n/t';
import { Card, Page } from '../ui/Page';
import styles from './Documents.module.css';

/** Bundled trusted documents are displayed as React text, never as raw HTML. */
export function Documents({ kind }: { kind: 'guide' | 'licenses' }) {
  return (
    <Page label={t('nav.about')} title={t(kind === 'guide' ? 'about.guide' : 'about.licenses')}>
      <Link to="/about">{t('common.back')}</Link>
      <Card>
        <article className={styles.document}>
          {kind === 'licenses' ? (
            <pre>{notices}</pre>
          ) : (
            guide
              .split(/\r?\n\r?\n/)
              .map((block, i) =>
                block.startsWith('## ') ? (
                  <h2 key={i}>{block.slice(3)}</h2>
                ) : block.startsWith('# ') ? null : (
                  <p key={i}>{block}</p>
                ),
              )
          )}
        </article>
      </Card>
    </Page>
  );
}
