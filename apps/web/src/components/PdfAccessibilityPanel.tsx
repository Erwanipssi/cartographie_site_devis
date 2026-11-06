import { useQuery } from '@tanstack/react-query'
import { Notice } from './Badges'
import { pdfsAccessibility, type A11yIssue, type PdfAccessibility } from '../lib/api'

const ISSUES: Array<{ key: A11yIssue; label: string; hint: string }> = [
  { key: 'untagged', label: 'Non balisés', hint: 'Sans structure : le lecteur d’écran ne repère ni titres, ni listes, ni tableaux' },
  { key: 'notitle', label: 'Titre absent ou non pertinent', hint: 'Le titre annoncé est vide, un nom de fichier ou un reste de modèle' },
  { key: 'nolang', label: 'Langue non déclarée', hint: 'La synthèse vocale risque de lire le texte avec la mauvaise voix' },
]
export const A11Y_PAGE_SIZE = 50

type Props = {
  analysisId: string
  issues: A11yIssue[]
  q: string
  page: number
  onToggle: (issue: A11yIssue) => void
  onPage: (page: number) => void
}

export function PdfAccessibilityPanel({ analysisId, issues, q, page, onToggle, onPage }: Props) {
  const result = useQuery({
    queryKey: ['pdfs-accessibility', analysisId, issues.join(','), q, page],
    queryFn: () => pdfsAccessibility(analysisId, { issue: issues.join(','), q, page, pageSize: A11Y_PAGE_SIZE }),
  })
  const counts = result.data?.counts
  const total = result.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / A11Y_PAGE_SIZE))

  if (counts && counts.checked === 0) {
    return (
      <Notice tone="info">
        Ces PDF ont été analysés avant l’ajout des contrôles d’accessibilité. Relancez une analyse pour obtenir le balisage, le titre et la langue de chaque document.
      </Notice>
    )
  }

  return (
    <div className="space-y-4">
      {counts ? (
        <p className="text-sm text-ink-600">
          <span className="font-semibold text-ink-950">{counts.conform}</span> PDF sur {counts.checked} contrôlés sont balisés, titrés et déclarent leur
          langue.
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3" role="group" aria-label="Filtrer par défaut">
        {ISSUES.map((issue) => {
          const active = issues.includes(issue.key)
          return (
            <button
              key={issue.key}
              type="button"
              aria-pressed={active}
              onClick={() => onToggle(issue.key)}
              className={`card text-left transition-colors ${active ? 'border-ink-950 ring-1 ring-ink-950' : 'opacity-60 hover:opacity-100'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{issue.label}</span>
                <span className="text-2xl font-semibold tabular-nums tracking-tight">{counts ? counts[issue.key] : '—'}</span>
              </div>
              <p className="mt-2 text-xs text-ink-600">{issue.hint}</p>
            </button>
          )
        })}
      </div>

      {result.isError ? <Notice tone="error">Impossible de charger la liste.</Notice> : null}

      <div className="table-wrap">
        <table className="grid-table">
          <thead>
            <tr>
              <th>Document</th>
              <th>Balisé</th>
              <th>Titre</th>
              <th>Langue</th>
              <th>Publié sur</th>
            </tr>
          </thead>
          <tbody>
            {result.data?.items.map((pdf) => <Row key={`${pdf.analysisSiteId}-${pdf.url}`} pdf={pdf} />)}
            {result.data && result.data.items.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-ink-600">
                  {q ? 'Aucun PDF ne correspond à cette recherche.' : 'Aucun PDF ne présente ces défauts.'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-ink-600">
        <span>
          {total} document{total > 1 ? 's' : ''}
        </span>
        {pages > 1 ? (
          <div className="flex items-center gap-2">
            <button type="button" className="btn-ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>
              Précédent
            </button>
            <span className="tabular-nums">
              {page} / {pages}
            </span>
            <button type="button" className="btn-ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}>
              Suivant
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return <span className={ok ? 'text-ink-800' : 'font-medium text-clay'}>{children}</span>
}

function Row({ pdf }: { pdf: PdfAccessibility }) {
  return (
    <tr>
      <td className="max-w-sm">
        <a className="break-words font-medium text-accent underline-offset-2 hover:underline" href={pdf.url} target="_blank" rel="noreferrer">
          {pdf.name}
        </a>
        {pdf.ocrStatus !== 'text' ? <div className="text-xs text-ink-600">Couche texte : {pdf.ocrStatus === 'image' ? 'absente' : 'partielle'}</div> : null}
      </td>
      <td className="whitespace-nowrap">
        <Check ok={Boolean(pdf.tagged)}>{pdf.tagged ? 'Oui' : 'Non'}</Check>
      </td>
      <td className="max-w-xs">
        {pdf.titleStatus === 'ok' ? (
          <span className="text-ink-800">{pdf.title}</span>
        ) : pdf.titleStatus === 'generic' ? (
          <Check ok={false}>
            Non pertinent <span className="font-normal text-ink-600">« {pdf.title} »</span>
          </Check>
        ) : (
          <Check ok={false}>Absent</Check>
        )}
      </td>
      <td className="whitespace-nowrap">{pdf.lang ? <span className="font-mono text-xs">{pdf.lang}</span> : <Check ok={false}>Non déclarée</Check>}</td>
      <td className="max-w-xs">
        {pdf.parentUrl ? (
          <a className="block truncate text-ink-600 underline-offset-2 hover:text-ink-950 hover:underline" href={pdf.parentUrl} target="_blank" rel="noreferrer" title={pdf.parentUrl}>
            {pdf.parentUrl.replace(/^https?:\/\/(www\.)?/, '')}
          </a>
        ) : (
          '—'
        )}
      </td>
    </tr>
  )
}
