const MAP: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'yo',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
  і: 'i',
  Ӏ: '',
};

/** «Курганинск» → «kurganinsk», «ст-ца Казанская» → «st-cts-kazanskaya». */
export function transliterate(input: string): string {
  let out = '';
  for (const ch of input.toLowerCase()) {
    if (/[a-z0-9]/.test(ch)) out += ch;
    else if (ch in MAP) out += MAP[ch];
    else if (ch === 'ё') out += 'yo';
    else out += '-';
  }
  return out.replace(/-+/g, '-').replace(/^-|-$/g, '');
}

/** Уникальный slug по базовомуslug'у: при коллизии добавляет счётчик (-2, -3, ...). */
export function uniqueSlug(base: string, taken: Set<string>): string {
  const clean = transliterate(base) || 'item';
  if (!taken.has(clean)) {
    taken.add(clean);
    return clean;
  }
  let n = 2;
  while (taken.has(`${clean}-${n}`)) n++;
  taken.add(`${clean}-${n}`);
  return `${clean}-${n}`;
}
