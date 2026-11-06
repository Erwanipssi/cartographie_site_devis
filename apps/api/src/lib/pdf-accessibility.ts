import { BOM, csvCell, documentName } from './pdf-triage'

/**
 * Accessibilité des PDF au-delà de la couche texte (RGAA, critères sur les documents bureautiques) :
 * - balisage : sans arbre de structure, un lecteur d'écran lit le document comme un bloc sans titres ni listes ;
 * - titre : c'est ce qu'annonce le lecteur d'écran et ce qu'affiche l'onglet du navigateur ;
 * - langue : sans elle, la synthèse vocale prononce le texte avec la mauvaise voix.
 */

export type TitleStatus = 'ok' | 'missing' | 'generic'
export const A11Y_ISSUES = ['untagged', 'notitle', 'nolang'] as const
export type A11yIssue = (typeof A11Y_ISSUES)[number]

export const A11Y_LABELS: Record<A11yIssue, string> = {
  untagged: 'Non balisé',
  notitle: 'Titre absent ou non pertinent',
  nolang: 'Langue non déclarée',
}

/** Titres qui n'informent pas l'usager : restes de modèles, noms de fichiers, champs de publipostage. */
const GENERIC_TITLES: RegExp[] = [
  /^microsoft\s+(word|powerpoint|excel)\b/i,
  /\.(docx?|odt|rtf|pdf|xlsx?|ods|pptx?|odp|indd)$/i,
  /«[^»]*»/,
  /^(untitled|sans\s+titre|document\s*\d*|titre|title|diapositive\s*\d+|pr[ée]sentation\s+powerpoint|new document|nouveau document)$/i,
]

export function titleStatus(title: string | null | undefined): TitleStatus {
  const text = title?.trim()
  if (!text) return 'missing'
  return GENERIC_TITLES.some((pattern) => pattern.test(text)) ? 'generic' : 'ok'
}

export function parseA11yIssues(value: string | undefined): A11yIssue[] {
  if (!value) return [...A11Y_ISSUES]
  const wanted = value.split(',').map((part) => part.trim())
  const issues = A11Y_ISSUES.filter((issue) => wanted.includes(issue))
  return issues.length ? issues : [...A11Y_ISSUES]
}

/** Défauts d'un PDF ; vide si le PDF n'a pas encore été contrôlé (analyse antérieure à ces contrôles). */
export function a11yIssues(pdf: { tagged: boolean | null; titleStatus: string | null; lang: string | null }): A11yIssue[] {
  if (pdf.tagged === null) return []
  const issues: A11yIssue[] = []
  if (!pdf.tagged) issues.push('untagged')
  if (pdf.titleStatus !== 'ok') issues.push('notitle')
  if (!pdf.lang) issues.push('nolang')
  return issues
}

export type A11yRow = {
  site: string
  url: string
  ocrStatus: string
  tagged: boolean | null
  title: string | null
  titleStatus: string | null
  lang: string | null
  parentUrl: string | null
}

const TITLE_LABELS: Record<string, string> = { ok: 'Oui', missing: 'Absent', generic: 'Non pertinent' }
const OCR_SHORT: Record<string, string> = { text: 'Oui', partial: 'Partielle', image: 'Non', error: 'Illisible', pending: '—' }

/** CSV de la vue Accessibilité, même format que celui des PDF à traiter (« ; », BOM UTF-8). */
export function a11yCsv(rows: A11yRow[]): string {
  const header = ['Document', 'Défauts', 'Balisé', 'Titre', 'Titre déclaré', 'Langue', 'Couche texte', 'Publié sur', 'URL du PDF', 'Site']
  const lines = [header.join(';')]
  for (const row of rows) {
    lines.push(
      [
        documentName(row.url),
        a11yIssues(row).map((issue) => A11Y_LABELS[issue]).join(', '),
        row.tagged == null ? null : row.tagged ? 'Oui' : 'Non',
        TITLE_LABELS[row.titleStatus ?? ''] ?? null,
        row.title,
        row.lang ?? 'Non déclarée',
        OCR_SHORT[row.ocrStatus] ?? row.ocrStatus,
        row.parentUrl,
        row.url,
        row.site,
      ]
        .map(csvCell)
        .join(';'),
    )
  }
  return `${BOM}${lines.join('\r\n')}\r\n`
}
