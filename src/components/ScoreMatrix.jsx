import React from 'react'

const s = {
  wrap: { overflowX: 'auto' },
  table: { borderCollapse: 'collapse', fontSize: '0.7rem', width: '100%' },
  th: { padding: '4px 8px', color: 'var(--tx-2)', textAlign: 'center', fontWeight: 600 },
  td: (intensity) => ({
    padding: '4px 8px',
    textAlign: 'center',
    background: `rgba(124, 108, 245, ${intensity})`,
    color: intensity > 0.5 ? '#fff' : 'var(--tx)',
    border: '1px solid var(--line)',
    borderRadius: '3px'
  })
}

export default function ScoreMatrix({ matrix }) {
  if (!matrix || matrix.length === 0) return null

  const size = matrix.length
  const max = Math.max(...matrix.flat())

  return (
    <div style={s.wrap}>
      <table style={s.table}>
        <thead>
          <tr>
            <th style={s.th}>H\A</th>
            {Array.from({ length: size }, (_, i) => (
              <th key={i} style={s.th}>{i}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row, i) => (
            <tr key={i}>
              <th style={s.th}>{i}</th>
              {row.map((val, j) => (
                <td key={j} style={s.td(max > 0 ? val / max : 0)}>
                  {(val * 100).toFixed(1)}%
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
