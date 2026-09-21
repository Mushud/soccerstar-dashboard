import { useState, useEffect, useCallback } from 'react'
import api from '../api'
import AppShell from '../components/AppShell'

/**
 * What a pass costs. Edited here, read by the landing page.
 *
 * The price used to be typed into the marketing copy, which meant changing it was a deploy and
 * the app's own upgrade prompt went on saying the old number. Now there is one row in
 * SystemConfig and everything reads it.
 *
 * The save is a whole-list replace, so what you see is what the public gets — including a plan
 * you switched off. Nothing here charges anybody: mobile money is not wired up, so these numbers
 * are what the landing page shows and nothing more.
 */
const PLAN_KEYS = ['free', 'daily', 'weekly', 'monthly']

export default function Pricing() {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState(null)
  const [saved, setSaved]     = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const { data } = await api.get('/api/pricing')
      setData(data)
    } catch (err) {
      setError(err.response?.data?.error || err.message)
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const edit = (key, patch) => {
    setSaved(false)
    setData(d => ({ ...d, plans: d.plans.map(p => (p.key === key ? { ...p, ...patch } : p)) }))
  }

  // Featured is one-of-many, not a checkbox each: two recommended plans recommend nothing.
  const feature = (key) => {
    setSaved(false)
    setData(d => ({ ...d, plans: d.plans.map(p => ({ ...p, featured: p.key === key })) }))
  }

  const save = async () => {
    setSaving(true); setError(null); setSaved(false)
    try {
      const { data: out } = await api.put('/api/pricing', data)
      setData(out); setSaved(true)
    } catch (err) {
      setError(err.response?.data?.error || err.message)
    } finally { setSaving(false) }
  }

  const reset = async () => {
    if (!confirm('Put every price and feature list back to the seeded defaults?')) return
    setSaving(true); setError(null)
    try {
      const { data: out } = await api.post('/api/pricing/reset')
      setData(out); setSaved(true)
    } catch (err) {
      setError(err.response?.data?.error || err.message)
    } finally { setSaving(false) }
  }

  const S = {
    card:  { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', padding: 16, marginBottom: 12 },
    input: { background: 'var(--bg)', border: '1px solid var(--line-strong)', borderRadius: 6, color: 'var(--tx)', padding: '7px 10px', fontSize: 13 },
    label: { display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--tx-2)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 },
    btn:   { padding: '8px 14px', borderRadius: 'var(--r-sm)', fontSize: 12.5, fontWeight: 700, border: '1px solid', cursor: 'pointer' },
  }

  return (
    <AppShell
      title="Pricing"
      subtitle="What a pass costs — the landing page reads this"
      wide={false}
      actions={
        <div className="chip-row">
          {saved && <span className="pill pill-pos">Saved</span>}
          <button onClick={reset} disabled={saving || !data}
            style={{ ...S.btn, background: 'var(--surface-2)', color: 'var(--tx-2)', borderColor: 'var(--line-strong)' }}>
            Reset
          </button>
          <button onClick={save} disabled={saving || !data}
            style={{ ...S.btn, background: 'var(--pos)', color: '#06140B', borderColor: 'var(--pos)' }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      }
    >
      <p className="muted" style={{ fontSize: 12.5, marginBottom: 14, maxWidth: 720, lineHeight: 1.6 }}>
        Prices are shown on the landing page exactly as typed here. Nothing takes money yet — mobile
        money is still to be wired up — so changing a price changes what is advertised, not what
        anybody is charged. A plan switched off disappears from the page entirely.
      </p>

      {error && <div className="pill pill-neg" style={{ marginBottom: 12 }}>{error}</div>}
      {loading && <div className="muted" style={{ fontSize: 13 }}>Loading…</div>}

      {data && (
        <>
          <div style={{ ...S.card, display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <div>
              <label style={S.label} htmlFor="ccy">Currency</label>
              <input id="ccy" value={data.currency} style={{ ...S.input, width: 90 }}
                onChange={e => { setSaved(false); setData(d => ({ ...d, currency: e.target.value })) }} />
            </div>
            <div className="muted" style={{ fontSize: 12, paddingBottom: 8 }}>
              Shown before the number, e.g. “{data.currency} 10”.
            </div>
          </div>

          {PLAN_KEYS.map(key => {
            const p = data.plans.find(x => x.key === key)
            if (!p) return null
            return (
              <div key={key} style={{ ...S.card, opacity: p.active ? 1 : 0.55 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 }}>
                  <strong style={{ color: 'var(--tx)', fontSize: 15, flexGrow: 1 }}>{p.name}</strong>
                  {p.featured && <span className="pill pill-pos">Featured</span>}
                  <label style={{ fontSize: 12, color: 'var(--tx-2)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="checkbox" checked={p.featured} onChange={() => feature(key)} />
                    Recommend
                  </label>
                  <label style={{ fontSize: 12, color: 'var(--tx-2)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="checkbox" checked={p.active} onChange={e => edit(key, { active: e.target.checked })} />
                    Shown
                  </label>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
                  <div>
                    <label style={S.label}>Name</label>
                    <input value={p.name} style={{ ...S.input, width: '100%' }}
                      onChange={e => edit(key, { name: e.target.value })} />
                  </div>
                  <div>
                    <label style={S.label}>Price ({data.currency})</label>
                    <input type="number" min="0" step="1" value={p.price} disabled={key === 'free'}
                      style={{ ...S.input, width: '100%' }}
                      onChange={e => edit(key, { price: e.target.value === '' ? '' : Number(e.target.value) })} />
                  </div>
                  <div>
                    <label style={S.label}>Per</label>
                    <input value={p.per} placeholder="/ day" style={{ ...S.input, width: '100%' }}
                      onChange={e => edit(key, { per: e.target.value })} />
                  </div>
                  <div>
                    <label style={S.label}>Button</label>
                    <input value={p.cta} style={{ ...S.input, width: '100%' }}
                      onChange={e => edit(key, { cta: e.target.value })} />
                  </div>
                </div>

                <div style={{ marginTop: 12 }}>
                  <label style={S.label}>What it includes — one per line, up to 8</label>
                  <textarea rows={4} value={p.lines.join('\n')}
                    style={{ ...S.input, width: '100%', resize: 'vertical', lineHeight: 1.6, fontFamily: 'inherit' }}
                    onChange={e => edit(key, { lines: e.target.value.split('\n') })} />
                </div>
              </div>
            )
          })}

          <div className="muted" style={{ fontSize: 12, lineHeight: 1.6, maxWidth: 720 }}>
            A blank line is dropped on save, so you can type freely. Free is fixed at 0 — it is the
            tier the limits in User.FREE_LIMITS describe.
          </div>
        </>
      )}
    </AppShell>
  )
}
