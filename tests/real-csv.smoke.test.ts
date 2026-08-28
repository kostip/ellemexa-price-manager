import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseCatalogCsv } from '../src/lib/csv'
import { extractCategories, resolveProducts, validateCatalog } from '../src/lib/catalog'
import { applyPriceOperation } from '../src/lib/pricing'
import { createBackup } from '../src/lib/backup'
import { createSafeCsv } from '../src/lib/safety'

describe('real ElleMexa CSV smoke test', () => {
  it('passes the complete discount/export safety pipeline', () => {
    const source = readFileSync('reference/store-9975565-202608271513.csv', 'utf8')
    const catalog = parseCatalogCsv(source)
    const validation = validateCatalog(catalog)
    expect(validation.valid).toBe(true)
    const products = resolveProducts(catalog)
    const categories = extractCategories(catalog)
    expect(products.length).toBeGreaterThan(0)
    expect(categories.length).toBeGreaterThan(0)
    expect(products.some((product) => product.categories.length > 1)).toBe(true)
    const category = categories.find((item) => item === 'OUTLET') ?? categories[0]
    const operation = { type: 'decrease_percent', value: 20 } as const
    const result = applyPriceOperation(catalog, category, operation)
    expect(result.changes.length).toBeGreaterThan(0)
    expect(result.preview.length).toBeGreaterThan(0)
    const backup = createBackup('store-9975565-202608271513.csv', category, operation, catalog, result)
    expect(backup.items).toHaveLength(result.changes.length)
    const csv = createSafeCsv(catalog, result.catalog, result.whitelist)
    const reparsed = parseCatalogCsv(csv)
    expect(reparsed.rows).toHaveLength(catalog.rows.length)
    expect(reparsed.headers).toEqual(catalog.headers)
  })
})

