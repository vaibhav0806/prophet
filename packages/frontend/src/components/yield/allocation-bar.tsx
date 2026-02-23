'use client'

interface AllocationSegment {
  protocol: string
  amount: number
  color: string
}

const PROTOCOL_COLORS: Record<string, string> = {
  default: 'bg-gray-600',
}

const PROTOCOL_COLOR_LIST = [
  'bg-emerald-500',
  'bg-blue-500',
  'bg-amber-500',
  'bg-purple-500',
  'bg-rose-500',
  'bg-cyan-500',
]

function getProtocolColor(protocol: string, index: number): string {
  return PROTOCOL_COLORS[protocol] || PROTOCOL_COLOR_LIST[index % PROTOCOL_COLOR_LIST.length]
}

interface AllocationBarProps {
  segments: AllocationSegment[]
  total: number
}

export function AllocationBar({ segments, total }: AllocationBarProps) {
  if (total === 0 || segments.length === 0) {
    return (
      <div className="w-full h-6 rounded bg-gray-800" />
    )
  }

  return (
    <div>
      <div className="w-full h-6 rounded overflow-hidden flex">
        {segments.map((seg, i) => {
          const pct = (seg.amount / total) * 100
          if (pct <= 0) return null
          return (
            <div
              key={seg.protocol}
              className={`${getProtocolColor(seg.protocol, i)} h-full`}
              style={{ width: `${pct}%` }}
              title={`${seg.protocol}: ${seg.amount.toFixed(2)} USDT (${pct.toFixed(1)}%)`}
            />
          )
        })}
      </div>
      <div className="flex flex-wrap gap-3 mt-3">
        {segments.map((seg, i) => (
          <div key={seg.protocol} className="flex items-center gap-1.5 text-xs text-gray-400">
            <span className={`inline-block w-3 h-3 rounded ${getProtocolColor(seg.protocol, i)}`} />
            <span>{seg.protocol}</span>
            <span className="font-mono">{seg.amount.toFixed(2)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
