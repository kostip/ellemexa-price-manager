import { useMemo, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react'
import type { Catalog, OperationResult, PriceBackup, PriceOperation, PreviewProduct, RestoreResult } from './types'
import { parseCatalogCsv } from './lib/csv'
import { extractCategories, productsInCategory, resolvePriceTargets, validateCatalog } from './lib/catalog'
import { applyPriceOperation, calculatePrice, validateOperation } from './lib/pricing'
import { createBackup, parseBackupJson } from './lib/backup'
import { restorePrices } from './lib/restore'
import { createSafeCsv } from './lib/safety'
import { downloadText, timestamp } from './lib/download'
import { operationLabel, plural, rubles } from './lib/format'

interface LoadedCatalog { catalog: Catalog; filename: string; warnings: string[] }

function Notice({ kind, children }: { kind: 'success' | 'error' | 'warning' | 'info'; children: ReactNode }) {
  return <div className={`notice notice--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>
}

function FileDrop({ label, accept, onFile, disabled = false }: { label: string; accept: string; onFile: (file: File) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const select = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) onFile(file)
    event.target.value = ''
  }
  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault(); setDragging(false)
    const file = event.dataTransfer.files?.[0]
    if (file && !disabled) onFile(file)
  }
  return <div className={`dropzone ${dragging ? 'dropzone--active' : ''}`} onDragOver={(e) => { e.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={drop}>
    <input ref={input} className="visually-hidden" type="file" accept={accept} onChange={select} disabled={disabled} />
    <div className="dropzone__icon" aria-hidden="true">↑</div>
    <button className="button button--primary" type="button" onClick={() => input.current?.click()} disabled={disabled}>{label}</button>
    <span>или перетащите файл сюда</span>
  </div>
}

async function readFile(file: File): Promise<string> {
  try { return await file.text() } catch { throw new Error('Не удалось прочитать файл.') }
}

function CatalogReady({ loaded, onReplace }: { loaded: LoadedCatalog; onReplace: () => void }) {
  const parents = loaded.catalog.rows.filter((row) => !row['Parent UID'].trim()).length
  const variants = loaded.catalog.rows.length - parents
  return <>
    <Notice kind="success"><strong>Файл готов к работе</strong><span>{loaded.filename}</span><span>{plural(parents, ['товар', 'товара', 'товаров'])} · {plural(variants, ['вариант', 'варианта', 'вариантов'])} · {plural(extractCategories(loaded.catalog).length, ['категория', 'категории', 'категорий'])}</span></Notice>
    {loaded.warnings.map((warning) => <Notice key={warning} kind="warning">{warning}</Notice>)}
    <button className="button button--text" type="button" onClick={onReplace}>Заменить файл</button>
  </>
}

function PriceRange({ preview, mode }: { preview: PreviewProduct; mode: 'change' | 'restore' }) {
  const old = preview.changes.map((change) => change.oldPriceNumber)
  const next = preview.changes.map((change) => change.newPriceNumber)
  const summarize = (values: number[]) => Math.min(...values) === Math.max(...values) ? rubles(values[0]) : `от ${rubles(Math.min(...values))}`
  return <div className="price-pair"><div><span>{mode === 'restore' ? 'Сейчас' : 'Было'}</span><strong>{summarize(old)}</strong></div><span className="price-arrow">→</span><div><span>{mode === 'restore' ? 'Вернется' : 'Станет'}</span><strong className="price-new">{summarize(next)}</strong></div></div>
}

function ProductImage({ src }: { src?: string }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) return <div className="product-photo product-photo--empty" aria-label="Нет фото">Фото</div>
  return <img className="product-photo" src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
}

function PreviewList({ items, mode }: { items: PreviewProduct[]; mode: 'change' | 'restore' }) {
  return <div className="preview-list">{items.map((item) => <article className="product-card" key={item.parentUid}>
    <div className="product-card__top"><ProductImage src={item.photo} /><div className="product-card__body"><h3>{item.title || 'Без названия'}</h3><p>{plural(item.changes.length, ['цена', 'цены', 'цен'])}</p><PriceRange preview={item} mode={mode} /></div></div>
    <details><summary>Показать варианты</summary><div className="variants">{item.changes.map((change) => <div className="variant" key={change.uid}><span>{change.editions}</span><span>{rubles(change.oldPriceNumber)} → <strong>{rubles(change.newPriceNumber)}</strong></span></div>)}</div></details>
  </article>)}</div>
}

function ImportInstructions() {
  return <section className="card instructions"><h2>Как загрузить файл обратно в Tilda</h2><ol><li>Откройте каталог Tilda.</li><li>Выберите импорт товаров из CSV и загрузите созданный файл.</li><li>Проверьте сопоставление полей.</li><li>Включите «Обновить только существующие товары и не создавать новые».</li><li>Не включайте замену изображений и тегов.</li><li>Выберите группировку вариантов по Parent UID.</li><li>Запустите обновление.</li></ol></section>
}

function parseOperation(type: PriceOperation['type'], valueText: string, direction: 'add' | 'subtract'): PriceOperation {
  const value = Number(valueText.replace(',', '.'))
  return type === 'adjust_amount' ? { type, value, direction } : { type, value } as PriceOperation
}

function MainFlow({ onRestore }: { onRestore: () => void }) {
  const [loaded, setLoaded] = useState<LoadedCatalog | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [category, setCategory] = useState('')
  const [operationType, setOperationType] = useState<PriceOperation['type']>('decrease_percent')
  const [value, setValue] = useState('20')
  const [direction, setDirection] = useState<'add' | 'subtract'>('add')
  const [result, setResult] = useState<OperationResult | null>(null)
  const [backup, setBackup] = useState<PriceBackup | null>(null)
  const [safeCsv, setSafeCsv] = useState('')

  const reset = () => { setLoaded(null); setError(''); setCategory(''); setResult(null); setBackup(null); setSafeCsv('') }
  const upload = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv')) { setError('Поддерживаются только CSV-файлы.'); return }
    setLoading(true); setError(''); setResult(null)
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    try {
      const catalog = parseCatalogCsv(await readFile(file))
      const validation = validateCatalog(catalog)
      if (!validation.valid) throw new Error(validation.errors.join(' '))
      setLoaded({ catalog, filename: file.name, warnings: validation.warnings })
      setCategory('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Файл невозможно прочитать.') }
    finally { setLoading(false) }
  }
  const categories = useMemo(() => loaded ? extractCategories(loaded.catalog) : [], [loaded])
  const categoryProducts = useMemo(() => loaded && category ? productsInCategory(loaded.catalog, category) : [], [loaded, category])
  const targetRows = useMemo(() => categoryProducts.flatMap(resolvePriceTargets), [categoryProducts])
  const operation = parseOperation(operationType, value, direction)
  const operationError = category ? validateOperation(operation) : null
  const sample = targetRows.map((row) => Number(row.Price)).find((price) => Number.isFinite(price) && price > 0)
  const showPreview = () => {
    if (!loaded) return
    setError('')
    try {
      const next = applyPriceOperation(loaded.catalog, category, operation)
      const csv = createSafeCsv(loaded.catalog, next.catalog, next.whitelist)
      setResult(next); setSafeCsv(csv); setBackup(createBackup(loaded.filename, category, operation, loaded.catalog, next))
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось рассчитать цены.') }
  }

  if (result && loaded && backup) return <>
    <header className="page-header"><span className="eyebrow">Шаг 3 из 3</span><h1>Предпросмотр изменений</h1><p>{category} · {operationLabel(operation)}</p></header>
    <section className="summary-strip"><strong>{plural(result.preview.length, ['товар', 'товара', 'товаров'])}</strong><strong>{plural(result.changes.length, ['строка с ценой', 'строки с ценой', 'строк с ценой'])}</strong></section>
    <PreviewList items={result.preview} mode="change" />
    <Notice kind="success"><strong>Проверка пройдена</strong><span>Изменяется только Price. Остальные данные сохранены без изменений.</span></Notice>
    <div className="actions"><button className="button button--primary" onClick={() => downloadText(safeCsv, `ellemexa-prices-${timestamp()}.csv`, 'text/csv')}>Скачать новый CSV</button><button className="button button--secondary" onClick={() => downloadText(JSON.stringify(backup, null, 2), `ellemexa-backup-${timestamp()}.json`, 'application/json')}>Скачать backup цен</button><p className="hint">Сохраните backup, если захотите позже вернуть цены до акции.</p><button className="button button--text" onClick={() => { setResult(null); setError(''); window.scrollTo(0, 0) }}>Изменить настройки</button><button className="button button--text" onClick={reset}>Начать заново</button></div>
    <ImportInstructions />
  </>

  return <>
    <header className="page-header"><span className="eyebrow">ElleMexa · внутренняя утилита</span><h1>Массовое изменение цен</h1><p className="subtitle">для каталога Tilda</p><p>Загрузите CSV, выберите категорию и проверьте новые цены перед скачиванием.</p></header>
    {!loaded && <section className="card"><FileDrop label="Загрузить CSV" accept=".csv,text/csv" onFile={upload} disabled={loading} />{loading && <Notice kind="info">Читаем каталог…</Notice>}<div className="privacy"><p>Файл обрабатывается прямо в браузере и никуда не загружается.</p><p>Панель изменяет только цены. Фотографии, размеры, остатки, описания и другие данные остаются без изменений.</p></div><button className="button button--secondary button--full" onClick={onRestore}>Восстановить цены из backup</button></section>}
    {error && <Notice kind="error">{error}</Notice>}
    {loaded && <><CatalogReady loaded={loaded} onReplace={reset} /><section className="card form-card"><span className="eyebrow">Шаг 2 из 3</span><h2>Настройка изменения</h2><label>Категория<select value={category} onChange={(event) => { setCategory(event.target.value); setError('') }}><option value="">Выберите категорию</option>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>{category && <div className="stats"><span>Найдено: <strong>{plural(categoryProducts.length, ['товар', 'товара', 'товаров'])}</strong></span><span>Будет затронуто: <strong>{plural(targetRows.length, ['строка с ценой', 'строки с ценой', 'строк с ценой'])}</strong></span></div>}<fieldset disabled={!category}><legend>Как изменить цену?</legend><div className="radio-list">{([
      ['decrease_percent', 'Снизить на %'], ['increase_percent', 'Повысить на %'], ['fixed_price', 'Установить одну цену'], ['adjust_amount', 'Изменить на сумму'],
    ] as const).map(([type, label]) => <label className="radio" key={type}><input type="radio" name="operation" checked={operationType === type} onChange={() => setOperationType(type)} /><span>{label}</span></label>)}</div></fieldset>{operationType === 'adjust_amount' && <div className="segmented"><button type="button" className={direction === 'add' ? 'active' : ''} onClick={() => setDirection('add')}>+ Прибавить</button><button type="button" className={direction === 'subtract' ? 'active' : ''} onClick={() => setDirection('subtract')}>− Вычесть</button></div>}<label>{operationType.includes('percent') ? 'Процент' : operationType === 'fixed_price' ? 'Новая цена, ₽' : 'Сумма, ₽'}<input type="number" min="0" inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} /></label>{operationError && <Notice kind="error">{operationError}</Notice>}{sample && !operationError && calculatePrice(sample, operation) > 0 && <div className="example"><span>Пример</span><strong>{rubles(sample)} → {rubles(calculatePrice(sample, operation))}</strong></div>}<Notice kind="info">Будет изменено только поле Price.</Notice><button className="button button--primary button--full" disabled={!category || !!operationError || !targetRows.length} onClick={showPreview}>Показать изменения</button></section></>}
  </>
}

function RestoreFlow({ onMain }: { onMain: () => void }) {
  const [loaded, setLoaded] = useState<LoadedCatalog | null>(null)
  const [backup, setBackup] = useState<PriceBackup | null>(null)
  const [result, setResult] = useState<RestoreResult | null>(null)
  const [safeCsv, setSafeCsv] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const uploadCatalog = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv')) { setError('Поддерживаются только CSV-файлы.'); return }
    setLoading(true); setError('')
    try { const catalog = parseCatalogCsv(await readFile(file)); const validation = validateCatalog(catalog); if (!validation.valid) throw new Error(validation.errors.join(' ')); setLoaded({ catalog, filename: file.name, warnings: validation.warnings }) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Файл невозможно прочитать.') }
    finally { setLoading(false) }
  }
  const uploadBackup = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.json')) { setError('Выберите backup-файл в формате JSON.'); return }
    if (!loaded) return
    setLoading(true); setError('')
    try { const parsed = parseBackupJson(await readFile(file)); const restored = restorePrices(loaded.catalog, parsed); setSafeCsv(createSafeCsv(loaded.catalog, restored.catalog, restored.whitelist)); setBackup(parsed); setResult(restored); window.scrollTo(0, 0) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось прочитать backup.') }
    finally { setLoading(false) }
  }
  if (loaded && backup && result) return <><header className="page-header"><span className="eyebrow">Восстановление</span><h1>Предпросмотр восстановления</h1><p>{backup.category} · backup от {new Date(backup.createdAt).toLocaleDateString('ru-RU')}</p></header><Notice kind={result.missing ? 'warning' : 'success'}><strong>Найдено {result.found} из {backup.items.length}</strong>{result.missing > 0 && <span>{plural(result.missing, ['позиция будет пропущена', 'позиции будут пропущены', 'позиций будут пропущены'])}.</span>}</Notice><PreviewList items={result.preview} mode="restore" /><Notice kind="success"><strong>Проверка пройдена</strong><span>Восстанавливается только Price. Price Old и остальные данные свежего каталога сохранены.</span></Notice><div className="actions"><button className="button button--primary" onClick={() => downloadText(safeCsv, `ellemexa-restored-${timestamp()}.csv`, 'text/csv')}>Скачать CSV с восстановленными ценами</button><button className="button button--text" onClick={onMain}>Начать заново</button></div><ImportInstructions /></>
  return <><header className="page-header"><button className="back-link" onClick={onMain}>← К изменению цен</button><span className="eyebrow">Отдельный сценарий</span><h1>Восстановление цен</h1><p>Верните цены из ранее сохраненного backup, не затирая свежие данные каталога.</p></header><section className="card"><h2>1. Загрузите актуальный CSV из Tilda</h2><p className="hint">Перед восстановлением выгрузите свежий каталог. Так изменения фотографий, размеров, остатков и других данных сохранятся.</p>{!loaded ? <FileDrop label="Загрузить актуальный CSV" accept=".csv,text/csv" onFile={uploadCatalog} disabled={loading} /> : <CatalogReady loaded={loaded} onReplace={() => { setLoaded(null); setBackup(null); setResult(null); setError('') }} />}</section>{loaded && <section className="card"><h2>2. Загрузите backup цен</h2><FileDrop label="Загрузить backup цен" accept=".json,application/json" onFile={uploadBackup} disabled={loading} /></section>}{loading && <Notice kind="info">Читаем файл…</Notice>}{error && <Notice kind="error">{error}</Notice>}</>
}

export default function App() {
  const [flow, setFlow] = useState<'main' | 'restore'>('main')
  return <main className="container">{flow === 'main' ? <MainFlow onRestore={() => setFlow('restore')} /> : <RestoreFlow onMain={() => setFlow('main')} />}<footer>Обработка выполняется локально на вашем устройстве.</footer></main>
}

