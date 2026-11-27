'use client';

import { useEffect, useState } from 'react';
import type { ApiMeta } from '@/lib/api-types';
import { formatRelative } from '@/lib/relative-time';

/**
 * §6.5: «Данные обновлены: <относительное время>» из /api/meta.
 * Только клиентское чтение — на сервере относительное время расходилось бы с моментом
 * рендера и давало бы hydration-мигание.
 */
export function SyncStatus() {
  const [meta, setMeta] = useState<ApiMeta | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch('/api/meta')
      .then((res) => (res.ok ? (res.json() as Promise<ApiMeta>) : Promise.reject(new Error(String(res.status)))))
      .then((data) => {
        if (alive) setMeta(data);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (failed) return <span className="text-xs text-warn">Статус синхронизации недоступен</span>;
  if (!meta) return <span className="text-xs text-muted">Загружаем статус…</span>;

  const sync = meta.lastSync;
  if (!sync?.finishedAt) return <span className="text-xs text-warn">Данные ещё не обновлялись</span>;

  const statusNote =
    sync.status === 'ok' ? '' : sync.status === 'partial' ? ' · частично' : ' · не обновлено';

  return (
    <span className="text-xs text-muted" data-qa="sync-status">
      Данные обновлены: {formatRelative(sync.finishedAt)}
      {statusNote && <span className="text-warn">{statusNote}</span>}
    </span>
  );
}
