import { useEffect, useState } from 'react'

/**
 * Wraps the fetch-on-mount/dep-change pattern used by nearly every list and
 * detail view in this app: setLoading(true) -> await fetcher() ->
 * setData/setError. Centralized here so the (legitimate, but lint-flagged
 * by react-hooks/set-state-in-effect) synchronous setState-at-effect-start
 * only needs justifying once instead of once per page.
 *
 * `fetcher` must be a useCallback'd function returning a promise of the
 * data; its identity change is what triggers a refetch.
 */
export default function useApiQuery(fetcher) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    // This effect's entire purpose is running an async fetch against an
    // external system (the API) — the loading/error flags it sets ARE the
    // state being synchronized from that call, which is exactly what
    // effects are for; the rule's heuristic just can't see the async
    // boundary below.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    setError('')
    fetcher()
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch((err) => {
        if (!cancelled) setError(err?.response?.data?.message || 'Something went wrong.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [fetcher, reloadToken])

  return { data, setData, loading, error, refetch: () => setReloadToken((t) => t + 1) }
}
