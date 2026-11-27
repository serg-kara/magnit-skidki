'use client';

import { useEffect, useRef } from 'react';
import type { AgeAnswer } from '@/lib/age';

/** §6.4: модальное окно «Тебе есть 18?», показывается при первом включении фильтра алкоголя. */
export function AgeGateModal({
  open,
  onAnswer,
}: {
  open: boolean;
  onAnswer: (answer: AgeAnswer) => void;
}) {
  const yesRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) yesRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/45 px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Подтверждение возраста"
      data-qa="age-modal"
    >
      <div className="w-full max-w-sm rounded-[12px] border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
        <h2 className="text-lg font-bold">Тебе есть 18 лет?</h2>
        <p className="mt-2 text-sm text-muted">
          Раздел алкоголя открывается только после подтверждения. Ответ сохраняется в этом браузере
          и никуда не отправляется.
        </p>
        <div className="mt-4 flex gap-2">
          <button
            ref={yesRef}
            type="button"
            onClick={() => onAnswer('yes')}
            className="flex-1 rounded-[12px] bg-brand px-4 py-2 text-sm font-semibold text-white"
            data-qa="age-yes"
          >
            Да, есть
          </button>
          <button
            type="button"
            onClick={() => onAnswer('no')}
            className="flex-1 rounded-[12px] border border-line bg-canvas px-4 py-2 text-sm font-semibold text-muted"
            data-qa="age-no"
          >
            Нет
          </button>
        </div>
      </div>
    </div>
  );
}
