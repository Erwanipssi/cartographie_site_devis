import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../lib/api'

export function RecipientPicker({ selected, onChange }: { selected: string[]; onChange: (ids: string[]) => void }) {
  const queryClient = useQueryClient()
  const recipients = useQuery({ queryKey: ['recipients'], queryFn: api.recipients })
  const [email, setEmail] = useState('')
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const add = useMutation({
    mutationFn: () => api.addRecipient(email, label),
    onSuccess: (result) => {
      setEmail('')
      setLabel('')
      setError(null)
      onChange([...selected, result.recipient.id])
      void queryClient.invalidateQueries({ queryKey: ['recipients'] })
    },
    onError: (reason) => setError(reason instanceof Error ? reason.message : 'Ajout impossible'),
  })

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id])
  }

  return (
    <div className="space-y-2">
      <ul className="space-y-1">
        {recipients.data?.recipients.map((recipient) => (
          <li key={recipient.id}>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={selected.includes(recipient.id)} onChange={() => toggle(recipient.id)} />
              <span>{recipient.label ? `${recipient.label} — ` : ''}{recipient.email}</span>
            </label>
          </li>
        ))}
        {recipients.data?.recipients.length === 0 ? <li className="text-sm text-ink-600">Aucun destinataire enregistré.</li> : null}
      </ul>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input className="field" type="email" placeholder="nom@exemple.fr" value={email} onChange={(event) => setEmail(event.target.value)} />
        <input className="field" placeholder="Libellé" value={label} onChange={(event) => setLabel(event.target.value)} />
        <button type="button" className="btn-ghost" disabled={add.isPending || !email} onClick={() => add.mutate()}>
          Ajouter
        </button>
      </div>
      {error ? <p className="text-sm text-clay">{error}</p> : null}
    </div>
  )
}
