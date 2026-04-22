import { useState } from 'react'
import { Link } from 'react-router-dom'

const CONF_COLOR = { High: '#68d391', Medium: '#f6e05e', Low: '#fc8181' }
const VERDICT_COLOR = (v) =>
  v?.includes('Home') ? '#68d391' : v?.includes('Away') ? '#63b3ed' : '#f6e05e'

function pct(n) { return n != null ? (n * 100).toFixed(0) + '%' : '—' }

function VerdictPill({ verdict, confidence }) {
  if (!verdict) return null
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '5px',
      background: '#2d3748', borderRadius: '20px', padding: '3px 10px'
    }}>
      <span style={{ fontSize: '0.78rem', fontWeight: 700, color: VERDICT_COLOR(verdict) }}>{verdict}</span>
      {confidence && (
        <span style={{
          fontSize: '0.6rem', fontWeight: 700, color: CONF_COLOR[confidence] ?? '#a0aec0',
          background: '#1a1f2e', borderRadius: '10px', padding: '1px 6px'
        }}>{confidence}</span>
      )}
    </span>
  )
}

function OUStrip({ ou }) {
  if (!ou) return null
  const markets = [
    { label: 'O1.5', val: ou.over15 },
    { label: 'O2.5', val: ou.over25 },
    { label: 'O3.5', val: ou.over35 },
  ]
  return (
    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
      {markets.map(({ label, val }) => {
        const p = val != null ? Math.round(val * 100) : null
        if (p == null) return null
        const hot = p >= 60
        return (
          <span key={label} style={{
            fontSize: '0.68rem', fontWeight: 600, padding: '2px 7px', borderRadius: '4px',
            background: hot ? '#1c4532' : '#2d3748',
            color: hot ? '#68d391' : '#718096'
          }}>{label} {p}%</span>
        )
      })}
    </div>
  )
}

