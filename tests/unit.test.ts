import { describe, expect, it } from 'vitest'
import type { Catalog, PriceBackup } from '../src/types'
import { extractCategories, productsInCategory, resolvePriceTargets, resolveProducts, splitCategories } from '../src/lib/catalog'
import { applyPriceOperation, calculatePrice } from '../src/lib/pricing'
import { createBackup } from '../src/lib/backup'
import { restorePrices } from '../src/lib/restore'
import { createSafeCsv, SAFETY_ERROR, validateOutput } from '../src/lib/safety'
import { parseCatalogCsv } from '../src/lib/csv'

const headers = ['Tilda UID', 'Parent UID', 'Category', 'Title', 'Price', 'Price Old', 'Photo', 'Quantity', 'Editions', 'Description', 'Custom']
const row = (values: Partial<Record<string, string>>) => Object.fromEntries(headers.map((header) => [header, values[header] ?? '']))
const fixture = (): Catalog => ({ headers, rows: [
  row({ 'Tilda UID': 'P1', Category: 'ПАРКИ 70 см;OUTLET', Title: 'Парка', Photo: 'https://example.test/a.jpg', Description: '<b>Текст; с точкой</b>', Custom: 'не менять' }),
  row({ 'Tilda UID': 'V1', 'Parent UID': 'P1', Title: 'Парка 40', Price: '39990.00', 'Price Old': '62000', Editions: 'Размер:40', Quantity: '2' }),
  row({ 'Tilda UID': 'V2', 'Parent UID': 'P1', Title: 'Парка 42', Price: '42000.00', 'Price Old': '62000', Editions: 'Размер:42', Quantity: '1' }),
  row({ 'Tilda UID': 'P2', Category: 'OUTLET', Title: 'Без вариантов', Price: '50000.00', 'Price Old': '70000' }),
  row({ 'Tilda UID': 'P3', Category: 'БЕЗ ЦЕНЫ', Title: 'Без цены' }),
] })

describe('catalog model', () => {
  it('splits a multi-category cell after CSV parsing', () => {
    expect(splitCategories('ПАРКИ 70 см;OUTLET')).toEqual(['ПАРКИ 70 см', 'OUTLET'])
  })

  it('links variants to their parent and resolves variant prices first', () => {
    const product = resolveProducts(fixture())[0]
    expect(product.variants.map((item) => item['Tilda UID'])).toEqual(['V1', 'V2'])
    expect(resolvePriceTargets(product).map((item) => item['Tilda UID'])).toEqual(['V1', 'V2'])
  })

  it('selects the same parent by each exact category', () => {
    const catalog = fixture()
    expect(productsInCategory(catalog, 'ПАРКИ 70 см').map((p) => p.parent['Tilda UID'])).toEqual(['P1'])
    expect(productsInCategory(catalog, 'OUTLET').map((p) => p.parent['Tilda UID'])).toEqual(['P1', 'P2'])
    expect(extractCategories(catalog)).toContain('OUTLET')
  })
})

describe('price calculations', () => {
  it('calculates and rounds a 20% discount', () => expect(calculatePrice(39990, { type: 'decrease_percent', value: 20 })).toBe(31990))
  it('calculates and rounds a 20% increase', () => expect(calculatePrice(39990, { type: 'increase_percent', value: 20 })).toBe(47990))
  it('sets a fixed price without extra rounding', () => expect(calculatePrice(39990, { type: 'fixed_price', value: 38001 })).toBe(38001))
  it('adds 10000', () => expect(calculatePrice(39990, { type: 'adjust_amount', value: 10000, direction: 'add' })).toBe(49990))
  it('subtracts 10000', () => expect(calculatePrice(39990, { type: 'adjust_amount', value: 10000, direction: 'subtract' })).toBe(29990))
  it('blocks a non-positive resulting price', () => {
    expect(() => applyPriceOperation(fixture(), 'OUTLET', { type: 'adjust_amount', value: 60000, direction: 'subtract' })).toThrow('нулевой или отрицательной')
  })

  it('changes Price but never Price Old', () => {
    const result = applyPriceOperation(fixture(), 'ПАРКИ 70 см', { type: 'decrease_percent', value: 20 })
    expect(result.catalog.rows.find((item) => item['Tilda UID'] === 'V1')?.Price).toBe('31990.00')
    expect(result.catalog.rows.find((item) => item['Tilda UID'] === 'V1')?.['Price Old']).toBe('62000')
  })
})

