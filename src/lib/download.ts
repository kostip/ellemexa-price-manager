export function timestamp(date = new Date()): string {
  const parts = [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes()]
  return parts.map((value) => String(value).padStart(2, '0')).join('').replace(/^(\d{8})(\d{4})$/, '$1-$2')
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

