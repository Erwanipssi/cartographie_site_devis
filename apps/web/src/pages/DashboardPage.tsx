import { useQuery } from '@tanstack/react-query'
import { Accessibility, FileWarning, Files, Globe, Layers, LayoutDashboard } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Notice } from '../components/Badges'
import { EmptyState, integer, OCR_COLORS, PageHeader, Skeleton, StatCard } from '../components/ui'
import { insights, type OverviewSite } from '../lib/api'
import { formatDate } from '../lib/format'

const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null)

export function DashboardPage() {
  const overview = useQuery({ queryKey: ['overview'], queryFn: insights.overview })
  const sites = overview.data?.sites ?? []
  const analysed = sites.filter((site) => site.latest)

  return (
    <div className="space-y-6">
      <PageHeader title="Tableau de bord" description="La dernière analyse terminée de chaque site, et son évolution depuis la précédente faite dans le même mode." />
      {overview.isError ? <Notice tone="error">Tableau de bord indisponible.</Notice> : null}
      {overview.isLoading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-[104px]" />
          ))}
        </div>
      ) : null}
      {overview.data && analysed.length === 0 ? (
        <EmptyState icon={LayoutDashboard} title="Aucune analyse terminée">
          Lancez une analyse depuis la page Sites : ses chiffres apparaîtront ici.
        </EmptyState>
      ) : null}
      {analysed.length > 0 ? <Summary sites={analysed} /> : null}
      {/* Un graphique de comparaison n'a de sens qu'à partir de deux sites. */}
      {analysed.length > 1 ? <SitesChart sites={analysed} /> : null}

      {analysed.length > 0 ? (
        <div className="table-wrap">
          <table className="grid-table">
            <thead>
              <tr>
                <th>Site</th>
                <th>Dernière analyse</th>
                <th className="text-right">Pages</th>
                <th className="text-right">PDF</th>
                <th className="text-right">Pages PDF</th>
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

/** Totaux sur tous les sites : la dernière analyse de chacun. */
function Summary({ sites }: { sites: OverviewSite[] }) {
  const sum = (pick: (latest: NonNullable<OverviewSite['latest']>) => number) => sites.reduce((total, site) => total + pick(site.latest!), 0)
  const checked = sum((latest) => latest.accessibility.checked)
  const conform = sum((latest) => latest.accessibility.conform)
  const toFix = sum((latest) => latest.pdfImageCount + latest.pdfPartialCount)
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <StatCard icon={Globe} label="Pages" value={sum((latest) => latest.htmlCount)} hint={`${sites.length} site${sites.length > 1 ? 's' : ''}`} />
      <StatCard icon={Files} label="PDF" value={sum((latest) => latest.pdfCount)} />
      <StatCard icon={Layers} label="Pages PDF" value={sum((latest) => latest.pdfPages.pages)} hint={`${integer.format(sum((latest) => latest.pdfPages.withoutText))} sans texte`} />
      <StatCard icon={FileWarning} label="PDF à traiter" value={toFix} tone={toFix > 0 ? 'warn' : 'good'} />
      <StatCard icon={Accessibility} label="PDF accessibles" value={checked > 0 ? percent(conform, checked) : null} suffix=" %" tone="accent" hint={checked > 0 ? `${integer.format(conform)} sur ${integer.format(checked)} contrôlés` : 'Non contrôlés'} />
    </div>
  )
}

/** Comparaison des sites : la couche texte de leurs PDF, en barres empilées. */
function SitesChart({ sites }: { sites: OverviewSite[] }) {
  const data = sites
    .map((site) => ({
      name: site.hostname.replace(/^www\./, ''),
      text: site.latest!.pdfTextCount,
      partial: site.latest!.pdfPartialCount,
      image: site.latest!.pdfImageCount,
      error: site.latest!.pdfErrorCount,
    }))
    .sort((a, b) => b.text + b.partial + b.image + b.error - (a.text + a.partial + a.image + a.error))
  if (data.every((row) => row.text + row.partial + row.image + row.error === 0)) return null
  const labels: Record<string, string> = { text: 'Avec texte', partial: 'Partiels', image: 'Non OCRisés', error: 'Illisibles' }
  return (
    <section className="card">
      <h2 className="mb-3 text-sm">PDF par site et couche texte</h2>
      <div style={{ height: Math.max(140, data.length * 38 + 50) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }} barCategoryGap={8}>
            <CartesianGrid horizontal={false} stroke="#f4f4f5" />
            <XAxis type="number" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#71717a' }} />
            <YAxis type="category" dataKey="name" width={160} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#3f3f46' }} />
            <Tooltip cursor={{ fill: '#f4f4f5' }} contentStyle={{ borderRadius: 8, border: '1px solid #e4e4e7', fontSize: 12 }} formatter={(value, name) => [integer.format(Number(value)), labels[String(name)] ?? String(name)]} />
            <Legend iconType="square" iconSize={8} formatter={(value) => <span className="text-xs text-ink-600">{labels[String(value)] ?? value}</span>} />
            <Bar dataKey="text" stackId="pdf" fill={OCR_COLORS.text} />
            <Bar dataKey="partial" stackId="pdf" fill={OCR_COLORS.partial} />
            <Bar dataKey="image" stackId="pdf" fill={OCR_COLORS.image} />
            <Bar dataKey="error" stackId="pdf" fill={OCR_COLORS.error} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}

/** neutral : la variation n'est ni bonne ni mauvaise (plus ou moins de pages publiées), affichée en gris. */
function Trend({ now, before, lowerIsBetter = false, neutral = false, suffix = '' }: { now: number | null; before: number | null | undefined; lowerIsBetter?: boolean; neutral?: boolean; suffix?: string }) {
  if (now === null) return <span className="text-ink-400">—</span>
  const diff = before == null ? 0 : now - before
  const good = diff === 0 ? null : lowerIsBetter ? diff < 0 : diff > 0
  return (
    <span className="whitespace-nowrap tabular-nums">
      {now}
      {suffix}
      {before != null && diff !== 0 ? (
        <span className={`ml-1.5 whitespace-nowrap text-xs ${neutral ? 'text-ink-600' : good ? 'text-pine' : 'text-clay'}`} title={`Avant : ${before}${suffix}`}>
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
    <tr className="hover:bg-paper">
      <td className="font-medium">
        <Link className="hover:text-accent" to={`/analyses/${latest.analysisId}/sites/${latest.id}`}>
          {site.hostname}
        </Link>
      </td>
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
        <Trend now={latest.pdfPages.pages} before={previous?.pdfPages.pages} neutral />
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
