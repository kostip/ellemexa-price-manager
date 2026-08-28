import type { Catalog, PriceBackup, PriceOperation, OperationResult } from '../types'
import { parsePrice } from './catalog'

export class BackupError extends Error {}

export function createBackup(
  sourceFile: string,
  category: string,
  operation: PriceOperation,
  original: Catalog,
  result: OperationResult,
  now = new Date(),
): PriceBackup {
  const originalByUid = new Map(original.rows.map((row) => [row['Tilda UID'], row]))
  return {
    schemaVersion: 1,
    createdAt: now.toISOString(),
    sourceFile,
    category,
    operation,
    items: result.changes.map((change) => {
      const row = originalByUid.get(change.uid)!
      return {
        tildaUid: change.uid,
        parentUid: row['Parent UID'] ?? '',
        title: row.Title ?? '',
        originalPrice: row.Price,
        originalPriceOld: row['Price Old'] ?? '',
      }
    }),
  }
}

export function parseBackupJson(text: string): PriceBackup {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new BackupError('Выберите backup-файл в формате JSON.')
  }
  return validateBackup(value)
}

export function validateBackup(value: unknown): PriceBackup {
  if (!value || typeof value !== 'object') throw new BackupError('Этот файл не является backup-файлом утилиты.')
  const backup = value as Partial<PriceBackup>
  if (backup.schemaVersion === undefined) throw new BackupError('Не удалось определить версию backup.')
  if (backup.schemaVersion !== 1) throw new BackupError('Backup создан несовместимой версией утилиты.')
  if (!Array.isArray(backup.items)) throw new BackupError('Этот файл не является backup-файлом утилиты.')
  if (!backup.items.length) throw new BackupError('В backup нет данных для восстановления.')
  if (!backup.createdAt || !backup.sourceFile || !backup.category || !backup.operation) {
    throw new BackupError('Этот файл не является backup-файлом утилиты.')
  }
  const uids = new Set<string>()
  for (const item of backup.items) {
    if (!item || typeof item !== 'object' || typeof item.tildaUid !== 'string' || !item.tildaUid.trim() ||
        typeof item.originalPrice !== 'string' || parsePrice(item.originalPrice) === null) {
      throw new BackupError('Этот файл не является backup-файлом утилиты.')
    }
    if (uids.has(item.tildaUid)) throw new BackupError('В backup обнаружены повторяющиеся идентификаторы. Восстановление остановлено.')
    uids.add(item.tildaUid)
  }
  return backup as PriceBackup
}

