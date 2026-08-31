import type { Catalog, MultiOperationResult, MultiRuleResolution, PriceRule, Product } from '../types'
import { productsInCategory, resolvePriceTargets, resolveProducts } from './catalog'
import { applyPriceOperation, buildPreview, PriceOperationError, validatePriceTargets } from './pricing'

export class MultiRuleError extends Error {
  constructor(message: string, public resolution: MultiRuleResolution) { super(message) }
}

export function operationKey(rule: PriceRule): string {
  const operation = rule.operation
  return `${operation.type}:${operation.type === 'adjust_amount' ? operation.direction : ''}:${Number(operation.value)}`
}

function assignedProducts(catalog: Catalog, rules: PriceRule[]): Map<string, { product: Product; matches: PriceRule[] }> {
  const assignments = new Map<string, { product: Product; matches: PriceRule[] }>()
  for (const rule of rules) {
    if (!rule.category) continue
    for (const product of productsInCategory(catalog, rule.category)) {
      const uid = product.parent['Tilda UID']
      const current = assignments.get(uid)
      if (current) current.matches.push(rule)
      else assignments.set(uid, { product, matches: [rule] })
    }
  }
  return assignments
}

export function resolvePriceRules(catalog: Catalog, rules: PriceRule[]): MultiRuleResolution {
  const categoryCounts = new Map<string, number>()
  for (const rule of rules) if (rule.category) categoryCounts.set(rule.category, (categoryCounts.get(rule.category) ?? 0) + 1)
  const ruleErrors = rules.map((rule) => {
    if (!rule.category) return 'Выберите категорию.'
    if ((categoryCounts.get(rule.category) ?? 0) > 1) return 'Эта категория уже добавлена.'
    const products = productsInCategory(catalog, rule.category)
    if (!products.length) return 'В выбранной категории не найдено товаров.'
    const targets = products.flatMap(resolvePriceTargets)
    if (!targets.length) return 'В категории нет товаров, у которых можно изменить цену.'
    return validatePriceTargets(targets, rule.operation)
  })
  const assignments = assignedProducts(catalog, rules)
  const conflicts = [...assignments.values()].flatMap(({ product, matches }) => {
    if (new Set(matches.map(operationKey)).size <= 1) return []
    return [{ parentUid: product.parent['Tilda UID'], title: product.parent.Title, matches }]
  })
  const uniqueTargets = new Set<string>()
  for (const { product } of assignments.values()) for (const row of resolvePriceTargets(product)) uniqueTargets.add(row['Tilda UID'])
  return {
    rules,
    ruleErrors,
    conflicts,
    uniqueProductCount: assignments.size,
    uniqueTargetCount: uniqueTargets.size,
    overlapCount: [...assignments.values()].filter(({ matches }) => matches.length > 1).length,
  }
}

export function applyPriceRules(catalog: Catalog, rules: PriceRule[]): MultiOperationResult {
  const resolution = resolvePriceRules(catalog, rules)
  if (resolution.ruleErrors.some(Boolean)) throw new MultiRuleError(resolution.ruleErrors.find(Boolean)!, resolution)
  if (resolution.conflicts.length) {
    throw new MultiRuleError('Найдены товары, которые входят сразу в несколько выбранных категорий с разными правилами изменения цены.', resolution)
  }
  const changesByUid = new Map<string, ReturnType<typeof applyPriceOperation>['changes'][number]>()
  for (const rule of rules) {
    const result = applyPriceOperation(catalog, rule.category, rule.operation)
    for (const change of result.changes) changesByUid.set(change.uid, change)
  }
  const changes = [...changesByUid.values()]
  if (!changes.length) throw new PriceOperationError('Новые цены совпадают с текущими. Измените настройки операции.')
  const priceByUid = new Map(changes.map((change) => [change.uid, change.newPrice]))
  const rows = catalog.rows.map((row) => priceByUid.has(row['Tilda UID']) ? { ...row, Price: priceByUid.get(row['Tilda UID'])! } : { ...row })
  const productByUid = new Map(resolveProducts(catalog).map((product) => [product.parent['Tilda UID'], product]))
  const assignments = assignedProducts(catalog, rules)
  const products = [...assignments.keys()].map((uid) => productByUid.get(uid)!).filter(Boolean)
  const preview = buildPreview(products, changes).map((item) => ({ ...item, appliedRule: assignments.get(item.parentUid)?.matches[0] }))
  return {
    catalog: { headers: [...catalog.headers], rows },
    changes,
    preview,
    whitelist: new Set(changesByUid.keys()),
    rules,
    uniqueProductCount: resolution.uniqueProductCount,
    overlapCount: resolution.overlapCount,
  }
}
