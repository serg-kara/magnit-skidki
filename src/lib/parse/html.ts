/**
 * Минимальный разбор HTML, достаточный для извлечения карточек акций по CSS-селекторам.
 * Нужен, чтобы тесты парсера (§7.2) работали по HTML-фикстурам в Node, без браузера:
 * Playwright используется только чтобы получить сам HTML (§4.1), а разбор — один и тот же код.
 */

export type HtmlElement = {
  kind: 'element';
  tag: string;
  attrs: Record<string, string>;
  children: HtmlNode[];
};

export type HtmlText = { kind: 'text'; text: string };
export type HtmlNode = HtmlElement | HtmlText;

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/** Теги, которые неявно закрывают предыдущего брата того же типа. */
const AUTO_CLOSE: Record<string, string[]> = {
  li: ['li'],
  p: ['p'],
  td: ['td', 'th'],
  th: ['td', 'th'],
  tr: ['tr'],
  option: ['option'],
};

const ENTITIES: Record<string, string> = {
  nbsp: '\u00a0',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  laquo: '«',
  raquo: '»',
  ldquo: '“',
  rdquo: '”',
  deg: '°',
  ndash: '–',
  mdash: '—',
  hellip: '…',
};

export function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, name: string) => {
      const key = name.toLowerCase();
      return key in ENTITIES ? ENTITIES[key] : m;
    });
}

const TAG_RE = /<(\/)?([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/)?>/g;
const ATTR_RE = /([a-zA-Z0-9_:.-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/g;

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of raw.matchAll(ATTR_RE)) {
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    attrs[name] = decodeEntities(value);
  }
  return attrs;
}

/** Вырезает содержимое `<script>`/`<style>`, чтобы их теги не ломали дерево. */
function stripRawTextBlocks(html: string): string {
  return html.replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi, (full, tag: string) => {
    return `<!--dropped:${tag}-->`;
  });
}

export function parseHtml(html: string): HtmlElement[] {
  const cleaned = stripRawTextBlocks(html.replace(/<!--[\s\S]*?-->/g, '').replace(/<!doctype[^>]*>/gi, ''));
  const root: HtmlElement = { kind: 'element', tag: '#fragment', attrs: {}, children: [] };
  const stack: HtmlElement[] = [root];
  let cursor = 0;

  const pushText = (chunk: string) => {
    if (!chunk) return;
    const top = stack[stack.length - 1];
    top.children.push({ kind: 'text', text: decodeEntities(chunk) });
  };

  for (const match of cleaned.matchAll(TAG_RE)) {
    const index = match.index ?? 0;
    pushText(cleaned.slice(cursor, index));
    cursor = index + match[0].length;

    const [, closing, nameRaw, attrRaw, selfClosing] = match;
    const tag = nameRaw.toLowerCase();

    if (closing) {
      // Ищем ближайший открытый такой же тег и срезаем стек ДО него (сам элемент
      // тоже уходит: он закрыт). Считаем от конца — иначе вложенность «сложится» неверно.
      let depth = -1;
      for (let i = stack.length - 1; i >= 1; i--) {
        if (stack[i].tag === tag) {
          depth = i;
          break;
        }
      }
      if (depth >= 1) stack.length = depth;
      continue;
    }

    if (AUTO_CLOSE[tag]) {
      const closers = AUTO_CLOSE[tag];
      while (stack.length > 1 && closers.includes(stack[stack.length - 1].tag)) stack.pop();
    }

    const element: HtmlElement = { kind: 'element', tag, attrs: parseAttrs(attrRaw ?? ''), children: [] };
    stack[stack.length - 1].children.push(element);
    if (!VOID_TAGS.has(tag) && !selfClosing) stack.push(element);
  }
  pushText(cleaned.slice(cursor));
  return root.children.filter((n): n is HtmlElement => n.kind === 'element');
}

export function textContent(node: HtmlNode): string {
  if (node.kind === 'text') return node.text;
  return node.children.map(textContent).join('');
}

/** Текст узла, схлопнутый в одну строку — то, что видит пользователь на карточке. */
export function visibleText(node: HtmlNode): string {
  return textContent(node).replace(/\s+/g, ' ').trim();
}

export function innerHtml(node: HtmlNode): string {
  if (node.kind === 'text') return node.text;
  const attrs = Object.entries(node.attrs)
    .map(([name, value]) => ` ${name}="${value}"`)
    .join('');
  return `<${node.tag}${attrs}>${node.children.map(innerHtml).join('')}</${node.tag}>`;
}

