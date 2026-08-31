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

export interface PriceRule {
  category: string
  operation: PriceOperation
}

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
  appliedRule?: PriceRule
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

export interface PriceBackupV1 {
  schemaVersion: 1
  createdAt: string
  sourceFile: string
  category: string
  operation: PriceOperation
  items: BackupItem[]
}

export interface PriceBackupV2 {
  schemaVersion: 2
  createdAt: string
  sourceFile: string
  category: string
  rules: PriceRule[]
  items: BackupItem[]
}

export type PriceBackup = PriceBackupV1 | PriceBackupV2

export interface RuleConflict {
  parentUid: string
  title: string
  matches: PriceRule[]
}

export interface MultiRuleResolution {
  rules: PriceRule[]
  ruleErrors: Array<string | null>
  conflicts: RuleConflict[]
  uniqueProductCount: number
  uniqueTargetCount: number
  overlapCount: number
}

export interface MultiOperationResult extends OperationResult {
  rules: PriceRule[]
  uniqueProductCount: number
  overlapCount: number
}

export interface RestoreResult {
  catalog: Catalog
  changes: PriceChange[]
  preview: PreviewProduct[]
  whitelist: Set<string>
  found: number
  missing: number
}
