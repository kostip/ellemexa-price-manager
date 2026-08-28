import type { PriceOperation } from '../types'

const TRANSLITERATION: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
}

export function slugifyCategory(value: string): string {
  const transliterated = [...value.toLowerCase()].map((char) => TRANSLITERATION[char] ?? char).join('')
  return transliterated
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'category'
}

function numberSlug(value: number): string {
  return String(value).replace('.', '-')
}

export function operationSlug(operation: PriceOperation): string {
  const value = numberSlug(operation.value)
  switch (operation.type) {
    case 'decrease_percent': return `discount-${value}pct`
    case 'increase_percent': return `increase-${value}pct`
    case 'fixed_price': return `fixed-${value}rub`
    case 'adjust_amount': return `${operation.direction === 'add' ? 'add' : 'subtract'}-${value}rub`
  }
}

export function localTimestamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}`
}

export function buildOperationFilenames(category: string, operation: PriceOperation, date = new Date()): { csv: string; backup: string } {
  const base = `ellemexa_${slugifyCategory(category)}_${operationSlug(operation)}_${localTimestamp(date)}`
  return { csv: `${base}.csv`, backup: `${base}_backup.json` }
}

export function buildRestoreFilename(category: string, date = new Date()): string {
  return `ellemexa_${slugifyCategory(category)}_restore_${localTimestamp(date)}.csv`
}

export function downloadText(content: string, filename: string, type: string): void {
  const blob = new Blob([type.includes('csv') ? '\uFEFF' : '', content], { type: `${type};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
