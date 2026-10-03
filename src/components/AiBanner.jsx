import { useState, useEffect } from 'react'
import api from '../api'

/**
 * A red bar across every admin page while the AI is not answering (services/aiHealth.js).
 *
 * Two outages went unseen because the only sign was a server log line: the key on 2026-09-27 and
 * the credit balance on 2026-10-03, while rollover steps were booked without their AI check.
 * Polled once a minute; renders nothing while the AI is fine or the status cannot be read.
 */
export default function AiBanner() {
  const [h, setH] = useState(null)
  useEffect(() => {
    let alive = true
    const load = () => api.get('/api/ai-health').then(r => { if (alive) setH(r.data) }).catch(() => {})
    load()
    const t = setInterval(load, 60_000)
    return () => { alive = false; clearInterval(t) }
  }, [])
  if (!h?.down) return null
  const since = h.since ? new Date(h.since).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : null
  return (
    <div role="alert" style={{
      background: 'var(--neg-soft)', border: '1px solid var(--neg)', color: 'var(--neg)',
      borderRadius: 8, padding: '10px 14px', margin: '0 0 16px', fontSize: 13, lineHeight: 1.45,
    }}>
      <b>The AI is not answering{since ? ` (since ${since})` : ''}</b> — {h.words}.{' '}
      {h.holding === false
        ? 'The hold is switched off at /caps, so rollover steps are being booked unchecked.'
        : 'Rollover steps are held until it is back.'}
      {h.lastError && <div style={{ opacity: 0.8, fontSize: 12, marginTop: 4 }}>Anthropic said: {h.lastError}</div>}
    </div>
  )
}
