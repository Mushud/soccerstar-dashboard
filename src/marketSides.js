// Which side of a match a selection backs, and how it is coloured.
//
// A Double Chance 1X and a straight Home Win are the same directional call — 1X just also
// collects the draw. The bet builder overwhelmingly picks 1X/X2 over straight wins (the
// low-risk score is p^2.5, so it takes the higher probability), so a card or an accuracy
// panel read top to bottom is mostly Double Chance rows whose label says nothing about WHICH
// team is favoured. Colouring by side makes that scannable.
//
// This lives in one module because it is used by both the bet builder card and the backtest
// accuracy badges. Two copies of a colour map drift, and the codebase already has a scar from
// exactly that (see the note at the top of backend services/marketScoring.js, where duplicated
// gate thresholds left an accuracy panel reporting on a different gate from the one it named).

export const SIDE = { HOME: 'home', AWAY: 'away', DRAW: 'draw', GOALS: 'goals' }

export const SIDE_STYLE = {
  [SIDE.HOME]:  { color: 'var(--info)',     tag: '1', title: 'Backs the home side' },
  [SIDE.AWAY]:  { color: 'var(--warn)',     tag: '2', title: 'Backs the away side' },
  [SIDE.DRAW]:  { color: 'var(--accent-2)', tag: 'X', title: 'Backs the draw' },
  [SIDE.GOALS]: { color: '#4fd1c5',         tag: null, title: 'Goals market — neither side' },
}

const GOAL_SELECTIONS = ['Over 1.5', 'Over 2.5', 'BTTS']

export function selectionSide(market, selection) {
  const m = market || '', s = selection || ''
  if (GOAL_SELECTIONS.includes(s) || /Over|Under|BTTS|Both Teams/i.test(`${m} ${s}`)) return SIDE.GOALS
  // Test the Double Chance codes before the plain words: "X2 (Away or Draw)" contains both
  // "Away" and "Draw", so a naive word match would classify half the card as draw bets.
  if (/^1X\b/.test(s) || /Home or Draw/i.test(s)) return SIDE.HOME
  if (/^X2\b/.test(s) || /Away or Draw/i.test(s)) return SIDE.AWAY
  if (/^12\b|Home or Away/i.test(s)) return null   // backs both sides — no single side to colour
  if (/Home/i.test(s)) return SIDE.HOME
  if (/Away/i.test(s)) return SIDE.AWAY
  if (/Draw/i.test(s)) return SIDE.DRAW
  return null
}

// Same call expressed the other way round: for a Double Chance, the straight win it contains;
// for a straight win, the Double Chance that covers it. Null when `blend` is missing — this is
// an annotation, never a substitute for the pick itself.
export function pairedOutcome(market, selection, blend) {
  if (!blend || blend.home == null) return null
  const s = selection || ''
  const pct = v => `${Math.round(v * 100)}%`
  const isDC = /Double Chance/i.test(market || '') || /^1X\b|^X2\b/.test(s)

  if (isDC) {
    const side = selectionSide(market, s)
    if (side === SIDE.HOME) return { label: 'straight 1', detail: `${pct(blend.home)} win · ${pct(blend.draw)} draw` }
    if (side === SIDE.AWAY) return { label: 'straight 2', detail: `${pct(blend.away)} win · ${pct(blend.draw)} draw` }
    return null
  }
  if (/Home Win/i.test(s)) return { label: 'as 1X', detail: `${pct(blend.home + blend.draw)} with the draw` }
  if (/Away Win/i.test(s)) return { label: 'as X2', detail: `${pct(blend.away + blend.draw)} with the draw` }
  return null
}
