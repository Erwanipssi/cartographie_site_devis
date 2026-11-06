import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'
import { auth, AUTH_REQUIRED_EVENT } from '../lib/api'

/**
 * Affiche l'application, ou l'écran de connexion si l'API exige un mot de passe (APP_PASSWORD).
 * Une réponse 401 en cours d'usage (session expirée) ramène aussi à l'écran de connexion.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const session = useQuery({ queryKey: ['auth-session'], queryFn: auth.session, staleTime: Infinity, retry: false })

  useEffect(() => {
    const onAuthRequired = () => void queryClient.invalidateQueries({ queryKey: ['auth-session'] })
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired)
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired)
  }, [queryClient])

  if (session.isLoading) return null
  // API injoignable : on laisse l'application s'afficher, elle signale elle-même les erreurs.
  if (!session.data || session.data.authenticated) return <>{children}</>
  return <LoginPage />
}

function LoginPage() {
  const queryClient = useQueryClient()
  const [password, setPassword] = useState('')
  const login = useMutation({
    mutationFn: () => auth.login(password),
    onSuccess: async () => {
      setPassword('')
      await queryClient.invalidateQueries()
    },
  })

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <form
        className="card w-full max-w-sm space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (password) login.mutate()
        }}
      >
        <div>
          <h1 className="text-xl">Cartographie</h1>
          <p className="mt-1 text-sm text-ink-600">Saisissez le mot de passe de l’application.</p>
        </div>
        <label className="block text-sm font-medium" htmlFor="password">
          Mot de passe
        </label>
        <input
          id="password"
          className="field"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {login.isError ? (
          <p className="text-sm text-clay" role="alert">
            {login.error instanceof Error ? login.error.message : 'Connexion impossible'}
          </p>
        ) : null}
        <button className="btn-primary w-full" type="submit" disabled={login.isPending || !password}>
          {login.isPending ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>
    </main>
  )
}

/** Bouton de déconnexion, affiché seulement quand l'accès est protégé. */
export function LogoutButton() {
  const queryClient = useQueryClient()
  const session = useQuery({ queryKey: ['auth-session'], queryFn: auth.session, staleTime: Infinity, retry: false })
  const logout = useMutation({
    mutationFn: auth.logout,
    onSuccess: () => {
      queryClient.clear()
      void queryClient.invalidateQueries({ queryKey: ['auth-session'] })
    },
  })
  if (!session.data?.required) return null
  return (
    <button type="button" className="rounded-md px-3 py-1.5 text-sm font-medium text-ink-600 transition-colors hover:text-ink-950" onClick={() => logout.mutate()}>
      Se déconnecter
    </button>
  )
}
