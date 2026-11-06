import { crawlConfigSchema, type CrawlConfig } from '@cartographie/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { AdvancedSettings } from '../components/AdvancedSettings'
import { Notice } from '../components/Badges'
import { RecipientPicker } from '../components/RecipientPicker'
import { api } from '../lib/api'
import { formatDate } from '../lib/format'

export function SchedulesPage() {
  const queryClient = useQueryClient()
  const schedules = useQuery({ queryKey: ['schedules'], queryFn: api.schedules })
  const sites = useQuery({ queryKey: ['sites'], queryFn: api.sites })
  const deliveries = useQuery({ queryKey: ['deliveries'], queryFn: () => api.deliveries() })
  const [name, setName] = useState('Hebdomadaire')
  const [cron, setCron] = useState('0 7 * * 1')
  const [timezone, setTimezone] = useState('Europe/Paris')
  const [siteIds, setSiteIds] = useState<string[]>([])
  const [recipientIds, setRecipientIds] = useState<string[]>([])
  const [emailOnComplete, setEmailOnComplete] = useState(true)
  const [config, setConfig] = useState<CrawlConfig>(() => crawlConfigSchema.parse({}))
  const [error, setError] = useState<string | null>(null)

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['schedules'] })
  const create = useMutation({
    mutationFn: () =>
      api.createSchedule({ name, cron, timezone, enabled: true, siteIds, config, emailOnComplete, recipientIds }),
    onSuccess: () => {
      setError(null)
      refresh()
    },
    onError: (reason) => setError(reason instanceof Error ? reason.message : 'Création impossible'),
  })
  const toggle = useMutation({
    mutationFn: (input: { id: string; enabled: boolean }) => api.updateSchedule(input.id, { enabled: input.enabled }),
    onSuccess: refresh,
  })
  const remove = useMutation({ mutationFn: api.deleteSchedule, onSuccess: refresh })
  const run = useMutation({ mutationFn: api.runSchedule, onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['analyses'] }) })

  const toggleSite = (id: string) => setSiteIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))

  return (
    <div className="space-y-6">
      <div>
        <h1>Planifications</h1>
        <p className="mt-2 text-ink-600">Une expression cron en 5 champs, fuseau Europe/Paris par défaut. Exemple : <code>0 7 * * 1</code> chaque lundi à 7 h.</p>
      </div>
      <form
        className="card space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          create.mutate()
        }}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">
            Nom
            <input className="field mt-1" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="text-sm">
            Cron
            <input className="field mt-1 font-mono" value={cron} onChange={(event) => setCron(event.target.value)} />
          </label>
          <label className="text-sm">
            Fuseau
            <select className="field mt-1" value={timezone} onChange={(event) => setTimezone(event.target.value)}>
              <option>Europe/Paris</option>
              <option>Europe/Brussels</option>
              <option>UTC</option>
            </select>
          </label>
        </div>
        <fieldset>
          <legend className="text-sm font-semibold">Sites</legend>
          <ul className="mt-2 space-y-1">
            {(sites.data?.sites ?? []).map((site) => (
              <li key={site.id}>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={siteIds.includes(site.id)} onChange={() => toggleSite(site.id)} />
                  {site.hostname}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={emailOnComplete} onChange={(event) => setEmailOnComplete(event.target.checked)} />
          Envoyer le rapport à la fin
        </label>
        {emailOnComplete ? <RecipientPicker selected={recipientIds} onChange={setRecipientIds} /> : null}
        <AdvancedSettings value={config} onChange={setConfig} />
        {error ? <Notice tone="error">{error}</Notice> : null}
        <button className="btn-primary" type="submit" disabled={create.isPending || siteIds.length === 0}>
          Créer la planification
        </button>
      </form>
      <div className="table-wrap">
        <table className="grid-table">
          <thead>
            <tr>
              <th>Nom</th>
              <th>Cron</th>
              <th>Dernier lancement</th>
              <th>Active</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(schedules.data?.schedules ?? []).map((schedule) => (
              <tr key={schedule.id}>
                <td>{schedule.name}</td>
                <td className="font-mono text-xs">
                  {schedule.cron}
                  <div className="text-ink-600">{schedule.timezone}</div>
                </td>
                <td>{formatDate(schedule.lastRunAt)}</td>
                <td>
                  <input type="checkbox" checked={schedule.enabled} onChange={(event) => toggle.mutate({ id: schedule.id, enabled: event.target.checked })} />
                </td>
                <td className="space-x-3 text-right">
                  <button type="button" className="font-medium text-accent hover:underline underline-offset-2" onClick={() => run.mutate(schedule.id)}>
                    Lancer
                  </button>
                  <button type="button" className="font-medium text-ink-600 hover:text-clay" onClick={() => remove.mutate(schedule.id)}>
                    Supprimer
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2 className="text-xl">Journal des envois</h2>
      <div className="table-wrap">
        <table className="grid-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Déclencheur</th>
              <th>Destinataires</th>
              <th>Statut</th>
            </tr>
          </thead>
          <tbody>
            {(deliveries.data?.deliveries ?? []).map((delivery) => (
              <tr key={delivery.id}>
                <td>{formatDate(delivery.createdAt)}</td>
                <td>{delivery.trigger}</td>
                <td>{delivery.recipients.join(', ')}</td>
                <td>
                  {delivery.status}
                  {delivery.error ? <div className="text-xs text-clay">{delivery.error}</div> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
