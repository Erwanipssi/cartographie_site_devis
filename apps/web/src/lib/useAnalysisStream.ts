import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

export function useAnalysisStream(analysisId: string, enabled: boolean): void {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!enabled) return
    const source = new EventSource(`/api/analyses/${analysisId}/events`)
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ['analysis', analysisId] })
        void queryClient.invalidateQueries({ queryKey: ['analysis-sites', analysisId] })
      }, 400)
    }
    source.onmessage = refresh
    return () => {
      clearTimeout(timer)
      source.close()
    }
  }, [analysisId, enabled, queryClient])
}
