import { describe, expect, it } from 'vitest'
import type { Catalog, PriceBackupV1, PriceRule } from '../src/types'
import { applyPriceOperation } from '../src/lib/pricing'
import { applyPriceRules, operationKey, resolvePriceRules } from '../src/lib/multiPricing'
import { createMultiBackup, parseBackupJson } from '../src/lib/backup'
import { restorePrices } from '../src/lib/restore'
import { buildBackupRestoreFilename, buildRuleFilenames } from '../src/lib/download'
import { createSafeCsv } from '../src/lib/safety'

const headers = ['Tilda UID', 'Parent UID', 'Category', 'Title', 'Price', 'Price Old', 'Photo', 'Quantity', 'Editions']
const row = (values: Partial<Record<string, string>>) => Object.fromEntries(headers.map((header) => [header, values[header] ?? '']))
const fixture = (): Catalog => ({ headers, rows: [
  row({ 'Tilda UID': 'P1', Category: 'A;B', Title: 'Пересекающийся товар' }),
  row({ 'Tilda UID': 'V1', 'Parent UID': 'P1', Title: 'Размер 1', Price: '40000.00', 'Price Old': '60000' }),
  row({ 'Tilda UID': 'P2', Category: 'A', Title: 'Только A' }),
  row({ 'Tilda UID': 'V2', 'Parent UID': 'P2', Title: 'Размер 2', Price: '50000.00' }),
  row({ 'Tilda UID': 'P3', Category: 'C', Title: 'Только C', Price: '60000.00' }),
  row({ 'Tilda UID': 'P4', Category: 'D', Title: 'Максимум', Price: '9990000.00' }),
] })
const add = (category: string, value = 10000): PriceRule => ({ category, operation: { type: 'adjust_amount', direction: 'add', value } })

