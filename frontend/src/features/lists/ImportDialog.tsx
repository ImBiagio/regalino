import clsx from 'clsx'
import { useMemo, useRef, useState } from 'react'

import { useCreateImport, useReadImport } from '../../api/hooks'
import { AiThinking } from '../../components/motion'
import { ErrorBanner, Field, Icon, Modal, Segmented, Switch } from '../../components/ui'
import { formatPrice } from '../../lib/format'
import { gettext, interpolate, ngettext } from '../../lib/i18n'
import type { ImportList, WishList } from '../../lib/types'

/** I messaggi mentre il server apre la lista e Gemini la legge (anche un minuto o due). */
const READING_LINES = () => [
  gettext('Apro la lista…'),
  gettext('Scorro fino all’ultimo regalo…'),
  gettext('Leggo nomi, prezzi e foto…'),
  gettext('Cerco le altre liste collegate…'),
  gettext('Incarto tutto…'),
]

/** Quanti regali e liste ci sono in un albero, o nella parte scelta. */
function countTree(lists: ImportList[]): { lists: number; items: number } {
  return lists.reduce(
    (total, list) => {
      const inner = countTree(list.lists)
      return {
        lists: total.lists + (list.items.length ? 1 : 0) + inner.lists,
        items: total.items + list.items.length + inner.items,
      }
    },
    { lists: 0, items: 0 },
  )
}

/**
 * Le liste scelte: una lista tolta perde i suoi regali ma tiene le sotto-liste
 * scelte (resta come contenitore); quelle rimaste vuote spariscono.
 */
function pickTree(lists: ImportList[], skipped: Set<string>, prefix = ''): ImportList[] {
  return lists
    .map((list, index) => {
      const key = `${prefix}${index}`
      return {
        ...list,
        items: skipped.has(key) ? [] : list.items,
        lists: pickTree(list.lists, skipped, `${key}.`),
      }
    })
    .filter((list) => list.items.length > 0 || list.lists.length > 0)
}

/**
 * "Importa" (ADR 0015): da una lista desideri Amazon, da Elfster (o da
 * un'altra pagina di lista), o da un file CSV/JSON. Prima l'anteprima, poi le
 * liste nuove; se arrivano piu' liste si possono mettere dentro una sola.
 */
