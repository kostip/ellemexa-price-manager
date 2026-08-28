export type CatalogRow = Record<string, string>

export interface Catalog {
  headers: string[]
  rows: CatalogRow[]
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export interface Product {
  parent: CatalogRow
  variants: CatalogRow[]
  categories: string[]
}

export type PriceOperation =
  | { type: 'decrease_percent'; value: number }
  | { type: 'increase_percent'; value: number }
  | { type: 'fixed_price'; value: number }
  | { type: 'adjust_amount'; value: number; direction: 'add' | 'subtract' }

export interface PriceChange {
  uid: string
  parentUid: string
  title: string
  editions: string
  oldPrice: string
  oldPriceNumber: number
  newPrice: string
  newPriceNumber: number
}

export interface PreviewProduct {
  parentUid: string
  title: string
  photo?: string
  changes: PriceChange[]
}

export interface OperationResult {
  catalog: Catalog
  changes: PriceChange[]
  preview: PreviewProduct[]
  whitelist: Set<string>
}

export interface BackupItem {
  tildaUid: string
  parentUid: string
  title: string
  originalPrice: string
  originalPriceOld: string
}

export interface PriceBackup {
  schemaVersion: 1
  createdAt: string
  sourceFile: string
  category: string
  operation: PriceOperation
  items: BackupItem[]
}

export interface RestoreResult {
  catalog: Catalog
  changes: PriceChange[]
  preview: PreviewProduct[]
  whitelist: Set<string>
  found: number
  missing: number
}

