import React, { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import api from '../api'
import AppShell from '../components/AppShell'
import ProbabilityBar from '../components/ProbabilityBar'
import ScoreMatrix from '../components/ScoreMatrix'

const s = {
  card: { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', padding: 'clamp(14px, 2vw, 20px)', marginBottom: 16 },
  title: { fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 },
  row: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16 },
  stat: { minWidth: 0 },
  statLabel: { fontSize: 11, color: 'var(--tx-3)', marginBottom: 3 },
  statValue: { fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }
}

export default function MatchDetail() {
  const { id } = useParams()
  const [data, setData] = useState(null)
  const [activeMode, setActiveMode] = useState('active')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get(`/api/fixtures/${id}`)
      .then(r => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return (
    <AppShell title="Match" wide={false}>
      <div style={{ display: 'grid', gap: 12 }}>
        {[0, 1, 2].map(i => <div key={i} className="skel" style={{ height: 120 }} />)}
      </div>
    </AppShell>
  )
  if (!data) return (
    <AppShell title="Match" wide={false}>
      <div className="card empty">
        <div className="empty-ico">🔍</div>
        <div className="empty-title">Fixture not found</div>
        <div className="empty-sub">It may have been removed, or the link is stale.</div>
        <Link to="/" className="btn btn-accent" style={{ marginTop: 16 }}>Back to matches</Link>
      </div>
    </AppShell>
  )

  const { fixture, prediction } = data
  const blended = prediction?.blended ?? null

  // 'active' = initial state; resolve to best available: blended > modeB > modeA
  const resolvedMode = activeMode === 'active'
    ? (blended ? 'blended' : prediction?.modeB ? 'B' : 'A')
    : activeMode

  const modeData = prediction
    ? (resolvedMode === 'blended' && blended ? blended
      : resolvedMode === 'B' && prediction.modeB ? prediction.modeB
      : prediction.modeA)
    : null

  const date = new Date(fixture.date).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
  })

  return (
    <AppShell
      title={`${fixture.homeTeamName} vs ${fixture.awayTeamName}`}
      subtitle={`${fixture.league} · ${date}`}
      wide={false}
      actions={<Link to="/" className="btn btn-sm">← Back</Link>}
    >
        <div style={s.card}>
          <div style={s.title}>Match Info</div>
          <div style={s.row}>
            <div style={s.stat}><div style={s.statLabel}>League</div><div style={s.statValue}>{fixture.league}</div></div>
            <div style={s.stat}><div style={s.statLabel}>Date</div><div style={s.statValue}>{date}</div></div>
            <div style={s.stat}><div style={s.statLabel}>Status</div><div style={s.statValue}>{fixture.status}</div></div>
            <div style={s.stat}><div style={s.statLabel}>Data Source</div><div style={s.statValue}>{fixture.dataSource}</div></div>
          </div>
        </div>

        {prediction && (
          <>
            {/* Model comparison strip */}
            {prediction.modeA && prediction.modeB && (
              <ModelComparison modeA={prediction.modeA} modeB={prediction.modeB} blended={blended} fixture={fixture} claudeAnalysis={prediction.claudeAnalysis} />
            )}

            <div style={{ display: 'flex', gap: '8px', marginBottom: '1rem', flexWrap: 'wrap' }}>
              {blended && (
                <button onClick={() => setActiveMode('blended')} style={tabBtn(resolvedMode === 'blended')}>
                  Blended
                  <span style={{ marginLeft: 4, fontSize: '0.6rem', background: 'var(--accent-dim)', padding: '1px 5px', borderRadius: '3px' }}>ELO+Odds</span>
                </button>
              )}
              <button onClick={() => setActiveMode('B')} style={tabBtn(resolvedMode === 'B')}>
                Mode B — Dixon-Coles{prediction.modeB?.xgDataUsed ? ' + xG' : ''}
                {prediction.modeB?.xgDataUsed && (
                  <span style={{ marginLeft: 4, fontSize: '0.6rem', background: 'var(--pos-dim)', padding: '1px 5px', borderRadius: '3px' }}>xG</span>
                )}
              </button>
              <button onClick={() => setActiveMode('A')} style={tabBtn(resolvedMode === 'A')}>
                Mode A — Pure Poisson
              </button>
            </div>

            {modeData && (
              <>
                {resolvedMode !== 'blended' && (
                  <div style={s.card}>
                    <div style={s.title}>
                      Expected Goals (λ)
                      {modeData.dixonColesApplied && <span style={{ marginLeft: 8, fontSize: '0.65rem', color: 'var(--pos)' }}>Dixon-Coles applied</span>}
                      {modeData.xgDataUsed && <span style={{ marginLeft: 8, fontSize: '0.65rem', color: 'var(--info)' }}>using xG strengths</span>}
                    </div>
                    <div style={s.row}>
                      <div style={s.stat}>
                        <div style={s.statLabel}>{fixture.homeTeamName} (λ home)</div>
                        <div style={s.statValue}>{modeData.lambdaHome?.toFixed(3)}</div>
                      </div>
                      <div style={s.stat}>
                        <div style={s.statLabel}>{fixture.awayTeamName} (λ away)</div>
                        <div style={s.statValue}>{modeData.lambdaAway?.toFixed(3)}</div>
                      </div>
                    </div>
                  </div>
                )}

                {resolvedMode === 'blended' && blended && (
                  <BlendedBreakdown blended={blended} fixture={fixture} />
                )}

                {resolvedMode !== 'blended' && modeData.halfTime && (
                  <HalfTimePrediction ht={modeData.halfTime} fixture={fixture} />
                )}

                <div style={s.card}>
                  <div style={s.title}>1X2 Match Result</div>
                  <ProbabilityBar label="Home" value={modeData.result1X2.home} colorKey="home" />
                  <ProbabilityBar label="Draw" value={modeData.result1X2.draw} colorKey="draw" />
                  <ProbabilityBar label="Away" value={modeData.result1X2.away} colorKey="away" />
                </div>

                <div style={s.card}>
                  <div style={s.title}>Double Chance</div>
                  <ProbabilityBar label="1X (H or D)" value={modeData.doubleChance.homeOrDraw} colorKey="dc" />
                  <ProbabilityBar label="X2 (A or D)" value={modeData.doubleChance.awayOrDraw} colorKey="dc" />
                  <ProbabilityBar label="12 (H or A)" value={modeData.doubleChance.homeOrAway} colorKey="dc" />
                </div>

                <div style={s.card}>
                  <div style={s.title}>Over / Under</div>
                  <ProbabilityBar label="Over 1.5" value={modeData.overUnder.over15} colorKey="over" />
                  <ProbabilityBar label="Under 1.5" value={modeData.overUnder.under15} colorKey="under" />
                  <ProbabilityBar label="Over 2.5" value={modeData.overUnder.over25} colorKey="over" />
                  <ProbabilityBar label="Under 2.5" value={modeData.overUnder.under25} colorKey="under" />
                  <ProbabilityBar label="Over 3.5" value={modeData.overUnder.over35} colorKey="over" />
                  <ProbabilityBar label="Under 3.5" value={modeData.overUnder.under35} colorKey="under" />
                </div>

                {resolvedMode !== 'blended' && modeData.scoreMatrix && (
                  <div style={s.card}>
                    <div style={s.title}>Score Probability Matrix (Home rows × Away cols)</div>
                    <ScoreMatrix matrix={modeData.scoreMatrix} />
                  </div>
                )}
              </>
            )}
          </>
        )}

        {prediction?.enrichment && (
          <EnrichmentPanel enrichment={prediction.enrichment} fixture={fixture} />
        )}

        {prediction?.claudeAnalysis && (
          <ClaudeAnalysis analysis={prediction.claudeAnalysis} fixture={fixture} />
        )}

        {prediction?.newsAnalysis && (
          <NewsAnalysis analysis={prediction.newsAnalysis} fixture={fixture} />
        )}

        {!prediction && (
          <div style={{ ...s.card, color: 'var(--tx-3)' }}>
            No prediction computed for this fixture yet. Run the prediction engine from the dashboard.
          </div>
        )}
    </AppShell>
  )
}

