import { prisma } from '@/lib/prisma';
import { CATEGORY_BY_SLUG, type CategoryConfig } from '@/config/categories';
import { computeSig, productSlug, splitUnits } from '@/lib/parse/normalize';
import { transliterate, uniqueSlug } from '@/lib/translit';
import type { RawCard } from './extract-cards';

export type SaveContext = {
  /** Магазины города — для store-скоупа; federal не привязывается к конкретным id. */
  storeIds: number[];
  scope: 'federal' | 'store';
  takenProductSlugs: Set<string>;
};

export type SaveResult = { created: number; seen: number; skipped: number };

export type CategoryRow = CategoryConfig & { id: number };

export async function ensureCategory(slug: string): Promise<CategoryRow> {
  const config = CATEGORY_BY_SLUG[slug] ?? CATEGORY_BY_SLUG.other;
  const row = await prisma.category.upsert({
    where: { slug: config.slug },
    update: { name: config.name, isAdult: config.isAdult },
    create: { slug: config.slug, name: config.name, isAdult: config.isAdult },
  });
  return { ...config, id: row.id };
}

/** §4.3: единицы измерения — часть slug'а, чтобы «Молоко 0,5 л» и «Молоко 900 г» не слились. */
export function draftSlug(name: string): string {
  const { unit } = splitUnits(name);
  const base = productSlug(name);
  return unit ? `${base}-${transliterate(unit)}` : base;
}

async function resolveProduct(card: RawCard, ctx: SaveContext): Promise<number> {
  const { cleanName, unit } = splitUnits(card.name);
  const displayName = unit ? `${cleanName}, ${unit}` : cleanName;
  const category = await ensureCategory(card.categorySlug);
  const slug = draftSlug(card.name);

  const existing = await prisma.product.findUnique({ where: { slug } });
  if (existing) {
    if (!existing.brand && card.brand) {
      await prisma.product.update({ where: { id: existing.id }, data: { brand: card.brand } });
    }
    return existing.id;
  }

  const finalSlug = uniqueSlug(slug, ctx.takenProductSlugs);
  const created = await prisma.product.create({
    data: {
      slug: finalSlug,
      name: displayName,
      brand: card.brand ?? null,
      categoryId: category.id,
    },
  });
  return created.id;
}

/**
 * §4.4: дедуп по sig и запрет на редактирование «на месте».
 * Совпал sig → только updatedAt; другой sig по той же связке → новая запись,
 * старая сама выпадает из выдачи по validTo.
 */
export async function savePromotion(card: RawCard, ctx: SaveContext): Promise<'created' | 'seen' | 'skipped'> {
  if (card.priceNew === null && card.priceOld === null && !card.bonus) return 'skipped';
  const productId = await resolveProduct(card, ctx);
  const storeIds = ctx.scope === 'store' ? [...ctx.storeIds].sort((a, b) => a - b) : [];

  const sig = computeSig({
    productId,
    scope: ctx.scope,
    storeIds,
    priceNew: card.priceNew,
    priceOld: card.priceOld,
    validFrom: card.validFrom,
    validTo: card.validTo,
    bonus: card.bonus,
  });

  const duplicate = await prisma.promotion.findUnique({ where: { sig } });
  if (duplicate) {
    await prisma.promotion.update({ where: { id: duplicate.id }, data: { updatedAt: new Date() } });
    return 'seen';
  }

  await prisma.promotion.create({
    data: {
      productId,
      scope: ctx.scope,
      priceOld: card.priceOld,
      priceNew: card.priceNew,
      discountPct: card.discountPct,
      bonus: card.bonus?.trim() ?? null,
      validFrom: card.validFrom,
      validTo: card.validTo,
      sourceUrl: card.sourceUrl,
      imageUrl: card.imageUrl,
      sig,
      stores: storeIds.length ? { create: storeIds.map((storeId) => ({ storeId })) } : undefined,
    },
  });
  return 'created';
}

export function emptySaveResult(): SaveResult {
  return { created: 0, seen: 0, skipped: 0 };
}

export async function saveCards(cards: RawCard[], ctx: SaveContext): Promise<SaveResult> {
  const result = emptySaveResult();
  for (const card of cards) {
    const outcome = await savePromotion(card, ctx);
    if (outcome === 'created') result.created++;
    else if (outcome === 'seen') result.seen++;
    else result.skipped++;
  }
  return result;
}
