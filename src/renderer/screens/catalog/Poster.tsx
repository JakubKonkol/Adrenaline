import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import { t } from '../../i18n/t';
import styles from './Catalog.module.css';

export function Poster({ path, size = 'w185' }: { path: string | null; size?: 'w185' | 'w342' }) {
  const [failed, setFailed] = useState<string | null>(null);
  const valid = path && /^\/[a-zA-Z0-9_-]+\.(jpg|png|webp)$/.test(path);
  return valid && failed !== path ? (
    <img
      className={styles.poster}
      src={`https://image.tmdb.org/t/p/${size}${path}`}
      alt=""
      loading="lazy"
      onError={() => setFailed(path)}
    />
  ) : (
    <div className={`${styles.poster} ${styles.noPoster}`}>
      <ImageOff aria-hidden size={24} />
      <span>{t('catalog.noPoster')}</span>
    </div>
  );
}