type CompoundSelector = {
  tag?: string;
  id?: string;
  classes: string[];
  attrs: { name: string; value?: string }[];
};

function parseCompound(part: string): CompoundSelector {
  const sel: CompoundSelector = { classes: [], attrs: [] };
  const re = /([#.]?[\w:-]+)|\[([^\]]+)\]/g;
  for (const m of part.matchAll(re)) {
    if (m[2]) {
      const [name, value] = m[2].split('=');
      sel.attrs.push({
        name: name.trim().toLowerCase(),
        value: value?.replace(/^["']|["']$/g, '').trim(),
      });
      continue;
    }
    const token = m[1];
    if (token.startsWith('.')) sel.classes.push(token.slice(1));
    else if (token.startsWith('#')) sel.id = token.slice(1);
    else sel.tag = token.toLowerCase();
  }
  return sel;
}

function matchesCompound(el: HtmlElement, sel: CompoundSelector): boolean {
  if (sel.tag && el.tag !== sel.tag) return false;
  if (sel.id && el.attrs.id !== sel.id) return false;
  const classList = (el.attrs.class ?? '').split(/\s+/).filter(Boolean);
  if (!sel.classes.every((c) => classList.includes(c))) return false;
  return sel.attrs.every((a) =>
    a.value === undefined ? a.name in el.attrs : el.attrs[a.name] === a.value,
  );
}

type ChainStep = { combinator: 'descendant' | 'child'; sel: CompoundSelector };

/** `".a > .b .c"` → [{descendant .a}, {child .b}, {descendant .c}] */
function parseChain(group: string): ChainStep[] {
  const rawTokens = group.split(/\s+/).filter(Boolean);
  const tokens: string[] = [];
  for (const raw of rawTokens) {
    if (raw === '>' || raw === '+') continue;
    if (raw.startsWith('>')) tokens.push('>', raw.slice(1));
    else tokens.push(raw);
    if (raw.endsWith('>')) tokens.push('>');
  }
  const chain: ChainStep[] = [];
  let child = false;
  for (const token of tokens) {
    if (token === '>') {
      child = true;
      continue;
    }
    chain.push({ combinator: child ? 'child' : 'descendant', sel: parseCompound(token) });
    child = false;
  }
  return chain;
}

function eachDescendant(node: HtmlElement, fn: (el: HtmlElement) => void): void {
  for (const child of node.children) {
    if (child.kind !== 'element') continue;
    fn(child);
    eachDescendant(child, fn);
  }
}

function directChildren(node: HtmlElement): HtmlElement[] {
  return node.children.filter((c): c is HtmlElement => c.kind === 'element');
}

/**
 * Поддержка: список селекторов через запятую, потомки (`a b`), прямой ребёнок (`a > b`),
 * теги/классы/id/атрибуты — ровно то, что нужно для карточек magnit.ru.
 */
export function querySelectorAll(roots: HtmlElement[], selector: string): HtmlElement[] {
  const results: HtmlElement[] = [];
  const add = (el: HtmlElement) => {
    if (!results.includes(el)) results.push(el);
  };

  for (const group of selector.split(',').map((s) => s.trim()).filter(Boolean)) {
    const chain = parseChain(group);
    if (!chain.length) continue;

    const first: HtmlElement[] = [];
    for (const root of roots) {
      if (matchesCompound(root, chain[0].sel)) first.push(root);
      eachDescendant(root, (el) => {
        if (matchesCompound(el, chain[0].sel)) first.push(el);
      });
    }

    let level = first;
    for (let i = 1; i < chain.length && level.length; i++) {
      const step = chain[i];
      const found: HtmlElement[] = [];
      for (const prev of level) {
        if (step.combinator === 'child') {
          for (const childEl of directChildren(prev)) {
            if (matchesCompound(childEl, step.sel)) found.push(childEl);
          }
        } else {
          eachDescendant(prev, (el) => {
            if (matchesCompound(el, step.sel)) found.push(el);
          });
        }
      }
      level = found;
    }
    for (const el of level) add(el);
  }
  return results;
}

export function querySelector(roots: HtmlElement[], selector: string): HtmlElement | null {
  return querySelectorAll(roots, selector)[0] ?? null;
}

export function descendants(node: HtmlElement, selector: string): HtmlElement[] {
  return querySelectorAll([node], selector);
}