function pct(n) { return n != null ? (n * 100).toFixed(1) + '%' : '—' }
function diff(b, a) {
  const d = ((b - a) * 100)
  const s = d > 0 ? '+' : ''
  return <span style={{ fontSize: '0.65rem', color: Math.abs(d) < 0.5 ? 'var(--tx-3)' : d > 0 ? 'var(--pos)' : 'var(--neg)', marginLeft: 3 }}>{s}{d.toFixed(1)}pp</span>
}

function HalfTimePrediction({ ht, fixture }) {
  const verdictColor = ht.result1X2.home > ht.result1X2.away && ht.result1X2.home > ht.result1X2.draw
    ? 'var(--pos)'
    : ht.result1X2.away > ht.result1X2.home && ht.result1X2.away > ht.result1X2.draw
      ? 'var(--neg)' : 'var(--warn)'

  const verdict = ht.result1X2.home > ht.result1X2.away && ht.result1X2.home > ht.result1X2.draw
    ? fixture.homeTeamName
    : ht.result1X2.away > ht.result1X2.home && ht.result1X2.away > ht.result1X2.draw
      ? fixture.awayTeamName : 'Draw'

  return (
    <div style={{ ...s.card, borderColor: 'var(--accent-dim)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <div style={s.title}>Half-Time Prediction</div>
        <span style={{ fontSize: '0.68rem', color: 'var(--tx-3)', background: 'var(--line-strong)', padding: '2px 8px', borderRadius: '4px' }}>
          λ {ht.lambdaHome?.toFixed(2)} – {ht.lambdaAway?.toFixed(2)}
        </span>
        <span style={{ fontSize: '0.72rem', fontWeight: 700, color: verdictColor, marginLeft: 'auto' }}>
          {verdict} leading at HT · {pct(Math.max(ht.result1X2.home, ht.result1X2.draw, ht.result1X2.away))}
        </span>
      </div>

      <div style={s.row}>
        <div style={{ flex: 2, minWidth: '200px' }}>
          <div style={{ ...s.statLabel, marginBottom: '8px' }}>HT 1X2</div>
          <ProbabilityBar label="HT Home" value={ht.result1X2.home} colorKey="home" />
          <ProbabilityBar label="HT Draw" value={ht.result1X2.draw} colorKey="draw" />
          <ProbabilityBar label="HT Away" value={ht.result1X2.away} colorKey="away" />
        </div>

        <div style={{ flex: 1, minWidth: '160px' }}>
          <div style={{ ...s.statLabel, marginBottom: '8px' }}>HT Goals</div>
          <ProbabilityBar label="Over 0.5" value={ht.overUnder.over05} colorKey="over" />
          <ProbabilityBar label="Under 0.5" value={ht.overUnder.under05} colorKey="under" />
          <ProbabilityBar label="Over 1.5" value={ht.overUnder.over15} colorKey="over" />
          <ProbabilityBar label="Under 1.5" value={ht.overUnder.under15} colorKey="under" />
          {ht.bothTeamsToScore != null && (
            <ProbabilityBar label="BTTS HT" value={ht.bothTeamsToScore} colorKey="dc" />
          )}
        </div>
      </div>
    </div>
  )
}

function BlendedBreakdown({ blended, fixture }) {
  const w = blended.weights ?? {}
  const outcomes = [
    { label: fixture.homeTeamName, key: 'home', color: 'var(--pos-dim)' },
    { label: 'Draw',               key: 'draw', color: 'var(--warn-dim)' },
    { label: fixture.awayTeamName, key: 'away', color: 'var(--info-dim)' },
  ]
  const topKey = Object.entries(blended.result1X2 ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0]

  return (
    <>
      {/* Weights strip */}
      {(w.poisson || w.elo || w.odds) && (
        <div style={{ ...s.card, padding: '0.75rem 1.25rem' }}>
          <div style={s.title}>Blend Weights</div>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {[['Poisson', w.poisson, 'var(--info)'], ['ELO', w.elo, 'var(--warn)'], ['Bookmaker', w.odds, 'var(--accent-2)']].map(([label, val, color]) => val != null && (
              <div key={label} style={{ background: 'var(--line-strong)', borderRadius: '8px', padding: '6px 14px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.6rem', color: 'var(--tx-3)' }}>{label}</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color }}>{Math.round(val * 100)}%</div>
              </div>
            ))}
            {blended.bookmaker && (
              <div style={{ background: 'var(--line-strong)', borderRadius: '8px', padding: '6px 14px', display: 'flex', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '0.6rem', color: 'var(--tx-3)' }}>Bookmaker</div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--tx)' }}>{blended.bookmaker}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Probability comparison table */}
      {blended.result1X2 && (
        <div style={s.card}>
          <div style={s.title}>1X2 — All Models</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', color: 'var(--tx-3)', padding: '4px 8px', borderBottom: '1px solid var(--line-strong)' }}>Outcome</th>
                  <th style={{ textAlign: 'right', color: 'var(--info)', padding: '4px 8px', borderBottom: '1px solid var(--line-strong)' }}>Poisson</th>
                  <th style={{ textAlign: 'right', color: 'var(--warn)', padding: '4px 8px', borderBottom: '1px solid var(--line-strong)' }}>ELO</th>
                  {blended.oddsProbs && <th style={{ textAlign: 'right', color: 'var(--accent-2)', padding: '4px 8px', borderBottom: '1px solid var(--line-strong)' }}>Odds (devigged)</th>}
                  {blended.rawOdds && <th style={{ textAlign: 'right', color: 'var(--tx-3)', padding: '4px 8px', borderBottom: '1px solid var(--line-strong)' }}>Raw Odds</th>}
                  <th style={{ textAlign: 'right', color: 'var(--pos)', padding: '4px 8px', borderBottom: '1px solid var(--line-strong)', fontWeight: 700 }}>Blended</th>
                </tr>
              </thead>
              <tbody>
                {outcomes.map(({ label, key, color }) => (
                  <tr key={key} style={{ borderBottom: '1px solid var(--surface)', background: key === topKey ? 'var(--pos-soft)' : 'transparent' }}>
                    <td style={{ padding: '7px 8px', color, fontWeight: key === topKey ? 700 : 400 }}>{label}</td>
                    <td style={{ padding: '7px 8px', textAlign: 'right', color: 'var(--info)' }}>{pct(blended.poissonProbs?.[key])}</td>
                    <td style={{ padding: '7px 8px', textAlign: 'right', color: 'var(--warn)' }}>{pct(blended.eloProbs?.[key])}</td>
                    {blended.oddsProbs && <td style={{ padding: '7px 8px', textAlign: 'right', color: 'var(--accent-2)' }}>{pct(blended.oddsProbs?.[key])}</td>}
                    {blended.rawOdds && <td style={{ padding: '7px 8px', textAlign: 'right', color: 'var(--tx-3)' }}>{blended.rawOdds?.[key]?.toFixed(2) ?? '—'}</td>}
                    <td style={{ padding: '7px 8px', textAlign: 'right', color: 'var(--pos)', fontWeight: 700 }}>{pct(blended.result1X2?.[key])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* O/U + BTTS */}
      {(blended.overUnder || blended.bothTeamsToScore != null) && (
        <div style={s.card}>
          <div style={s.title}>Goals Markets (Blended)</div>
          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
            {blended.overUnder && (
              <div style={{ flex: 2, minWidth: '200px' }}>
                <ProbabilityBar label="Over 1.5" value={blended.overUnder.over15} colorKey="over" />
                <ProbabilityBar label="Under 1.5" value={blended.overUnder.under15} colorKey="under" />
                <ProbabilityBar label="Over 2.5" value={blended.overUnder.over25} colorKey="over" />
                <ProbabilityBar label="Under 2.5" value={blended.overUnder.under25} colorKey="under" />
                <ProbabilityBar label="Over 3.5" value={blended.overUnder.over35} colorKey="over" />
                <ProbabilityBar label="Under 3.5" value={blended.overUnder.under35} colorKey="under" />
              </div>
            )}
            {blended.bothTeamsToScore != null && (
              <div style={{ flex: 1, minWidth: '140px' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--tx-3)', marginBottom: '8px' }}>Both Teams to Score</div>
                <ProbabilityBar label="BTTS Yes" value={blended.bothTeamsToScore} colorKey="over" />
                <ProbabilityBar label="BTTS No"  value={1 - blended.bothTeamsToScore} colorKey="under" />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Double Chance */}
      {blended.doubleChance && (
        <div style={s.card}>
          <div style={s.title}>Double Chance (Blended)</div>
          <ProbabilityBar label="1X (H or D)" value={blended.doubleChance.homeOrDraw} colorKey="dc" />
          <ProbabilityBar label="X2 (A or D)" value={blended.doubleChance.awayOrDraw} colorKey="dc" />
          <ProbabilityBar label="12 (H or A)" value={blended.doubleChance.homeOrAway} colorKey="dc" />
        </div>
      )}
    </>
  )
}

function ModelComparison({ modeA, modeB, blended, fixture, claudeAnalysis }) {
  const rows = [
    { label: 'Home win',    a: modeA.result1X2?.home,              b: modeB.result1X2?.home,              bl: blended?.result1X2?.home },
    { label: 'Draw',        a: modeA.result1X2?.draw,              b: modeB.result1X2?.draw,              bl: blended?.result1X2?.draw },
    { label: 'Away win',    a: modeA.result1X2?.away,              b: modeB.result1X2?.away,              bl: blended?.result1X2?.away },
    { label: 'Over 2.5',    a: modeA.overUnder?.over25,            b: modeB.overUnder?.over25,            bl: blended?.overUnder?.over25 },
    { label: 'Over 1.5',    a: modeA.overUnder?.over15,            b: modeB.overUnder?.over15,            bl: blended?.overUnder?.over15 },
    { label: 'BTTS',        a: null,                               b: modeB.bothTeamsToScore,             bl: blended?.bothTeamsToScore },
    { label: '1X',          a: modeA.doubleChance?.homeOrDraw,     b: modeB.doubleChance?.homeOrDraw,     bl: blended?.doubleChance?.homeOrDraw },
    { label: 'X2',          a: modeA.doubleChance?.awayOrDraw,     b: modeB.doubleChance?.awayOrDraw,     bl: blended?.doubleChance?.awayOrDraw },
    { label: '─', a: null, b: null, bl: null },
    { label: 'HT Home',     a: modeA.halfTime?.result1X2?.home,    b: modeB.halfTime?.result1X2?.home,    bl: null },
    { label: 'HT Draw',     a: modeA.halfTime?.result1X2?.draw,    b: modeB.halfTime?.result1X2?.draw,    bl: null },
    { label: 'HT Away',     a: modeA.halfTime?.result1X2?.away,    b: modeB.halfTime?.result1X2?.away,    bl: null },
    { label: 'HT Over 0.5', a: modeA.halfTime?.overUnder?.over05,  b: modeB.halfTime?.overUnder?.over05,  bl: null },
    { label: 'HT Over 1.5', a: modeA.halfTime?.overUnder?.over15,  b: modeB.halfTime?.overUnder?.over15,  bl: null },
  ]

  const modeBLabel = modeB.xgDataUsed ? 'Mode B (xG+DC)' : 'Mode B (DC)'
  const agreementColor = claudeAnalysis?.modelAgreement === 'Strong' ? 'var(--pos)'
    : claudeAnalysis?.modelAgreement === 'Conflicting' ? 'var(--neg)' : 'var(--warn)'
  const hasBlended = blended != null

  return (
    <div style={{ ...s.card, marginBottom: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <div style={s.title}>Model Comparison</div>
        {claudeAnalysis?.modelAgreement && (
          <span style={{ fontSize: '0.68rem', color: agreementColor, fontWeight: 600 }}>
            {claudeAnalysis.modelAgreement} agreement
          </span>
        )}
        {claudeAnalysis?.preferredModel && (
          <span style={{ fontSize: '0.68rem', color: 'var(--info)', background: 'var(--line-strong)', padding: '2px 8px', borderRadius: '4px' }}>
            Claude prefers: {claudeAnalysis.preferredModel}
          </span>
        )}
        {blended?.bookmaker && (
          <span style={{ fontSize: '0.62rem', color: 'var(--tx-3)', background: 'var(--line-strong)', padding: '2px 6px', borderRadius: '4px' }}>
            Odds: {blended.bookmaker}
          </span>
        )}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', color: 'var(--tx-3)', fontWeight: 600, padding: '4px 8px', borderBottom: '1px solid var(--line-strong)' }}>Market</th>
              <th style={{ textAlign: 'right', color: 'var(--tx-2)', fontWeight: 600, padding: '4px 8px', borderBottom: '1px solid var(--line-strong)' }}>Mode A</th>
              <th style={{ textAlign: 'right', color: modeB.xgDataUsed ? 'var(--info)' : 'var(--tx-2)', fontWeight: 600, padding: '4px 8px', borderBottom: '1px solid var(--line-strong)' }}>{modeBLabel}</th>
              {hasBlended && <th style={{ textAlign: 'right', color: 'var(--accent-2)', fontWeight: 600, padding: '4px 8px', borderBottom: '1px solid var(--line-strong)' }}>Blended</th>}
              <th style={{ textAlign: 'right', color: 'var(--tx-3)', fontWeight: 600, padding: '4px 8px', borderBottom: '1px solid var(--line-strong)' }}>Δ B→Bl</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              if (row.a === null && row.b === null && row.bl === null) {
                return (
                  <tr key={i}>
                    <td colSpan={hasBlended ? 5 : 4} style={{ padding: '4px 8px', borderTop: '1px solid var(--line-strong)' }}>
                      <span style={{ fontSize: '0.62rem', color: 'var(--tx-4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Half-Time</span>
                    </td>
                  </tr>
                )
              }
              const refVal = hasBlended ? row.b : row.a
              const cmpVal = hasBlended ? row.bl : row.b
              return (
                <tr key={i} style={{ borderBottom: '1px solid var(--surface)' }}>
                  <td style={{ padding: '6px 8px', color: 'var(--tx-2)' }}>{row.label}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--tx)' }}>{pct(row.a)}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', color: modeB.xgDataUsed ? 'var(--info)' : 'var(--tx)', fontWeight: 600 }}>{pct(row.b)}</td>
                  {hasBlended && <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--accent-2)', fontWeight: 700 }}>{pct(row.bl)}</td>}
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{refVal != null && cmpVal != null ? diff(cmpVal, refVal) : null}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {claudeAnalysis?.preferredModelReason && (
        <div style={{ marginTop: '8px', fontSize: '0.75rem', color: 'var(--tx-3)', fontStyle: 'italic' }}>
          {claudeAnalysis.preferredModelReason}
        </div>
      )}
    </div>
  )
}

function FormDot({ result }) {
  const color = result === 'W' ? 'var(--pos)' : result === 'L' ? 'var(--neg)' : 'var(--warn)'
  return (
    <span style={{
      display: 'inline-block', width: 22, height: 22, borderRadius: '50%',
      background: color, color: 'var(--surface)', fontSize: '0.65rem', fontWeight: 700,
      textAlign: 'center', lineHeight: '22px', marginRight: 3
    }}>{result}</span>
  )
}

function EnrichmentPanel({ enrichment, fixture }) {
  const { standings, form, injuries, headToHead } = enrichment

  return (
    <>
      {standings && (
        <div style={s.card}>
          <div style={s.title}>League Standings</div>
          <div style={s.row}>
            {['home', 'away'].map(side => {
              const team = side === 'home' ? fixture.homeTeamName : fixture.awayTeamName
              const st = standings[side]
              if (!st) return null
              return (
                <div key={side} style={{ ...s.stat, minWidth: '200px' }}>
                  <div style={{ ...s.statLabel, marginBottom: '6px', fontWeight: 600, color: 'var(--tx-2)' }}>{team}</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>#{st.rank}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--tx)', marginTop: 2 }}>
                    {st.points} pts · {st.won}W {st.drawn}D {st.lost}L
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--tx-3)', marginTop: 2 }}>
                    GF {st.goalsFor} · GA {st.goalsAgainst} · GD {st.goalDiff > 0 ? '+' : ''}{st.goalDiff}
                  </div>
                  {st.form && (
                    <div style={{ marginTop: '6px' }}>
                      {st.form.split('').map((r, i) => <FormDot key={i} result={r} />)}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {(form?.home?.length > 0 || form?.away?.length > 0) && (
        <div style={s.card}>
          <div style={s.title}>Recent Form (Last 5)</div>
          {['home', 'away'].map(side => {
            const teamName = side === 'home' ? fixture.homeTeamName : fixture.awayTeamName
            const results = form[side] ?? []
            if (!results.length) return null
            return (
              <div key={side} style={{ marginBottom: '0.75rem' }}>
                <div style={{ fontSize: '0.78rem', color: 'var(--tx-2)', marginBottom: 4 }}>{teamName}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {results.map((m, i) => (
                    <div key={i} style={{
                      background: 'var(--line-strong)', borderRadius: '6px', padding: '4px 8px',
                      fontSize: '0.72rem', display: 'flex', gap: '6px', alignItems: 'center'
                    }}>
                      <FormDot result={m.result} />
                      <span style={{ color: 'var(--tx-2)' }}>
                        {m.isHome ? `vs ${m.awayTeam}` : `@ ${m.homeTeam}`}
                      </span>
                      <span style={{ color: 'var(--tx)', fontWeight: 600 }}>
                        {m.isHome ? `${m.goalsHome}-${m.goalsAway}` : `${m.goalsAway}-${m.goalsHome}`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {headToHead?.length > 0 && (
        <div style={s.card}>
          <div style={s.title}>Head to Head</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {headToHead.slice(0, 8).map((m, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                fontSize: '0.8rem', padding: '6px 0',
                borderBottom: i < headToHead.length - 1 ? '1px solid var(--line-strong)' : 'none'
              }}>
                <span style={{ color: 'var(--tx-3)', fontSize: '0.7rem', minWidth: '80px' }}>
                  {new Date(m.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}
                </span>
                <span style={{ flex: 1, textAlign: 'right', color: m.winner === 'home' ? 'var(--pos)' : 'var(--tx)' }}>{m.homeTeam}</span>
                <span style={{
                  fontWeight: 700, fontSize: '0.9rem', minWidth: '40px', textAlign: 'center',
                  color: m.winner === 'draw' ? 'var(--warn)' : 'var(--tx)'
                }}>{m.goalsHome}-{m.goalsAway}</span>
                <span style={{ flex: 1, color: m.winner === 'away' ? 'var(--info)' : 'var(--tx)' }}>{m.awayTeam}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {(injuries?.home?.length > 0 || injuries?.away?.length > 0) && (
        <div style={s.card}>
          <div style={s.title}>Injuries & Availability</div>
          <div style={s.row}>
            {['home', 'away'].map(side => {
              const teamName = side === 'home' ? fixture.homeTeamName : fixture.awayTeamName
              const list = injuries[side] ?? []
              return (
                <div key={side} style={{ flex: 1, minWidth: '200px' }}>
                  <div style={{ fontSize: '0.78rem', color: 'var(--tx-2)', marginBottom: 6 }}>{teamName} ({list.length} out)</div>
                  {list.length === 0
                    ? <div style={{ fontSize: '0.75rem', color: 'var(--pos)' }}>No injuries reported</div>
                    : list.map((inj, i) => (
                      <div key={i} style={{ fontSize: '0.75rem', color: 'var(--neg)', marginBottom: 2 }}>
                        · {inj.player} <span style={{ color: 'var(--tx-3)' }}>({inj.reason || inj.type})</span>
                      </div>
                    ))
                  }
                </div>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}

function ClaudeAnalysis({ analysis, fixture }) {
  const verdictColor = analysis.verdict?.includes('Home') ? 'var(--pos)'
    : analysis.verdict?.includes('Away') ? 'var(--info)' : 'var(--warn)'
  const confColor = analysis.confidence === 'High' ? 'var(--pos)'
    : analysis.confidence === 'Low' ? 'var(--neg)' : 'var(--warn)'

  return (
    <div style={{ ...s.card, borderColor: 'var(--tx-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <div style={s.title}>Claude AI Analysis</div>
        <span style={{ fontSize: '0.65rem', color: 'var(--tx-3)', background: 'var(--line-strong)', padding: '2px 8px', borderRadius: '4px' }}>
          claude-opus-4-7
        </span>
      </div>

      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div style={s.stat}>
          <div style={s.statLabel}>Verdict</div>
          <div style={{ ...s.statValue, color: verdictColor }}>{analysis.verdict}</div>
        </div>
        <div style={s.stat}>
          <div style={s.statLabel}>Confidence</div>
          <div style={{ ...s.statValue, color: confColor }}>{analysis.confidence}</div>
        </div>
        {analysis.predictedScore && (
          <div style={s.stat}>
            <div style={s.statLabel}>Predicted Score</div>
            <div style={{ ...s.statValue, color: 'var(--tx)' }}>{analysis.predictedScore}</div>
          </div>
        )}
        {analysis.oddsAlignment && analysis.oddsAlignment !== 'N/A' && (
          <div style={s.stat}>
            <div style={s.statLabel}>Odds Alignment</div>
            <div style={{ fontSize: '0.9rem', fontWeight: 600, color: analysis.oddsAlignment === 'Agree' ? 'var(--pos)' : 'var(--warn)' }}>
              {analysis.oddsAlignment}
            </div>
          </div>
        )}
        {analysis.formEdge && (
          <div style={s.stat}>
            <div style={s.statLabel}>Form Edge</div>
            <div style={{ fontSize: '0.9rem', fontWeight: 600, color: analysis.formEdge === 'Home' ? 'var(--pos)' : analysis.formEdge === 'Away' ? 'var(--info)' : 'var(--warn)' }}>
              {analysis.formEdge}
            </div>
          </div>
        )}
        {analysis.injuryImpact && (
          <div style={s.stat}>
            <div style={s.statLabel}>Injury Impact</div>
            <div style={{ fontSize: '0.9rem', fontWeight: 600, color: analysis.injuryImpact === 'High' ? 'var(--neg)' : analysis.injuryImpact === 'None' ? 'var(--pos)' : 'var(--warn)' }}>
              {analysis.injuryImpact}
            </div>
          </div>
        )}
      </div>

      {analysis.oddsAlignmentNote && (
        <div style={{ background: 'var(--line-strong)', borderRadius: '8px', padding: '0.6rem 0.9rem', marginBottom: '0.75rem', fontSize: '0.8rem', color: 'var(--accent-2)' }}>
          {analysis.oddsAlignmentNote}
        </div>
      )}

      {/* Half-time prediction from Claude */}
      {analysis.htVerdict && (
        <div style={{ background: 'var(--line-strong)', borderRadius: '8px', padding: '0.75rem', marginBottom: '0.75rem' }}>
          <div style={s.title}>Half-Time Prediction (Claude)</div>
          <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap' }}>
            <div style={s.stat}>
              <div style={s.statLabel}>HT Verdict</div>
              <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--tx)' }}>{analysis.htVerdict}</div>
            </div>
            <div style={s.stat}>
              <div style={s.statLabel}>HT Confidence</div>
              <div style={{ fontSize: '0.9rem', fontWeight: 600, color: analysis.htConfidence === 'High' ? 'var(--pos)' : analysis.htConfidence === 'Low' ? 'var(--neg)' : 'var(--warn)' }}>
                {analysis.htConfidence}
              </div>
            </div>
            {analysis.htPredictedScore && (
              <div style={s.stat}>
                <div style={s.statLabel}>HT Score</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--tx)' }}>{analysis.htPredictedScore}</div>
              </div>
            )}
            {analysis.htOver05 != null && (
              <div style={s.stat}>
                <div style={s.statLabel}>HT Over 0.5</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 600, color: analysis.htOver05 ? 'var(--pos)' : 'var(--tx-2)' }}>
                  {analysis.htOver05 ? 'Yes' : 'No'}
                </div>
              </div>
            )}
            {analysis.htOver15 != null && (
              <div style={s.stat}>
                <div style={s.statLabel}>HT Over 1.5</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 600, color: analysis.htOver15 ? 'var(--pos)' : 'var(--tx-2)' }}>
                  {analysis.htOver15 ? 'Yes' : 'No'}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        <div style={{ flex: 1, background: 'var(--line-strong)', borderRadius: '8px', padding: '0.75rem', minWidth: '200px' }}>
          <div style={s.title}>Best Bet</div>
          <div style={{ color: 'var(--info)', fontSize: '0.875rem', fontWeight: 600 }}>{analysis.bestBet}</div>
        </div>
        {analysis.valueBet && (
          <div style={{ flex: 1, background: 'var(--line-strong)', borderRadius: '8px', padding: '0.75rem', minWidth: '200px' }}>
            <div style={s.title}>Value Bet</div>
            <div style={{ color: 'var(--pos)', fontSize: '0.875rem', fontWeight: 600 }}>{analysis.valueBet}</div>
          </div>
        )}
      </div>

      <div style={{ marginBottom: '0.75rem' }}>
        <div style={s.title}>Analysis</div>
        <p style={{ color: 'var(--tx)', fontSize: '0.875rem', lineHeight: 1.6, margin: 0 }}>{analysis.analysis}</p>
      </div>

      {analysis.keyFactors?.length > 0 && (
        <div style={{ marginBottom: '0.75rem' }}>
          <div style={s.title}>Key Factors</div>
          <ul style={{ margin: 0, paddingLeft: '1.2rem', color: 'var(--tx-2)', fontSize: '0.82rem', lineHeight: 1.8 }}>
            {analysis.keyFactors.map((f, i) => <li key={i}>{f}</li>)}
          </ul>
        </div>
      )}

      <div>
        <div style={s.title}>Risk Factor</div>
        <p style={{ color: 'var(--neg)', fontSize: '0.82rem', margin: 0 }}>{analysis.riskFactor || analysis.risk}</p>
      </div>
    </div>
  )
}

function NewsAnalysis({ analysis, fixture }) {
  const sentimentColor = analysis.mediaSentiment?.includes('Home') ? 'var(--pos)'
    : analysis.mediaSentiment?.includes('Away') ? 'var(--info)' : 'var(--warn)'
  const shiftColor = analysis.confidenceShift === 'Higher' ? 'var(--pos)'
    : analysis.confidenceShift === 'Lower' ? 'var(--neg)' : 'var(--tx-2)'

  return (
    <div style={{ ...s.card, borderColor: 'var(--accent-dim)', borderWidth: '1px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <div style={s.title}>Live News & Web Analysis</div>
        <span style={{ fontSize: '0.65rem', color: 'var(--tx-3)', background: 'var(--line-strong)', padding: '2px 8px', borderRadius: '4px' }}>
          Google · News · Web
        </span>
        {analysis.fetchedAt && (
          <span style={{ fontSize: '0.62rem', color: 'var(--tx-3)', marginLeft: 'auto' }}>
            {new Date(analysis.fetchedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div style={s.stat}>
          <div style={s.statLabel}>News Verdict</div>
          <div style={{ ...s.statValue, color: analysis.newsVerdict?.includes('Home') ? 'var(--pos)' : analysis.newsVerdict?.includes('Away') ? 'var(--info)' : 'var(--warn)' }}>
            {analysis.newsVerdict}
          </div>
        </div>
        <div style={s.stat}>
          <div style={s.statLabel}>Agrees with Model</div>
          <div style={{ ...s.statValue, color: analysis.agreesWithModel ? 'var(--pos)' : 'var(--neg)' }}>
            {analysis.agreesWithModel ? 'Yes' : 'No — Conflicts'}
          </div>
        </div>
        <div style={s.stat}>
          <div style={s.statLabel}>Confidence Shift</div>
          <div style={{ fontSize: '0.9rem', fontWeight: 600, color: shiftColor }}>{analysis.confidenceShift}</div>
        </div>
        <div style={s.stat}>
          <div style={s.statLabel}>Media Sentiment</div>
          <div style={{ fontSize: '0.9rem', fontWeight: 600, color: sentimentColor }}>{analysis.mediaSentiment}</div>
        </div>
      </div>

      <div style={{ marginBottom: '0.75rem' }}>
        <div style={s.title}>News Analysis</div>
        <p style={{ color: 'var(--tx)', fontSize: '0.875rem', lineHeight: 1.6, margin: 0 }}>{analysis.newsAnalysis}</p>
      </div>

      {analysis.breakingNews?.filter(Boolean).length > 0 && (
        <div style={{ marginBottom: '0.75rem' }}>
          <div style={s.title}>Breaking News</div>
          {analysis.breakingNews.map((item, i) => (
            <div key={i} style={{
              background: 'var(--line-strong)', borderLeft: '3px solid var(--warn)',
              padding: '6px 10px', marginBottom: '4px', borderRadius: '0 4px 4px 0',
              fontSize: '0.8rem', color: 'var(--tx)'
            }}>{item}</div>
          ))}
        </div>
      )}

      {analysis.keyHeadlines?.filter(Boolean).length > 0 && (
        <div style={{ marginBottom: '0.75rem' }}>
          <div style={s.title}>Key Headlines</div>
          {analysis.keyHeadlines.map((h, i) => (
            <div key={i} style={{ fontSize: '0.78rem', color: 'var(--tx-2)', marginBottom: '3px' }}>· {h}</div>
          ))}
        </div>
      )}

      {analysis.updatedBestBet && (
        <div style={{ background: 'var(--line-strong)', borderRadius: '8px', padding: '0.75rem' }}>
          <div style={s.title}>Updated Best Bet (News-informed)</div>
          <div style={{ color: 'var(--info)', fontSize: '0.875rem', fontWeight: 600 }}>{analysis.updatedBestBet}</div>
        </div>
      )}
    </div>
  )
}

function tabBtn(active) {
  return {
    background: active ? 'var(--accent-soft)' : 'var(--surface-2)',
    color: active ? 'var(--accent-2)' : 'var(--tx-3)',
    border: `1px solid ${active ? 'var(--accent-dim)' : 'var(--line)'}`,
    borderRadius: 'var(--r)', padding: '7px 14px',
    fontSize: 12.5, fontWeight: 600,
  }
}
