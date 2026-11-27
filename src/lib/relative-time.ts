function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

/** «Данные обновлены: 12 минут назад» (§6.5) — без внешних датчиков и библиотек. */
export function formatRelative(input: string | Date | null | undefined, now = new Date()): string {
  if (!input) return 'ещё не обновлялись';
  const date = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(date.getTime())) return 'ещё не обновлялись';
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) return 'в будущем (проверьте часы)';
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} ${plural(minutes, 'минуту', 'минуты', 'минут')} назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${plural(hours, 'час', 'часа', 'часов')} назад`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'вчера';
  if (days < 30) return `${days} ${plural(days, 'день', 'дня', 'дней')} назад`;
  const months = Math.floor(days / 30);
  return `${months} ${plural(months, 'месяц', 'месяца', 'месяцев')} назад`;
}

export function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const rounded = Math.round(value * 100) / 100;
  const [int, frac] = rounded.toFixed(2).split('.');
  const withSpaces = int.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
  return frac === '00' ? `${withSpaces}\u00a0₽` : `${withSpaces},${frac}\u00a0₽`;
}