describe('multi-rule pricing', () => {
  it('normalizes equivalent numeric operation values', () => {
    expect(operationKey(add('A', 10000))).toBe(operationKey(add('B', 10000.0)))
  })

  it('keeps one-rule behavior compatible', () => {
    const catalog = fixture(), single = applyPriceOperation(catalog, 'A', add('A').operation), multi = applyPriceRules(catalog, [add('A')])
    expect(multi.catalog.rows).toEqual(single.catalog.rows)
    expect(multi.changes).toEqual(single.changes)
  })

  it('merges two categories with an identical rule', () => {
    const result = applyPriceRules(fixture(), [add('A'), add('B')])
    expect(result.uniqueProductCount).toBe(2)
    expect(result.changes).toHaveLength(2)
  })

  it('counts an overlapping parent only once', () => {
    expect(resolvePriceRules(fixture(), [add('A'), add('B')]).uniqueProductCount).toBe(2)
  })

  it('changes an overlapping price target only once', () => {
    const result = applyPriceRules(fixture(), [add('A'), add('B')])
    expect(result.changes.filter((change) => change.uid === 'V1')).toHaveLength(1)
  })

  it('produces 50 000, never 60 000, for a duplicated +10 000 match', () => {
    const result = applyPriceRules(fixture(), [add('A'), add('B')])
    expect(result.changes.find((change) => change.uid === 'V1')?.newPriceNumber).toBe(50000)
  })

  it('applies different rules to non-overlapping categories', () => {
    const result = applyPriceRules(fixture(), [add('A'), { category: 'C', operation: { type: 'decrease_percent', value: 10 } }])
    expect(result.changes.find((change) => change.uid === 'V1')?.newPriceNumber).toBe(50000)
    expect(result.changes.find((change) => change.uid === 'P3')?.newPriceNumber).toBe(54000)
  })

  it('detects +10k versus +15k on an overlapping product', () => {
    expect(resolvePriceRules(fixture(), [add('A'), add('B', 15000)]).conflicts).toHaveLength(1)
  })

  it('detects amount versus percent on an overlapping product', () => {
    expect(resolvePriceRules(fixture(), [add('A'), { category: 'B', operation: { type: 'increase_percent', value: 10 } }]).conflicts).toHaveLength(1)
  })

  it('blocks application and export when a conflict exists', () => {
    expect(() => applyPriceRules(fixture(), [add('A'), add('B', 15000)])).toThrow('Найдены товары')
  })

  it('forbids duplicate category rules', () => {
    expect(resolvePriceRules(fixture(), [add('A'), add('A')]).ruleErrors).toEqual(['Эта категория уже добавлена.', 'Эта категория уже добавлена.'])
  })

  it('reports unique parent and price-target counts', () => {
    const resolution = resolvePriceRules(fixture(), [add('A'), add('B'), add('C')])
    expect(resolution.uniqueProductCount).toBe(3)
    expect(resolution.uniqueTargetCount).toBe(3)
    expect(resolution.overlapCount).toBe(1)
  })

  it('creates schema v2 with rules and unique backup items', () => {
    const catalog = fixture(), rules = [add('A'), add('B')], result = applyPriceRules(catalog, rules)
    const backup = createMultiBackup('test.csv', rules, catalog, result)
    expect(backup.schemaVersion).toBe(2)
    expect(backup.rules).toEqual(rules)
    expect(new Set(backup.items.map((item) => item.tildaUid)).size).toBe(backup.items.length)
  })

  it('continues parsing and restoring schema v1', () => {
    const backup: PriceBackupV1 = { schemaVersion: 1, createdAt: new Date().toISOString(), sourceFile: 'old.csv', category: 'A', operation: add('A').operation, items: [{ tildaUid: 'V1', parentUid: 'P1', title: 'V1', originalPrice: '40000.00', originalPriceOld: '' }] }
    const current = fixture(); current.rows[1].Price = '50000.00'
    expect(restorePrices(current, parseBackupJson(JSON.stringify(backup))).catalog.rows[1].Price).toBe('40000.00')
  })

  it('parses and restores schema v2', () => {
    const catalog = fixture(), rules = [add('A'), add('B')], changed = applyPriceRules(catalog, rules), backup = createMultiBackup('test.csv', rules, catalog, changed)
    const restored = restorePrices(changed.catalog, parseBackupJson(JSON.stringify(backup)))
    expect(restored.catalog.rows).toEqual(catalog.rows)
  })

  it('builds multi filenames and keeps single filenames compatible', () => {
    const date = new Date(2026, 7, 30, 19, 30)
    expect(buildRuleFilenames([add('A'), add('B'), add('C')], date).csv).toBe('ellemexa_multi-3-categories_2026-08-30_19-30.csv')
    expect(buildRuleFilenames([add('OUTLET')], date).csv).toContain('ellemexa_outlet_add-10000rub_')
  })

  it('builds a multi restore filename', () => {
    const catalog = fixture(), rules = [add('A'), add('B')], result = applyPriceRules(catalog, rules), backup = createMultiBackup('test.csv', rules, catalog, result)
    expect(buildBackupRestoreFilename(backup, new Date(2026, 7, 30, 22, 10))).toBe('ellemexa_multi-2-categories_restore_2026-08-30_22-10.csv')
  })

  it('applies the 10M limit independently to every rule', () => {
    expect(resolvePriceRules(fixture(), [add('A'), add('D', 10000)]).ruleErrors).toEqual([null, null])
    expect(resolvePriceRules(fixture(), [add('A'), add('D', 10010)]).ruleErrors[1]).toContain('10 000 000')
  })

  it('blocks the whole operation when one rule is invalid', () => {
    const rules: PriceRule[] = [add('A'), { category: 'C', operation: { type: 'decrease_percent', value: 100 } }]
    expect(() => applyPriceRules(fixture(), rules)).toThrow('нулевой или отрицательной')
  })

  it('still passes strict CSV safety validation', () => {
    const catalog = fixture(), result = applyPriceRules(catalog, [add('A'), add('B')])
    expect(() => createSafeCsv(catalog, result.catalog, result.whitelist)).not.toThrow()
  })
})
