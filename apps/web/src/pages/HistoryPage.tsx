import { useQuery } from '@tanstack/react-query'
import { Download, History } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Notice, StatusBadge } from '../components/Badges'
import { api, exportUrl } from '../lib/api'
import { formatDate } from '../lib/format'
import { EmptyState, PageHeader, Skeleton } from '../components/ui'

export function HistoryPage() {
  const history = useQuery({ queryKey: ['analyses'], queryFn: () => api.analyses(1) })
  if (history.isLoading) return <Skeleton className="h-80" />
  if (history.isError) return <Notice tone="error">Historique indisponible.</Notice>
  const rows = history.data?.analyses ?? []
  return (
    <div className="space-y-4">
      <PageHeader title="Historique" description="Toutes les analyses lancées, manuelles ou planifiées." />
      {rows.length === 0 ? (
        <EmptyState icon={History} title="Aucune analyse">
          Les analyses lancées apparaîtront ici.
        </EmptyState>
      ) : (
      <div className="table-wrap">
        <table className="grid-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Déclencheur</th>
              <th>Sites</th>
              <th>Statut</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-paper">
                <td>{formatDate(row.createdAt)}</td>
                <td>{row.trigger === 'scheduled' ? 'Planifié' : 'Manuel'}</td>
                <td>{row.siteCount}</td>
                <td>
                  <StatusBadge value={row.status} />
                  {row.failureReason ? <div className="mt-1 text-xs text-clay">{row.failureReason}</div> : null}
                </td>
                <td className="space-x-3 text-right">
                  <Link className="font-medium text-accent hover:underline underline-offset-2" to={`/analyses/${row.id}`}>
                    Ouvrir
                  </Link>
                  <a className="inline-flex items-center gap-1 font-medium text-ink-800 hover:text-ink-950" href={exportUrl(row.id)}>
                    <Download className="h-3.5 w-3.5" aria-hidden /> Excel
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </div>
  )
}