export default function PredictionCard({ fixture, prediction, onPredict, computing }) {
  const [expanded, setExpanded] = useState(false)

  const activeData = prediction
    ? (prediction.activeMode === 'B' ? prediction.modeB : prediction.modeA)
    : null
  const claude = prediction?.claudeAnalysis ?? null
  const news   = prediction?.newsAnalysis ?? null

  const date = new Date(fixture.date).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
  })

  // Model top pick
  let modelVerdict = null, modelProb = null
  if (activeData?.result1X2) {
    const { home, draw, away } = activeData.result1X2
    if (home >= draw && home >= away) { modelVerdict = 'Home Win'; modelProb = home }
    else if (away >= draw)            { modelVerdict = 'Away Win'; modelProb = away }
    else                               { modelVerdict = 'Draw';     modelProb = draw }
  }

  const borderColor = claude
    ? (CONF_COLOR[claude.confidence] ?? '#2d3748')
    : '#2d3748'

  return (
    <div style={{
      background: '#1a1f2e', border: `1px solid ${claude ? borderColor + '55' : '#2d3748'}`,
      borderRadius: '12px', marginBottom: '0.75rem', overflow: 'hidden'
    }}>

      {/* ── Header ── */}
      <div style={{ padding: '0.875rem 1.25rem 0.6rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '0.92rem', fontWeight: 700, color: '#e2e8f0' }}>
              {fixture.homeTeamName} <span style={{ color: '#4a5568' }}>vs</span> {fixture.awayTeamName}
            </div>
            <div style={{ fontSize: '0.7rem', color: '#718096', marginTop: '2px' }}>{fixture.league} · {date}</div>
          </div>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            {onPredict && (
              <button onClick={onPredict} disabled={computing} style={{
                background: computing ? '#2d3748' : prediction ? '#2d3748' : '#276749',
                color: computing ? '#718096' : '#a0aec0',
                border: 'none', borderRadius: '6px', padding: '4px 10px',
                cursor: computing ? 'default' : 'pointer', fontSize: '0.72rem', fontWeight: 600
              }}>
                {computing ? 'Computing…' : prediction ? 'Re-run' : 'Predict'}
              </button>
            )}
            <Link to={`/match/${fixture._id}`} style={{ fontSize: '0.72rem', color: '#68d391', textDecoration: 'none' }}>
              Details →
            </Link>
          </div>
        </div>
      </div>

      {/* ── Prediction panel ── */}
      {activeData ? (
        <>
          <div style={{ display: 'flex', gap: '0', borderTop: '1px solid #2d3748' }}>

            {/* Model column */}
            <div style={{ flex: 1, padding: '0.75rem 1.25rem', borderRight: '1px solid #2d3748', minWidth: 0 }}>
              <div style={{ fontSize: '0.6rem', color: '#718096', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
                Model · Mode {prediction.activeMode}
              </div>
              <VerdictPill verdict={modelVerdict} />
              {modelProb != null && (
                <div style={{ fontSize: '0.72rem', color: '#718096', marginTop: '4px' }}>{pct(modelProb)} probability</div>
              )}
              <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                {[
                  { label: fixture.homeTeamName, val: activeData.result1X2.home, key: 'home' },
                  { label: 'Draw',               val: activeData.result1X2.draw, key: 'draw' },
                  { label: fixture.awayTeamName, val: activeData.result1X2.away, key: 'away' },
                ].map(({ label, val, key }) => {
                  const barColor = key === 'home' ? '#276749' : key === 'away' ? '#2b6cb0' : '#744210'
                  const isTop = (
                    (key === 'home' && modelVerdict === 'Home Win') ||
                    (key === 'draw' && modelVerdict === 'Draw') ||
                    (key === 'away' && modelVerdict === 'Away Win')
                  )
                  return (
                    <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '0.65rem', color: isTop ? '#e2e8f0' : '#718096', width: '90px', flexShrink: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {label}
                      </span>
                      <div style={{ flex: 1, height: '5px', background: '#2d3748', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{ width: pct(val), height: '100%', background: isTop ? barColor : '#4a5568', borderRadius: '3px', transition: 'width 0.4s' }} />
                      </div>
                      <span style={{ fontSize: '0.65rem', color: isTop ? '#e2e8f0' : '#718096', width: '32px', textAlign: 'right' }}>{pct(val)}</span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Claude column */}
            <div style={{ flex: 1, padding: '0.75rem 1.25rem', minWidth: 0 }}>
              <div style={{ fontSize: '0.6rem', color: '#718096', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
                Claude AI
              </div>
              {claude ? (
                <>
                  <VerdictPill verdict={claude.verdict} confidence={claude.confidence} />
                  {claude.predictedScore && (
                    <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#e2e8f0', marginTop: '5px' }}>
                      {claude.predictedScore}
                      {claude.htPredictedScore && (
                        <span style={{ fontSize: '0.65rem', fontWeight: 400, color: '#718096', marginLeft: '6px' }}>
                          (HT {claude.htPredictedScore})
                        </span>
                      )}
                    </div>
                  )}
                  {claude.bestBet && (
                    <div style={{ fontSize: '0.7rem', color: '#bee3f8', marginTop: '5px', lineHeight: 1.3 }}>
                      Best bet: {claude.bestBet}
                    </div>
                  )}
                  {news && (
                    <div style={{ marginTop: '6px', fontSize: '0.68rem', color: news.agreesWithModel ? '#68d391' : '#fc8181' }}>
                      {news.agreesWithModel ? '↑ News confirms' : '↓ News conflicts'} · {news.mediaSentiment}
                    </div>
                  )}
                </>
              ) : (
                <div style={{ fontSize: '0.75rem', color: '#4a5568', marginTop: '4px' }}>
                  {prediction ? 'No Claude analysis — re-run with API key' : '—'}
                </div>
              )}
            </div>
          </div>

          {/* O/U strip + expand toggle */}
          <div style={{
            borderTop: '1px solid #2d3748', padding: '0.5rem 1.25rem',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap'
          }}>
            <OUStrip ou={activeData.overUnder} />
            <button onClick={() => setExpanded(e => !e)} style={{
              background: 'none', border: 'none', color: '#4a5568',
              fontSize: '0.68rem', cursor: 'pointer', padding: 0
            }}>
              {expanded ? 'Hide ▲' : 'More ▼'}
            </button>
          </div>

          {/* Expanded: double chance + HT */}
          {expanded && (
            <div style={{ borderTop: '1px solid #2d3748', padding: '0.75rem 1.25rem' }}>
              <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
                {activeData.doubleChance && (
                  <div>
                    <div style={{ fontSize: '0.6rem', color: '#718096', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '5px' }}>Double Chance</div>
                    {[
                      { label: '1X', val: activeData.doubleChance.homeOrDraw },
                      { label: 'X2', val: activeData.doubleChance.awayOrDraw },
                      { label: '12', val: activeData.doubleChance.homeOrAway },
                    ].map(({ label, val }) => (
                      <div key={label} style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '3px' }}>
                        <span style={{ fontSize: '0.65rem', color: '#718096', width: '20px' }}>{label}</span>
                        <div style={{ width: '80px', height: '5px', background: '#2d3748', borderRadius: '3px', overflow: 'hidden' }}>
                          <div style={{ width: pct(val), height: '100%', background: val >= 0.6 ? '#744210' : '#4a5568', borderRadius: '3px' }} />
                        </div>
                        <span style={{ fontSize: '0.65rem', color: '#a0aec0' }}>{pct(val)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {activeData.halfTime?.result1X2 && (
                  <div>
                    <div style={{ fontSize: '0.6rem', color: '#718096', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '5px' }}>Half-Time</div>
                    {[
                      { label: 'HT Home', val: activeData.halfTime.result1X2.home },
                      { label: 'HT Draw', val: activeData.halfTime.result1X2.draw },
                      { label: 'HT Away', val: activeData.halfTime.result1X2.away },
                    ].map(({ label, val }) => (
                      <div key={label} style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '3px' }}>
                        <span style={{ fontSize: '0.65rem', color: '#718096', width: '50px' }}>{label}</span>
                        <div style={{ width: '80px', height: '5px', background: '#2d3748', borderRadius: '3px', overflow: 'hidden' }}>
                          <div style={{ width: pct(val), height: '100%', background: '#4a5568', borderRadius: '3px' }} />
                        </div>
                        <span style={{ fontSize: '0.65rem', color: '#a0aec0' }}>{pct(val)}</span>
                      </div>
                    ))}
                    <div style={{ display: 'flex', gap: '6px', marginTop: '5px' }}>
                      <span style={{ fontSize: '0.65rem', color: '#718096' }}>HT O0.5 {pct(activeData.halfTime.overUnder?.over05)}</span>
                      <span style={{ fontSize: '0.65rem', color: '#718096' }}>O1.5 {pct(activeData.halfTime.overUnder?.over15)}</span>
                    </div>
                  </div>
                )}
                {claude?.analysis && (
                  <div style={{ flex: 1, minWidth: '200px' }}>
                    <div style={{ fontSize: '0.6rem', color: '#718096', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '5px' }}>Analysis</div>
                    <p style={{ fontSize: '0.72rem', color: '#a0aec0', lineHeight: 1.5, margin: 0 }}>{claude.analysis}</p>
                    {claude.riskFactor && (
                      <p style={{ fontSize: '0.68rem', color: '#fc8181', marginTop: '4px', marginBottom: 0 }}>
                        Risk: {claude.riskFactor}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      ) : (
        <div style={{ padding: '1rem 1.25rem', borderTop: '1px solid #2d3748' }}>
          <p style={{ color: '#4a5568', fontSize: '0.82rem', margin: 0 }}>No prediction yet.</p>
        </div>
      )}
    </div>
  )
}