describe('backup and restore', () => {
  it('stores the exact original Price', () => {
    const catalog = fixture()
    const operation = { type: 'decrease_percent', value: 20 } as const
    const result = applyPriceOperation(catalog, 'ПАРКИ 70 см', operation)
    const backup = createBackup('test.csv', 'ПАРКИ 70 см', operation, catalog, result)
    expect(backup.items.find((item) => item.tildaUid === 'V1')?.originalPrice).toBe('39990.00')
  })

  it('restores only Price from backup', () => {
    const fresh = fixture()
    fresh.rows[1] = { ...fresh.rows[1], Price: '31990.00', 'Price Old': '65000', Photo: 'fresh.jpg' }
    const backup: PriceBackup = { schemaVersion: 1, createdAt: new Date().toISOString(), sourceFile: 'a.csv', category: 'OUTLET', operation: { type: 'decrease_percent', value: 20 }, items: [{ tildaUid: 'V1', parentUid: 'P1', title: 'Парка 40', originalPrice: '39990.00', originalPriceOld: '62000' }] }
    const restored = restorePrices(fresh, backup)
    expect(restored.catalog.rows[1]).toMatchObject({ Price: '39990.00', 'Price Old': '65000', Photo: 'fresh.jpg' })
  })

  it('allows partial restore and does not touch new rows', () => {
    const fresh = fixture()
    fresh.rows[1] = { ...fresh.rows[1], Price: '31000.00' }
    fresh.rows.push(row({ 'Tilda UID': 'NEW', Category: 'OUTLET', Title: 'Новый', Price: '77777.00' }))
    const backup: PriceBackup = { schemaVersion: 1, createdAt: new Date().toISOString(), sourceFile: 'a.csv', category: 'OUTLET', operation: { type: 'fixed_price', value: 31000 }, items: [
      { tildaUid: 'V1', parentUid: 'P1', title: 'V1', originalPrice: '39990.00', originalPriceOld: '' },
      { tildaUid: 'MISSING', parentUid: 'P9', title: 'Missing', originalPrice: '50000.00', originalPriceOld: '' },
    ] }
    const restored = restorePrices(fresh, backup)
    expect(restored.found).toBe(1); expect(restored.missing).toBe(1)
    expect(restored.catalog.rows.at(-1)?.Price).toBe('77777.00')
  })
})

describe('safety and CSV export', () => {
  it('blocks a changed Photo', () => {
    const original = fixture(); const output = structuredClone(original); output.rows[1].Photo = 'changed.jpg'
    expect(() => validateOutput(original, output, new Set(['V1']))).toThrow(SAFETY_ERROR)
  })

  it('blocks any unknown field change', () => {
    const original = fixture(); const output = structuredClone(original); output.rows[1].Custom = 'changed'
    expect(() => validateOutput(original, output, new Set(['V1']))).toThrow(SAFETY_ERROR)
  })

  it('round-trips an exported CSV with logical values intact', () => {
    const original = fixture()
    const result = applyPriceOperation(original, 'ПАРКИ 70 см', { type: 'decrease_percent', value: 20 })
    const csv = createSafeCsv(original, result.catalog, result.whitelist)
    const reparsed = parseCatalogCsv(csv)
    expect(reparsed.headers).toEqual(original.headers)
    expect(reparsed.rows[0].Description).toBe('<b>Текст; с точкой</b>')
    expect(reparsed.rows[1]['Price Old']).toBe('62000')
  })
})

