import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import api from '../api'

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
    page:  { minHeight: '100vh', background: '#0d1117', color: '#e2e8f0', padding: '1.25rem', fontFamily: 'system-ui, -apple-system, sans-serif' },
    card:  { background: '#161b25', border: '1px solid #2d3748', borderRadius: 12, padding: '0.9rem 1.1rem', marginBottom: '0.7rem' },
    btn:   { padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: '1px solid' },
    chip:  { padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700 },
  }

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 4, flexWrap: 'wrap' }}>
        <Link to="/" style={{ color: '#4a5568', fontSize: 13, textDecoration: 'none' }}>&larr; Dashboard</Link>
        <h1 style={{ fontSize: 20, margin: 0 }}>Team name aliases</h1>
        {['pending', 'confirmed', 'rejected'].map(k => counts[k] != null && (
          <span key={k} style={{ ...S.chip, background: k === 'pending' ? '#2d2a1a' : k === 'confirmed' ? '#1a3a2a' : '#3a1a1a', color: k === 'pending' ? '#ecc94b' : k === 'confirmed' ? '#68d391' : '#fc8181' }}>
            {counts[k]} {k}
          </span>
        ))}
      </div>
      <p style={{ color: '#4a5568', fontSize: 12, marginTop: 0, maxWidth: 720 }}>
        Names SportyBet uses that we matched only fuzzily. Confirm one and it becomes exact
        forever; reject it and we stop proposing that match. Highest-frequency names first.
      </p>

      <form onSubmit={runLookup} style={{ ...S.card, display: 'flex', gap: 8, alignItems: 'center' }}>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Check a name, e.g. Man Utd"
          style={{ flex: 1, minWidth: 160, background: '#0d1117', border: '1px solid #2d3748', borderRadius: 6, color: '#e2e8f0', padding: '7px 10px', fontSize: 13 }} />
        <button type="submit" style={{ ...S.btn, background: '#1a2030', color: '#a0aec0', borderColor: '#2d3748' }}>Resolve</button>
      </form>

      {lookup && (
        <div style={{ ...S.card, fontSize: 12 }}>
          <strong style={{ color: '#cbd5e0' }}>{lookup.externalName}</strong>
          <span style={{ color: '#4a5568', marginLeft: 8 }}>normalises to &ldquo;{lookup.normalized}&rdquo;</span>
          <div style={{ marginTop: 6 }}>
            status: <strong style={{ color: lookup.status === 'confirmed' ? '#68d391' : lookup.status === 'unknown' ? '#718096' : '#ecc94b' }}>{lookup.status}</strong>
            {lookup.via && <span style={{ color: '#4a5568' }}> (via {lookup.via})</span>}
          </div>
          {!!lookup.suggestions?.length && (
            <div style={{ marginTop: 6, color: '#718096' }}>
              candidates: {lookup.suggestions.map(t => `${t.name}${t.league ? ` (${t.league})` : ''}`).join(' · ')}
            </div>
          )}
        </div>
      )}

      {error && <div style={{ ...S.card, borderColor: '#742a2a', color: '#fc8181', fontSize: 13 }}>{error}</div>}
      {loading && <div style={{ color: '#4a5568', fontSize: 13 }}>Loading…</div>}

      {!loading && !pending.length && (
        <div style={{ ...S.card, color: '#68d391', fontSize: 13 }}>
          Nothing pending. Every name the analyser has seen is either confirmed or rejected.
        </div>
      )}

      {pending.map(a => (
        <div key={a._id} style={S.card}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 15 }}>{a.externalName}</strong>
            <span style={{ ...S.chip, background: '#1a2030', color: '#718096' }}>seen {a.seenCount}&times;</span>
            {a.method && <span style={{ ...S.chip, background: '#1a2030', color: '#4a5568' }}>{a.method}</span>}
          </div>
          <div style={{ fontSize: 11, color: '#4a5568', marginTop: 3 }}>normalises to &ldquo;{a.normalized}&rdquo;</div>

          {a.team ? (
            <div style={{ marginTop: 9, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: '#718096' }}>proposed:</span>
              <strong style={{ fontSize: 13, color: '#90cdf4' }}>{a.team.name}</strong>
              {a.team.league && <span style={{ fontSize: 11, color: '#4a5568' }}>{a.team.league}</span>}
              <button disabled={busyId === a._id} onClick={() => confirm(a._id)}
                style={{ ...S.btn, background: '#1a3a2a', color: '#68d391', borderColor: '#276749' }}>Confirm</button>
              <button disabled={busyId === a._id} onClick={() => reject(a._id)}
                style={{ ...S.btn, background: '#3a1a1a', color: '#fc8181', borderColor: '#742a2a' }}>Reject</button>
            </div>
          ) : (
            <div style={{ marginTop: 9 }}>
              <div style={{ fontSize: 12, color: '#ecc94b', marginBottom: 6 }}>No team proposed — pick one:</div>
              {a.suggestions?.length ? a.suggestions.map(t => (
                <button key={t._id} disabled={busyId === a._id} onClick={() => confirm(a._id, t._id)}
                  style={{ ...S.btn, background: '#1a2030', color: '#90cdf4', borderColor: '#2d3748', marginRight: 6, marginBottom: 6 }}>
                  {t.name}{t.league ? ` · ${t.league}` : ''}
                </button>
              )) : <span style={{ fontSize: 12, color: '#4a5568' }}>no candidates found</span>}
              <button disabled={busyId === a._id} onClick={() => reject(a._id)}
                style={{ ...S.btn, background: '#3a1a1a', color: '#fc8181', borderColor: '#742a2a', marginBottom: 6 }}>Reject</button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
