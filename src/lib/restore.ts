import type { Catalog, PriceBackup, PriceChange, PreviewProduct, RestoreResult } from '../types'
import { firstPhoto, parsePrice, resolveProducts } from './catalog'

export class RestoreError extends Error {}

export function restorePrices(catalog: Catalog, backup: PriceBackup): RestoreResult {
  const rowsByUid = new Map(catalog.rows.map((row) => [row['Tilda UID'], row]))
  const foundItems = backup.items.filter((item) => rowsByUid.has(item.tildaUid))
  if (!foundItems.length) throw new RestoreError('В текущем каталоге не найдено товаров из этого backup.')

  const changes: PriceChange[] = foundItems.flatMap((item) => {
    const row = rowsByUid.get(item.tildaUid)!
    const oldPriceNumber = parsePrice(row.Price)
    const newPriceNumber = parsePrice(item.originalPrice)!
    if (oldPriceNumber === null) {
      throw new RestoreError('У найденной позиции в текущем каталоге указана некорректная цена.')
    }
    if (row.Price === item.originalPrice) return []
    return [{
      uid: item.tildaUid,
      parentUid: row['Parent UID'] || row['Tilda UID'],
      title: row.Title,
      editions: row.Editions || row.Title,
      oldPrice: row.Price,
      oldPriceNumber,
      newPrice: item.originalPrice,
      newPriceNumber,
    }]
  })
  if (!changes.length) throw new RestoreError('Все найденные цены уже совпадают с backup.')
  const prices = new Map(changes.map((change) => [change.uid, change.newPrice]))
  const rows = catalog.rows.map((row) => prices.has(row['Tilda UID']) ? { ...row, Price: prices.get(row['Tilda UID'])! } : { ...row })
  const products = resolveProducts(catalog)
  const productByRow = new Map<string, typeof products[number]>()
  for (const product of products) {
    productByRow.set(product.parent['Tilda UID'], product)
    for (const variant of product.variants) productByRow.set(variant['Tilda UID'], product)
  }
  const previewMap = new Map<string, PreviewProduct>()
  for (const change of changes) {
    const product = productByRow.get(change.uid)
    const key = product?.parent['Tilda UID'] ?? change.parentUid
    const existing = previewMap.get(key)
    if (existing) existing.changes.push(change)
    else previewMap.set(key, {
      parentUid: key,
      title: product?.parent.Title || change.title,
      photo: firstPhoto(product?.parent.Photo ?? ''),
      changes: [change],
    })
  }
  return {
    catalog: { headers: [...catalog.headers], rows },
    changes,
    preview: [...previewMap.values()],
    whitelist: new Set(changes.map((change) => change.uid)),
    found: foundItems.length,
    missing: backup.items.length - foundItems.length,
  }
}

