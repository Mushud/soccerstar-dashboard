import { useState, useEffect, useCallback } from 'react'
import api from '../api'
import AppShell from '../components/AppShell'

/**
 * Review queue for team-name aliases.
 *
 * The bet slip analyser resolves SportyBet's team names to our fixtures. When it can only do
 * that fuzzily it records a PENDING alias rather than acting on a guess, which is what keeps a
 * wrong match out of a real booking code. Those proposals need a human to confirm or reject
 * once — after that the name is a fact and never re-guessed.
 *
 * Without this page the table only ever accumulates proposals and never graduates them.
 */
export default function Aliases() {
  const [pending, setPending]   = useState([])
  const [counts, setCounts]     = useState({})
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [busyId, setBusyId]     = useState(null)
  const [query, setQuery]       = useState('')
  const [lookup, setLookup]     = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [{ data: p }, { data: all }] = await Promise.all([
        api.get('/api/aliases/pending', { params: { source: 'sportybet', limit: 200 } }),
        api.get('/api/aliases', { params: { source: 'sportybet', limit: 1 } }),
      ])
      setPending(p.pending || [])
      setCounts(all.counts || {})
    } catch (err) {
      setError(err.response?.data?.error || err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function confirm(id, teamId) {
    setBusyId(id)
    try {
      await api.post(`/api/aliases/${id}/confirm`, teamId ? { teamId } : {})
      setPending(prev => prev.filter(a => a._id !== id))
      setCounts(c => ({ ...c, pending: Math.max((c.pending ?? 1) - 1, 0), confirmed: (c.confirmed ?? 0) + 1 }))
    } catch (err) {
      setError(err.response?.data?.error || err.message)
    } finally { setBusyId(null) }
  }

  async function reject(id) {
    setBusyId(id)
    try {
      await api.post(`/api/aliases/${id}/reject`)
      setPending(prev => prev.filter(a => a._id !== id))
      setCounts(c => ({ ...c, pending: Math.max((c.pending ?? 1) - 1, 0), rejected: (c.rejected ?? 0) + 1 }))
    } catch (err) {
      setError(err.response?.data?.error || err.message)
    } finally { setBusyId(null) }
  }

  async function runLookup(e) {
    e.preventDefault()
    if (!query.trim()) return
    try {
      const { data } = await api.get('/api/aliases/resolve', { params: { source: 'sportybet', name: query.trim() } })
      setLookup(data)
    } catch (err) {
      setError(err.response?.data?.error || err.message)
    }
  }

  const S = {
    card:  { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', padding: '14px 16px', marginBottom: 10 },
    btn:   { padding: '6px 12px', borderRadius: 'var(--r-sm)', fontSize: 12, fontWeight: 700, border: '1px solid' },
    chip:  { padding: '2px 8px', borderRadius: 'var(--r-pill)', fontSize: 10, fontWeight: 700 },
  }

  return (
    <AppShell
      title="Team aliases"
      subtitle="Names SportyBet uses that we matched only fuzzily"
      wide={false}
      actions={
        <div className="chip-row">
          {['pending', 'confirmed', 'rejected'].map(k => counts[k] != null && (
            <span key={k} className={`pill pill-${k === 'pending' ? 'warn' : k === 'confirmed' ? 'pos' : 'neg'}`}>
              {counts[k]} {k}
            </span>
          ))}
        </div>
      }
    >
      <p className="muted" style={{ fontSize: 12.5, marginBottom: 14, maxWidth: 720, lineHeight: 1.6 }}>
        Confirm an alias and it becomes exact forever; reject it and we stop proposing that
        match. Highest-frequency names first.
      </p>

      <form onSubmit={runLookup} style={{ ...S.card, display: 'flex', gap: 8, alignItems: 'center' }}>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Check a name, e.g. Man Utd"
          style={{ flex: 1, minWidth: 160, background: 'var(--bg)', border: '1px solid var(--line-strong)', borderRadius: 6, color: 'var(--tx)', padding: '7px 10px', fontSize: 13 }} />
        <button type="submit" style={{ ...S.btn, background: 'var(--surface-2)', color: 'var(--tx-2)', borderColor: 'var(--line-strong)' }}>Resolve</button>
      </form>

      {lookup && (
        <div style={{ ...S.card, fontSize: 12 }}>
          <strong style={{ color: 'var(--tx)' }}>{lookup.externalName}</strong>
          <span style={{ color: 'var(--tx-4)', marginLeft: 8 }}>normalises to &ldquo;{lookup.normalized}&rdquo;</span>
          <div style={{ marginTop: 6 }}>
            status: <strong style={{ color: lookup.status === 'confirmed' ? 'var(--pos)' : lookup.status === 'unknown' ? 'var(--tx-3)' : 'var(--warn)' }}>{lookup.status}</strong>
            {lookup.via && <span style={{ color: 'var(--tx-4)' }}> (via {lookup.via})</span>}
          </div>
          {!!lookup.suggestions?.length && (
            <div style={{ marginTop: 6, color: 'var(--tx-3)' }}>
              candidates: {lookup.suggestions.map(t => `${t.name}${t.league ? ` (${t.league})` : ''}`).join(' · ')}
            </div>
          )}
        </div>
      )}

      {error && <div style={{ ...S.card, borderColor: 'var(--neg-dim)', color: 'var(--neg)', fontSize: 13 }}>{error}</div>}
      {loading && <div style={{ color: 'var(--tx-4)', fontSize: 13 }}>Loading…</div>}

      {!loading && !pending.length && (
        <div style={{ ...S.card, color: 'var(--pos)', fontSize: 13 }}>
          Nothing pending. Every name the analyser has seen is either confirmed or rejected.
        </div>
      )}

      {pending.map(a => (
        <div key={a._id} style={S.card}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 15 }}>{a.externalName}</strong>
            <span style={{ ...S.chip, background: 'var(--surface-2)', color: 'var(--tx-3)' }}>seen {a.seenCount}&times;</span>
            {a.method && <span style={{ ...S.chip, background: 'var(--surface-2)', color: 'var(--tx-4)' }}>{a.method}</span>}
          </div>
          <div style={{ fontSize: 11, color: 'var(--tx-4)', marginTop: 3 }}>normalises to &ldquo;{a.normalized}&rdquo;</div>

          {a.team ? (
            <div style={{ marginTop: 9, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: 'var(--tx-3)' }}>proposed:</span>
              <strong style={{ fontSize: 13, color: 'var(--info)' }}>{a.team.name}</strong>
              {a.team.league && <span style={{ fontSize: 11, color: 'var(--tx-4)' }}>{a.team.league}</span>}
              <button disabled={busyId === a._id} onClick={() => confirm(a._id)}
                style={{ ...S.btn, background: 'var(--pos-soft)', color: 'var(--pos)', borderColor: 'var(--pos-dim)' }}>Confirm</button>
              <button disabled={busyId === a._id} onClick={() => reject(a._id)}
                style={{ ...S.btn, background: 'var(--neg-soft)', color: 'var(--neg)', borderColor: 'var(--neg-dim)' }}>Reject</button>
            </div>
          ) : (
            <div style={{ marginTop: 9 }}>
              <div style={{ fontSize: 12, color: 'var(--warn)', marginBottom: 6 }}>No team proposed — pick one:</div>
              {a.suggestions?.length ? a.suggestions.map(t => (
                <button key={t._id} disabled={busyId === a._id} onClick={() => confirm(a._id, t._id)}
                  style={{ ...S.btn, background: 'var(--surface-2)', color: 'var(--info)', borderColor: 'var(--line-strong)', marginRight: 6, marginBottom: 6 }}>
                  {t.name}{t.league ? ` · ${t.league}` : ''}
                </button>
              )) : <span style={{ fontSize: 12, color: 'var(--tx-4)' }}>no candidates found</span>}
              <button disabled={busyId === a._id} onClick={() => reject(a._id)}
                style={{ ...S.btn, background: 'var(--neg-soft)', color: 'var(--neg)', borderColor: 'var(--neg-dim)', marginBottom: 6 }}>Reject</button>
            </div>
          )}
        </div>
      ))}
    </AppShell>
  )
}
