import type { Catalog, CatalogRow, Product, ValidationResult } from '../types'

const REQUIRED_HEADERS = ['Tilda UID', 'Parent UID', 'Category', 'Price', 'Title']

export function splitCategories(value: string): string[] {
  return value.split(';').map((item) => item.trim()).filter(Boolean)
}

export function validateCatalog(catalog: Catalog): ValidationResult {
  const errors: string[] = []
  const missingMessages: Record<string, string> = {
    'Tilda UID': 'В файле отсутствует обязательное поле Tilda UID.',
    'Parent UID': 'В файле отсутствует поле Parent UID. Невозможно безопасно определить варианты товаров.',
    Category: 'В файле отсутствует поле Category.',
    Price: 'В файле отсутствует поле Price.',
    Title: 'В файле отсутствует поле Title.',
  }
  for (const header of REQUIRED_HEADERS) {
    if (!catalog.headers.includes(header)) errors.push(missingMessages[header])
  }
  if (errors.length) return { valid: false, errors, warnings: [] }

  const uids = catalog.rows.map((row) => row['Tilda UID'].trim())
  if (uids.some((uid) => !uid)) errors.push('В каталоге есть строки без Tilda UID.')
  if (new Set(uids).size !== uids.length) {
    errors.push('В каталоге обнаружены повторяющиеся Tilda UID. Невозможно безопасно изменить цены.')
  }
  const products = resolveProducts(catalog)
  if (!products.length) errors.push('В каталоге не найдены основные товары.')
  const categories = extractCategories(catalog)
  if (!categories.length) errors.push('В каталоге не найдено категорий.')
  const withoutPrice = products.filter((product) => resolvePriceTargets(product).length === 0).length
  const orphanCount = catalog.rows.filter(
    (row) => row['Parent UID'].trim() && !uids.includes(row['Parent UID'].trim()),
  ).length
  const warnings: string[] = []
  if (withoutPrice) warnings.push(`${withoutPrice} товаров не имеют цены и не смогут участвовать в изменении.`)
  if (orphanCount) warnings.push(`${orphanCount} вариантов не удалось связать с основным товаром.`)
  return { valid: errors.length === 0, errors, warnings }
}

export function resolveProducts(catalog: Catalog): Product[] {
  const parents = catalog.rows.filter((row) => !row['Parent UID']?.trim())
  const variantsByParent = new Map<string, CatalogRow[]>()
  for (const row of catalog.rows) {
    const parentUid = row['Parent UID']?.trim()
    if (!parentUid) continue
    const variants = variantsByParent.get(parentUid) ?? []
    variants.push(row)
    variantsByParent.set(parentUid, variants)
  }
  return parents.map((parent) => ({
    parent,
    variants: variantsByParent.get(parent['Tilda UID'].trim()) ?? [],
    categories: splitCategories(parent.Category ?? ''),
  }))
}

export function extractCategories(catalog: Catalog): string[] {
  return [...new Set(resolveProducts(catalog).flatMap((product) => product.categories))]
    .sort((a, b) => a.localeCompare(b, 'ru'))
}

export function productsInCategory(catalog: Catalog, category: string): Product[] {
  return resolveProducts(catalog).filter((product) => product.categories.includes(category))
}

export function resolvePriceTargets(product: Product): CatalogRow[] {
  const pricedVariants = product.variants.filter((variant) => variant.Price?.trim())
  if (pricedVariants.length) return pricedVariants
  return product.parent.Price?.trim() ? [product.parent] : []
}

export function firstPhoto(value: string): string | undefined {
  return value.trim().split(/\s+/)[0] || undefined
}

export function parsePrice(value: string): number | null {
  const normalized = value.trim().replace(/\s/g, '').replace(',', '.')
  if (!normalized || !/^\d+(?:\.\d+)?$/.test(normalized)) return null
  const price = Number(normalized)
  return Number.isFinite(price) && price > 0 ? price : null
}

