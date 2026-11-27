/** §6.4: ответ о возрасте только в localStorage; cookie и сервер не трогаем. */

export const AGE_KEY = 'magnit.ageOk.v1';

export type AgeAnswer = 'yes' | 'no';

export function readAgeAnswer(): AgeAnswer | null {
  if (typeof window === 'undefined') return null;
  const value = window.localStorage.getItem(AGE_KEY);
  return value === 'yes' || value === 'no' ? value : null;
}

export function writeAgeAnswer(answer: AgeAnswer): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(AGE_KEY, answer);
}

/** Дней до конца акции; null, если срок не указан. */
export function daysLeft(validTo: string | null, now = new Date()): number | null {
  if (!validTo) return null;
  const end = new Date(`${validTo}T23:59:59`);
  if (Number.isNaN(end.getTime())) return null;
  return Math.ceil((end.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
}
