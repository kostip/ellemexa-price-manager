import type { PriceOperation } from '../types'

export function rubles(value: number): string {
  return `${Math.round(value).toLocaleString('ru-RU')} ₽`
}

export function plural(value: number, forms: [string, string, string]): string {
  const mod100 = value % 100
  const mod10 = value % 10
  const form = mod100 >= 11 && mod100 <= 14 ? forms[2] : mod10 === 1 ? forms[0] : mod10 >= 2 && mod10 <= 4 ? forms[1] : forms[2]
  return `${value} ${form}`
}

export function operationLabel(operation: PriceOperation): string {
  switch (operation.type) {
    case 'decrease_percent': return `Снижение на ${operation.value}%`
    case 'increase_percent': return `Повышение на ${operation.value}%`
    case 'fixed_price': return `Одна цена ${rubles(operation.value)}`
    case 'adjust_amount': return `${operation.direction === 'add' ? 'Увеличение' : 'Уменьшение'} на ${rubles(operation.value)}`
  }
}

