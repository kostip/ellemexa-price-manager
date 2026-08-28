import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseCatalogCsv } from '../src/lib/csv'
import { extractCategories, resolveProducts, validateCatalog } from '../src/lib/catalog'
import { applyPriceOperation } from '../src/lib/pricing'
import { createBackup } from '../src/lib/backup'
import { createSafeCsv } from '../src/lib/safety'
import { restorePrices } from '../src/lib/restore'

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
})
