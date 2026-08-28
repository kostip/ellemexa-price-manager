import type { Catalog, OperationResult, PriceChange, PriceOperation, PreviewProduct, Product } from '../types'
import { firstPhoto, parsePrice, productsInCategory, resolvePriceTargets } from './catalog'

export class PriceOperationError extends Error {}

export function roundPrice(value: number): number {
  return Math.round(value / 10) * 10
}

export function validateOperation(operation: PriceOperation): string | null {
  if (!Number.isFinite(operation.value) || operation.value <= 0) {
    return operation.type === 'fixed_price' ? 'Укажите цену больше 0 ₽.' : 'Укажите значение больше 0.'
  }
  if (operation.type === 'decrease_percent' && operation.value >= 100) {
    return 'После такой скидки цена станет нулевой или отрицательной.'
  }
  return null
}

export function calculatePrice(current: number, operation: PriceOperation): number {
  switch (operation.type) {
    case 'decrease_percent': return roundPrice(current * (1 - operation.value / 100))
    case 'increase_percent': return roundPrice(current * (1 + operation.value / 100))
    case 'fixed_price': return operation.value
    case 'adjust_amount': return roundPrice(current + (operation.direction === 'add' ? operation.value : -operation.value))
  }
}

export function formatCsvPrice(value: number): string {
  return value.toFixed(2)
}

function makeChange(row: Record<string, string>, parent: Product['parent'], operation: PriceOperation): PriceChange {
  const oldPriceNumber = parsePrice(row.Price)
  if (oldPriceNumber === null) {
    throw new PriceOperationError('У нескольких товаров обнаружена некорректная цена. Исправьте цены в Tilda и загрузите каталог заново.')
  }
  const newPriceNumber = calculatePrice(oldPriceNumber, operation)
  if (!Number.isFinite(newPriceNumber) || newPriceNumber <= 0) {
    throw new PriceOperationError('Для части товаров цена станет нулевой или отрицательной. Уменьшите сумму изменения.')
  }
  return {
    uid: row['Tilda UID'],
    parentUid: row['Parent UID'] || parent['Tilda UID'],
    title: row.Title || parent.Title,
    editions: row.Editions || row.Title || parent.Title,
    oldPrice: row.Price,
    oldPriceNumber,
    newPrice: formatCsvPrice(newPriceNumber),
    newPriceNumber,
  }
}

export function buildPreview(products: Product[], changes: PriceChange[]): PreviewProduct[] {
  const byParent = new Map(changes.map((change) => [change.uid, change]))
  return products.flatMap((product) => {
    const productChanges = resolvePriceTargets(product).map((row) => byParent.get(row['Tilda UID'])).filter(Boolean) as PriceChange[]
    if (!productChanges.length) return []
    return [{
      parentUid: product.parent['Tilda UID'],
      title: product.parent.Title,
      photo: firstPhoto(product.parent.Photo ?? ''),
      changes: productChanges,
    }]
  })
}

export function applyPriceOperation(catalog: Catalog, category: string, operation: PriceOperation): OperationResult {
  const operationError = validateOperation(operation)
  if (operationError) throw new PriceOperationError(operationError)
  const products = productsInCategory(catalog, category)
  if (!products.length) throw new PriceOperationError('В выбранной категории не найдено товаров.')
  const targets = products.flatMap((product) => resolvePriceTargets(product).map((row) => ({ row, product })))
  if (!targets.length) throw new PriceOperationError('В выбранной категории не найдено товаров, у которых можно изменить цену.')
  const computed = targets.map(({ row, product }) => ({ row, change: makeChange(row, product.parent, operation) }))
  const changed = computed.filter(({ change }) => change.oldPrice !== change.newPrice)
  if (!changed.length) throw new PriceOperationError('Новые цены совпадают с текущими. Измените настройки операции.')
  const changes = changed.map(({ change }) => change)
  const changeMap = new Map(changes.map((change) => [change.uid, change.newPrice]))
  const rows = catalog.rows.map((row) => {
    const price = changeMap.get(row['Tilda UID'])
    return price === undefined ? { ...row } : { ...row, Price: price }
  })
  const whitelist = new Set(changeMap.keys())
  return { catalog: { headers: [...catalog.headers], rows }, changes, preview: buildPreview(products, changes), whitelist }
}