export function ImportDialog({
  onClose,
  onDone,
}: {
  onClose: () => void
  onDone: (lists: WishList[]) => void
}) {
  const [source, setSource] = useState<'link' | 'file'>('link')
  const [links, setLinks] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [lists, setLists] = useState<ImportList[] | null>(null)
  const [readError, setReadError] = useState<unknown>(null)
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const [group, setGroup] = useState(false)
  const [groupTitle, setGroupTitle] = useState(gettext('Liste importate'))
  const fileInput = useRef<HTMLInputElement>(null)
  const read = useReadImport()
  const create = useCreateImport()

  const chosen = useMemo(() => (lists ? pickTree(lists, skipped) : []), [lists, skipped])
  const totals = countTree(chosen)
  const urls = links
    .split(/\s+/)
    .map((line) => line.trim())
    .filter((line) => /^https?:\/\//i.test(line))

  const start = async () => {
    setReadError(null)
    try {
      let found: ImportList[] = []
      if (source === 'file' && file) {
        found = await read.mutateAsync({ file })
      } else {
        // Un link alla volta: ognuno puo' portare piu' liste (un profilo).
        for (const url of urls) found = [...found, ...(await read.mutateAsync({ url }))]
      }
      setSkipped(new Set())
      setGroup(found.length > 1)
      setLists(found)
    } catch (error) {
      setReadError(error)
    }
  }

  const save = async () => {
    const created = await create
      .mutateAsync({ lists: chosen, group_title: group ? groupTitle.trim() : '' })
      .catch(() => null)
    if (created) onDone(created)
  }

  const toggle = (key: string) =>
    setSkipped((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const reading = read.isPending

  return (
    <Modal open onClose={onClose} title={gettext('Importa una lista')} wide>
      {reading ? (
        <AiThinking lines={READING_LINES()} />
      ) : lists === null ? (
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void start()
          }}
        >
          <Segmented
            value={source}
            onChange={setSource}
            options={[
              { value: 'link', label: gettext('Da un link') },
              { value: 'file', label: gettext('Da un file') },
            ]}
            className="justify-self-start"
          />
          <ErrorBanner error={readError} />
          {source === 'link' ? (
            <Field
              label={gettext('Link della lista')}
              hint={gettext(
                'Una lista desideri Amazon pubblica, una lista o un profilo Elfster, o un’altra pagina di lista. Più link? Uno per riga.',
              )}
            >
              <textarea
                className="field-input min-h-[88px] resize-y"
                value={links}
                onChange={(event) => setLinks(event.target.value)}
                placeholder="https://www.amazon.it/hz/wishlist/ls/…"
                autoFocus
              />
            </Field>
          ) : (
            <div className="grid gap-2">
              <button
                type="button"
                className="row-m3 rounded-row border border-dashed border-outline-variant"
                onClick={() => fileInput.current?.click()}
              >
                <Icon name="upload_file" size={22} className="text-on-surface-variant" />
                <span className="min-w-0 flex-1 truncate text-body-large">
                  {file ? file.name : gettext('Scegli un file CSV o JSON')}
                </span>
              </button>
              <p className="px-1 text-body-small text-on-surface-variant">
                {gettext(
                  'CSV: una riga per regalo, colonne nome, link, prezzo, quantità, note e lista (“Natale > Libri” per una lista dentro un’altra). JSON: liste con “items” e “lists”.',
                )}
              </p>
              <input
                ref={fileInput}
                type="file"
                accept=".csv,.json,text/csv,application/json"
                className="hidden"
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null)
                  event.target.value = ''
                }}
              />
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-text" onClick={onClose}>
              {gettext('Annulla')}
            </button>
            <button
              type="submit"
              className="btn-filled"
              disabled={source === 'link' ? urls.length === 0 : !file}
            >
              <Icon name="download" size={20} />
              {gettext('Leggi la lista')}
            </button>
          </div>
        </form>
      ) : (
        <div className="grid gap-4">
          <p className="text-body-medium text-on-surface-variant">
            {gettext('Ecco cosa ho trovato. Togli le liste che non vuoi, poi importa.')}
          </p>
          <div className="grid max-h-[50vh] gap-2 overflow-y-auto">
            <ImportTree lists={lists} skipped={skipped} onToggle={toggle} />
          </div>
          <div className="grid gap-2 rounded-row bg-surface-container-low px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="min-w-0 flex-1 text-body-large">
                {gettext('Mettile tutte dentro una lista nuova')}
              </span>
              <Switch
                checked={group}
                onChange={setGroup}
                label={gettext('Mettile tutte dentro una lista nuova')}
              />
            </div>
            <p className="text-body-small text-on-surface-variant">
              {group
                ? gettext(
                    'Ogni lista resta com’è e compare anche dentro quella nuova, in una sezione sua.',
                  )
                : gettext(
                    'Le liste che ne contengono altre le includono: i loro regali si vedono anche lì.',
                  )}
            </p>
            {group && (
              <Field label={gettext('Nome della lista nuova')}>
                <input
                  className="field-input"
                  value={groupTitle}
                  onChange={(event) => setGroupTitle(event.target.value)}
                  maxLength={120}
                  required
                />
              </Field>
            )}
          </div>
          <ErrorBanner error={create.error} />
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              className="btn-text mr-auto"
              onClick={() => {
                setLists(null)
                create.reset()
              }}
            >
              <Icon name="arrow_back" size={20} />
              {gettext('Indietro')}
            </button>
            <button
              type="button"
              className="btn-filled"
              disabled={totals.items === 0 || create.isPending || (group && !groupTitle.trim())}
              onClick={() => void save()}
            >
              <Icon name="playlist_add" size={20} />
              {interpolate(ngettext('Importa %s regalo', 'Importa %s regali', totals.items), [
                totals.items,
              ])}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}

/** L'anteprima: una riga per lista (con le sotto-liste rientrate) e i primi regali. */
function ImportTree({
  lists,
  skipped,
  onToggle,
  prefix = '',
  depth = 0,
}: {
  lists: ImportList[]
  skipped: Set<string>
  onToggle: (key: string) => void
  prefix?: string
  depth?: number
}) {
  return (
    <>
      {lists.map((list, index) => {
        const key = `${prefix}${index}`
        const on = !skipped.has(key)
        return (
          <div key={key} className="grid gap-2" style={{ marginLeft: depth * 20 }}>
            {list.items.length > 0 ? (
              <label
                className={clsx(
                  'flex cursor-pointer items-start gap-3 rounded-row border border-outline-variant px-4 py-3',
                  !on && 'opacity-60',
                )}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => onToggle(key)}
                  className="mt-1 h-5 w-5 shrink-0 accent-[var(--primary)]"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    {depth > 0 && (
                      <Icon name="subdirectory_arrow_right" size={18} className="text-tertiary" />
                    )}
                    <span className="truncate text-title-small">{list.title}</span>
                  </span>
                  <span className="block text-body-small text-on-surface-variant">
                    {interpolate(ngettext('%s regalo', '%s regali', list.items.length), [
                      list.items.length,
                    ])}
                  </span>
                  <ul className="mt-1 grid gap-0.5 text-body-small">
                    {list.items.slice(0, 4).map((item, itemIndex) => (
                      <li key={itemIndex} className="flex gap-2">
                        <span className="min-w-0 flex-1 truncate">
                          {item.quantity > 1 && `${item.quantity} × `}
                          {item.title}
                        </span>
                        {item.price && (
                          <span className="amount shrink-0 text-on-surface-variant">
                            {formatPrice(item.price)}
                          </span>
                        )}
                      </li>
                    ))}
                    {list.items.length > 4 && (
                      <li className="text-on-surface-variant">
                        {interpolate(gettext('e altri %s'), [list.items.length - 4])}
                      </li>
                    )}
                  </ul>
                </span>
              </label>
            ) : (
              <p className="flex items-center gap-2 px-1 text-title-small">
                <Icon name="folder_open" size={20} className="text-on-surface-variant" />
                {list.title}
              </p>
            )}
            {list.lists.length > 0 && (
              <ImportTree
                lists={list.lists}
                skipped={skipped}
                onToggle={onToggle}
                prefix={`${key}.`}
                depth={depth + 1}
              />
            )}
          </div>
        )
      })}
    </>
  )
}
