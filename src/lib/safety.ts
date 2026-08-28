import type { Catalog } from '../types'
import { parseCatalogCsv, serializeCatalogCsv } from './csv'
import { validateCatalog } from './catalog'

export const SAFETY_ERROR = 'Не удалось безопасно сформировать файл. Обнаружены непредусмотренные изменения. Исходный каталог не изменен.'

function sameArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export function validateOutput(original: Catalog, output: Catalog, whitelist: Set<string>): void {
  if (!sameArray(original.headers, output.headers) || original.rows.length !== output.rows.length) throw new Error(SAFETY_ERROR)
  const changedUids = new Set<string>()
  for (let index = 0; index < original.rows.length; index += 1) {
    const before = original.rows[index]
    const after = output.rows[index]
    if (Object.keys(after).length !== output.headers.length) throw new Error(SAFETY_ERROR)
    for (const header of original.headers) {
      if (before[header] === after[header]) continue
      if (header !== 'Price' || !whitelist.has(before['Tilda UID'])) throw new Error(SAFETY_ERROR)
      changedUids.add(before['Tilda UID'])
    }
  }
  if (changedUids.size !== whitelist.size || [...whitelist].some((uid) => !changedUids.has(uid))) throw new Error(SAFETY_ERROR)
}

export function createSafeCsv(original: Catalog, expected: Catalog, whitelist: Set<string>): string {
  validateOutput(original, expected, whitelist)
  const csv = serializeCatalogCsv(expected)
  let reparsed: Catalog
  try {
    reparsed = parseCatalogCsv(csv)
  } catch {
    throw new Error(SAFETY_ERROR)
  }
  const validation = validateCatalog(reparsed)
  if (!validation.valid) throw new Error(SAFETY_ERROR)
  validateOutput(original, reparsed, whitelist)
  for (let i = 0; i < expected.rows.length; i += 1) {
    for (const header of expected.headers) {
      if (expected.rows[i][header] !== reparsed.rows[i][header]) throw new Error(SAFETY_ERROR)
    }
  }
  return csv
}

