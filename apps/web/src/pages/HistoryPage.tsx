import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Notice, StatusBadge } from '../components/Badges'
import { api, exportUrl } from '../lib/api'
import { formatDate } from '../lib/format'

export function HistoryPage() {
  const history = useQuery({ queryKey: ['analyses'], queryFn: () => api.analyses(1) })
  if (history.isLoading) return <p>Chargement…</p>
  if (history.isError) return <Notice tone="error">Historique indisponible.</Notice>
  const rows = history.data?.analyses ?? []
  return (
    <div className="space-y-4">
      <h1>Historique</h1>
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
              <tr key={row.id}>
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
                  <a className="font-semibold text-ink-800" href={exportUrl(row.id)}>
                    Excel
                  </a>
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5}>Aucune analyse.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}
