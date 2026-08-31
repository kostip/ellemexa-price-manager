import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseCatalogCsv } from '../src/lib/csv'
import { extractCategories, resolveProducts, validateCatalog } from '../src/lib/catalog'
import { applyPriceOperation } from '../src/lib/pricing'
import { createBackup, createMultiBackup } from '../src/lib/backup'
import { createSafeCsv } from '../src/lib/safety'
import { restorePrices } from '../src/lib/restore'
import { applyPriceRules, resolvePriceRules } from '../src/lib/multiPricing'
import type { PriceRule } from '../src/types'

describe('real ElleMexa CSV smoke test', () => {
  it('passes the complete discount/export safety pipeline', () => {
    const source = readFileSync('reference/store-9975565-202608271513.csv', 'utf8')
    const catalog = parseCatalogCsv(source)
    const validation = validateCatalog(catalog)
    expect(validation.valid).toBe(true)
    const products = resolveProducts(catalog)
    const categories = extractCategories(catalog)
    expect(products.length).toBe(337)
    expect(catalog.rows.filter((row) => row['Parent UID'].trim()).length).toBe(1076)
    expect(categories.length).toBe(23)
    expect(products.some((product) => product.categories.length > 1)).toBe(true)
    const category = 'OUTLET'
    const operation = { type: 'decrease_percent', value: 20 } as const
    const result = applyPriceOperation(catalog, category, operation)
    expect(result.changes.length).toBe(187)
    expect(result.preview.length).toBe(57)
    const backup = createBackup('store-9975565-202608271513.csv', category, operation, catalog, result)
    expect(backup.items).toHaveLength(result.changes.length)
    const csv = createSafeCsv(catalog, result.catalog, result.whitelist)
    const reparsed = parseCatalogCsv(csv)
    expect(reparsed.rows).toHaveLength(catalog.rows.length)
    expect(reparsed.headers).toEqual(catalog.headers)
    const restored = restorePrices(result.catalog, backup)
    expect(restored.found).toBe(187)
    expect(restored.missing).toBe(0)
    expect(restored.changes).toHaveLength(187)
    const restoredCsv = createSafeCsv(result.catalog, restored.catalog, restored.whitelist)
    expect(parseCatalogCsv(restoredCsv).rows).toEqual(catalog.rows)
  })

  it('deduplicates identical real overlaps and blocks different rules', () => {
    const source = readFileSync('reference/store-9975565-202608271513.csv', 'utf8')
    const catalog = parseCatalogCsv(source)
    const selectedCategories = ['Шубы из натурального меха', 'Шубы натур.мех 55-75 см', 'Шубы натур.мех 90-130 см']
    const categories = extractCategories(catalog)
    expect(selectedCategories.every((category) => categories.includes(category))).toBe(true)
    const rules: PriceRule[] = selectedCategories.map((category) => ({ category, operation: { type: 'adjust_amount', direction: 'add', value: 10000 } }))
    const resolution = resolvePriceRules(catalog, rules)
    expect(resolution.conflicts).toHaveLength(0)
    expect(resolution.overlapCount).toBeGreaterThan(0)
    const result = applyPriceRules(catalog, rules)
    expect(result.uniqueProductCount).toBe(resolution.uniqueProductCount)
    expect(result.changes).toHaveLength(resolution.uniqueTargetCount)
    expect(new Set(result.changes.map((change) => change.uid)).size).toBe(result.changes.length)
    const backup = createMultiBackup('store-9975565-202608271513.csv', rules, catalog, result)
    expect(new Set(backup.items.map((item) => item.tildaUid)).size).toBe(backup.items.length)
    const csv = createSafeCsv(catalog, result.catalog, result.whitelist)
    expect(parseCatalogCsv(csv).rows).toHaveLength(catalog.rows.length)
    const restored = restorePrices(result.catalog, backup)
    expect(createSafeCsv(result.catalog, restored.catalog, restored.whitelist)).toBeTruthy()

    const conflictRules: PriceRule[] = [
      { category: selectedCategories[0], operation: { type: 'adjust_amount', direction: 'add', value: 10000 } },
      { category: selectedCategories[1], operation: { type: 'adjust_amount', direction: 'add', value: 15000 } },
    ]
    const conflictResolution = resolvePriceRules(catalog, conflictRules)
    expect(conflictResolution.conflicts.length).toBeGreaterThan(0)
    expect(() => applyPriceRules(catalog, conflictRules)).toThrow('Найдены товары')
    console.info('REAL_MULTI_SMOKE', JSON.stringify({
      categories: selectedCategories,
      identicalRules: '+10000 ₽',
      uniqueProducts: resolution.uniqueProductCount,
      uniquePriceTargets: resolution.uniqueTargetCount,
      overlaps: resolution.overlapCount,
      conflictsWithIdenticalRules: resolution.conflicts.length,
      conflictsWithDifferentRules: conflictResolution.conflicts.length,
      safetyValidation: 'passed',
    }))
  })
})
