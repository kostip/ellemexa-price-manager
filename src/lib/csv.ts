import Papa from 'papaparse'
import type { Catalog, CatalogRow } from '../types'

export class CatalogCsvError extends Error {}

export function parseCatalogCsv(text: string): Catalog {
  if (!text.trim()) throw new CatalogCsvError('В файле не найдено данных каталога.')
  const result = Papa.parse<CatalogRow>(text.replace(/^\uFEFF/, ''), {
    header: true,
    delimiter: ';',
    skipEmptyLines: true,
    transformHeader: (header) => header.replace(/^\uFEFF/, ''),
  })
  const blocking = result.errors.filter((error) => error.type !== 'FieldMismatch')
  if (blocking.length || !result.meta.fields?.length) {
    throw new CatalogCsvError('Не удалось прочитать файл. Проверьте, что это CSV-экспорт каталога Tilda.')
  }
  if (!result.data.length) throw new CatalogCsvError('В файле не найдено данных каталога.')
  if (result.errors.some((error) => error.type === 'FieldMismatch')) {
    throw new CatalogCsvError('Не удалось прочитать файл. В строках каталога разное количество колонок.')
  }
  const headers = [...result.meta.fields]
  const rows = result.data.map((row) =>
    Object.fromEntries(headers.map((header) => [header, row[header] ?? ''])),
  )
  return { headers, rows }
}

export function serializeCatalogCsv(catalog: Catalog): string {
  return Papa.unparse(catalog.rows, {
    columns: catalog.headers,
    delimiter: ';',
    newline: '\r\n',
    quotes: false,
    escapeFormulae: false,
  })
}

