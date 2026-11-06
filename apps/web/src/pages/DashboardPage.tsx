import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Notice } from '../components/Badges'
import { insights, type OverviewSite } from '../lib/api'
import { formatDate } from '../lib/format'

const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null)

export function DashboardPage() {
  const overview = useQuery({ queryKey: ['overview'], queryFn: insights.overview })
  const sites = overview.data?.sites ?? []
  const analysed = sites.filter((site) => site.latest)

  return (
    <div className="space-y-6">
      <div>
        <h1>Tableau de bord</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-600">
          La dernière analyse terminée de chaque site, et son évolution depuis la précédente faite dans le même mode.
        </p>
      </div>
      {overview.isError ? <Notice tone="error">Tableau de bord indisponible.</Notice> : null}
      {overview.data && analysed.length === 0 ? <Notice tone="info">Aucun site n’a encore d’analyse terminée.</Notice> : null}

      {analysed.length > 0 ? (
        <div className="table-wrap">
          <table className="grid-table">
            <thead>
              <tr>
                <th>Site</th>
                <th>Dernière analyse</th>
                <th className="text-right">Pages</th>
                <th className="text-right">PDF</th>
                <th className="text-right">PDF avec texte</th>
                <th className="text-right">PDF à traiter</th>
                <th className="text-right">PDF accessibles</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {analysed.map((site) => (
                <Row key={site.siteId} site={site} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="text-xs text-ink-600">
        « PDF accessibles » : balisés, titrés et déclarant leur langue, parmi les PDF contrôlés. Les flèches comparent à l’analyse précédente.
      </p>
    </div>
  )
}

/** neutral : la variation n'est ni bonne ni mauvaise (plus ou moins de pages publiées), affichée en gris. */
function Trend({ now, before, lowerIsBetter = false, neutral = false, suffix = '' }: { now: number | null; before: number | null | undefined; lowerIsBetter?: boolean; neutral?: boolean; suffix?: string }) {
  if (now === null) return <span className="text-ink-400">—</span>
  const diff = before == null ? 0 : now - before
  const good = diff === 0 ? null : lowerIsBetter ? diff < 0 : diff > 0
  return (
    <span className="tabular-nums">
      {now}
      {suffix}
      {before != null && diff !== 0 ? (
        <span className={`ml-1.5 text-xs ${neutral ? 'text-ink-600' : good ? 'text-pine' : 'text-clay'}`} title={`Avant : ${before}${suffix}`}>
          {diff > 0 ? '▲' : '▼'} {Math.abs(diff)}
          {suffix}
        </span>
      ) : null}
    </span>
  )
}

function Row({ site }: { site: OverviewSite }) {
  const latest = site.latest!
  const previous = site.previous
  const toFix = latest.pdfImageCount + latest.pdfPartialCount
  const textShare = percent(latest.pdfTextCount, latest.pdfCount)
  const a11yShare = latest.accessibility.checked > 0 ? percent(latest.accessibility.conform, latest.accessibility.checked) : null
  const previousA11y = previous?.accessibility && previous.accessibility.checked > 0 ? percent(previous.accessibility.conform, previous.accessibility.checked) : null
  return (
    <tr>
      <td className="font-medium">{site.hostname}</td>
      <td className="whitespace-nowrap text-ink-600">
        {formatDate(latest.date)} <span className="text-xs">· {latest.mode}</span>
      </td>
      <td className="text-right">
        <Trend now={latest.htmlCount} before={previous?.htmlCount} neutral />
      </td>
      <td className="text-right">
        <Trend now={latest.pdfCount} before={previous?.pdfCount} neutral />
      </td>
      <td className="text-right">
        <Trend now={textShare} before={previous ? percent(previous.pdfTextCount, previous.pdfCount) : null} suffix=" %" />
      </td>
      <td className="text-right">
        <Trend now={toFix} before={previous ? previous.pdfImageCount + previous.pdfPartialCount : null} lowerIsBetter />
      </td>
      <td className="text-right">
        <Trend now={a11yShare} before={previousA11y} suffix=" %" />
      </td>
      <td className="whitespace-nowrap text-right text-sm">
        <Link className="font-medium text-accent underline-offset-2 hover:underline" to={`/analyses/${latest.analysisId}/pdf-a-traiter`}>
          PDF à traiter
        </Link>
        {previous ? (
          <>
            <span className="text-ink-400"> · </span>
            <Link className="font-medium text-accent underline-offset-2 hover:underline" to={`/analyses/${latest.analysisId}/sites/${latest.id}/evolution`}>
              Évolution
            </Link>
          </>
        ) : null}
      </td>
    </tr>
  )
}
