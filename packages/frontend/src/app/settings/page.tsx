'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useProfile, useUpdateConfig, hasSession } from '@/hooks/use-platform-api'

const DURATION_OPTIONS = [
  { label: '1 hour', value: '3600000' },
  { label: '6 hours', value: '21600000' },
  { label: '12 hours', value: '43200000' },
  { label: '24 hours', value: '86400000' },
  { label: 'Unlimited', value: '' },
] as const

const RESOLUTION_OPTIONS = [
  { label: '7 days', value: 7 },
  { label: '14 days', value: 14 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: 'Any', value: null },
] as const

function bigintToUsdt(raw: string): string {
  try {
    const num = parseFloat(raw) / 1e18
    if (isNaN(num) || num === 0) return ''
    return String(num)
  } catch {
    return ''
  }
}

function usdtToBigint(usdt: string): string {
  try {
    const num = parseFloat(usdt)
    if (isNaN(num) || num <= 0) return '0'
    return String(Math.round(num * 1e18))
  } catch {
    return '0'
  }
}

function SkeletonSettings() {
  return (
    <div className="space-y-6">
      <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl p-6">
        <div className="skeleton h-5 w-40 mb-6" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i}>
              <div className="skeleton h-3 w-32 mb-2.5" />
              <div className="skeleton h-10 w-full rounded-lg" />
            </div>
          ))}
        </div>
      </div>
      <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl p-6">
        <div className="skeleton h-5 w-36 mb-6" />
        <div className="skeleton h-10 w-full rounded-lg mb-4" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <div className="skeleton h-3 w-28 mb-2.5" />
            <div className="skeleton h-10 w-full rounded-lg" />
          </div>
          <div>
            <div className="skeleton h-3 w-28 mb-2.5" />
            <div className="skeleton h-10 w-full rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  )
}

export default function SettingsPage() {
  const router = useRouter()
  const { data: profile, isLoading } = useProfile()
  const updateConfig = useUpdateConfig()

  const [minTradeSize, setMinTradeSize] = useState('')
  const [maxTradeSize, setMaxTradeSize] = useState('')
  const [minSpreadPct, setMinSpreadPct] = useState(1)
  const [maxTotalTrades, setMaxTotalTrades] = useState('')
  const [unlimitedTrades, setUnlimitedTrades] = useState(true)
  const [tradingDuration, setTradingDuration] = useState('')
  const [dailyLossLimit, setDailyLossLimit] = useState('')
  const [maxResolutionDays, setMaxResolutionDays] = useState<number | null>(null)

  const [saved, setSaved] = useState(false)
  const [dirty, setDirty] = useState(false)

  // Auth guard
  useEffect(() => {
    if (typeof window !== 'undefined' && !hasSession()) {
      router.replace('/login')
    }
  }, [router])

  // Populate form from profile
  const populateForm = useCallback(() => {
    const config = profile?.config
    if (!config) return

    setMinTradeSize(bigintToUsdt(config.minTradeSize))
    setMaxTradeSize(bigintToUsdt(config.maxTradeSize))
    setMinSpreadPct(config.minSpreadBps / 100)
    setUnlimitedTrades(config.maxTotalTrades === null)
    setMaxTotalTrades(config.maxTotalTrades !== null ? String(config.maxTotalTrades) : '')
    setTradingDuration(config.tradingDurationMs ?? '')
    setDailyLossLimit(bigintToUsdt(config.dailyLossLimit))
    setMaxResolutionDays(config.maxResolutionDays)
    setDirty(false)
  }, [profile?.config])

  useEffect(() => {
    populateForm()
  }, [populateForm])

  const markDirty = () => {
    setDirty(true)
    setSaved(false)
  }

  const handleSave = () => {
    const minTrade = parseFloat(minTradeSize)
    const maxTrade = parseFloat(maxTradeSize)
    const lossLimit = parseFloat(dailyLossLimit)

    if (isNaN(minTrade) || minTrade <= 0) return
    if (isNaN(maxTrade) || maxTrade <= 0) return
    if (maxTrade < minTrade) return
    if (isNaN(lossLimit) || lossLimit <= 0) return

    const payload: Record<string, unknown> = {
      minTradeSize: usdtToBigint(minTradeSize),
      maxTradeSize: usdtToBigint(maxTradeSize),
      minSpreadBps: Math.round(minSpreadPct * 100),
      maxTotalTrades: unlimitedTrades ? null : Number(maxTotalTrades) || null,
      tradingDurationMs: tradingDuration || null,
      dailyLossLimit: usdtToBigint(dailyLossLimit),
      maxResolutionDays: maxResolutionDays,
    }

    updateConfig.mutate(payload, {
      onSuccess: () => {
        setSaved(true)
        setDirty(false)
        setTimeout(() => setSaved(false), 3000)
      },
    })
  }

  if (typeof window !== 'undefined' && !hasSession()) return null

  return (
    <div className="p-6 lg:p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Configure trading parameters for the arbitrage agent</p>
      </div>

      {isLoading && <SkeletonSettings />}

      {profile?.config && (
        <div className="space-y-6">
          {/* Trade Sizing */}
          <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl p-6">
            <h2 className="text-base font-semibold mb-5">Trade Sizing</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-[11px] text-gray-500 uppercase tracking-wide mb-2">
                  Minimum Trade Size
                  <span className="text-gray-600 ml-1 normal-case tracking-normal">(USDT)</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                  <input
                    type="number"
                    value={minTradeSize}
                    onChange={(e) => { setMinTradeSize(e.target.value); markDirty() }}
                    min={0}
                    step={0.01}
                    placeholder="1.00"
                    className="w-full bg-gray-800/60 border border-gray-700/60 rounded-lg pl-7 pr-3.5 py-2.5 text-sm font-mono tabular-nums focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-colors"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[11px] text-gray-500 uppercase tracking-wide mb-2">
                  Maximum Trade Size
                  <span className="text-gray-600 ml-1 normal-case tracking-normal">(USDT)</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                  <input
                    type="number"
                    value={maxTradeSize}
                    onChange={(e) => { setMaxTradeSize(e.target.value); markDirty() }}
                    min={0}
                    step={0.01}
                    placeholder="100.00"
                    className="w-full bg-gray-800/60 border border-gray-700/60 rounded-lg pl-7 pr-3.5 py-2.5 text-sm font-mono tabular-nums focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-colors"
                  />
                </div>
              </div>
              <div className="md:col-span-2">
                <label className="block text-[11px] text-gray-500 uppercase tracking-wide mb-2">
                  Daily Loss Limit
                  <span className="text-gray-600 ml-1 normal-case tracking-normal">(USDT)</span>
                </label>
                <div className="relative max-w-xs">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                  <input
                    type="number"
                    value={dailyLossLimit}
                    onChange={(e) => { setDailyLossLimit(e.target.value); markDirty() }}
                    min={0}
                    step={0.01}
                    placeholder="50.00"
                    className="w-full bg-gray-800/60 border border-gray-700/60 rounded-lg pl-7 pr-3.5 py-2.5 text-sm font-mono tabular-nums focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-colors"
                  />
                </div>
                <p className="text-[11px] text-gray-600 mt-1.5">Maximum amount the agent can lose in a single day before pausing</p>
              </div>
            </div>
          </div>

          {/* Profit & Risk */}
          <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl p-6">
            <h2 className="text-base font-semibold mb-5">Profit & Risk</h2>

            {/* Spread slider */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <label className="text-[11px] text-gray-500 uppercase tracking-wide">
                  Minimum Profit Margin
                </label>
                <span className="text-sm font-mono tabular-nums text-emerald-400">
                  {minSpreadPct.toFixed(1)}%
                </span>
              </div>
              <input
                type="range"
                min={0.5}
                max={10}
                step={0.1}
                value={minSpreadPct}
                onChange={(e) => { setMinSpreadPct(parseFloat(e.target.value)); markDirty() }}
                className="w-full h-1.5 bg-gray-800 rounded-full appearance-none cursor-pointer accent-emerald-500 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-emerald-400 [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-emerald-600 [&::-webkit-slider-thumb]:cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-gray-600 mt-1">
                <span>0.5%</span>
                <span>10%</span>
              </div>
            </div>

            {/* Max total trades */}
            <div>
              <label className="block text-[11px] text-gray-500 uppercase tracking-wide mb-2">
                Maximum Total Trades
              </label>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={unlimitedTrades}
                    onClick={() => { setUnlimitedTrades(!unlimitedTrades); markDirty() }}
                    className={`
                      relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200
                      ${unlimitedTrades ? 'bg-emerald-500/60' : 'bg-gray-700'}
                    `}
                  >
                    <span
                      className={`
                        pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200
                        ${unlimitedTrades ? 'translate-x-4' : 'translate-x-0'}
                      `}
                    />
                  </button>
                  <span className="text-sm text-gray-400">Unlimited</span>
                </label>
                {!unlimitedTrades && (
                  <input
                    type="number"
                    value={maxTotalTrades}
                    onChange={(e) => { setMaxTotalTrades(e.target.value); markDirty() }}
                    min={1}
                    placeholder="100"
                    className="w-32 bg-gray-800/60 border border-gray-700/60 rounded-lg px-3.5 py-2.5 text-sm font-mono tabular-nums focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-colors"
                  />
                )}
              </div>
            </div>
          </div>

          {/* Timing */}
          <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl p-6">
            <h2 className="text-base font-semibold mb-5">Timing</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-[11px] text-gray-500 uppercase tracking-wide mb-2">
                  Trading Duration
                </label>
                <select
                  value={tradingDuration}
                  onChange={(e) => { setTradingDuration(e.target.value); markDirty() }}
                  className="w-full bg-gray-800/60 border border-gray-700/60 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-colors appearance-none cursor-pointer"
                >
                  {DURATION_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <p className="text-[11px] text-gray-600 mt-1.5">How long the agent trades per session</p>
              </div>
              <div>
                <label className="block text-[11px] text-gray-500 uppercase tracking-wide mb-2">
                  Market Resolution Window
                </label>
                <select
                  value={maxResolutionDays === null ? '' : String(maxResolutionDays)}
                  onChange={(e) => { setMaxResolutionDays(e.target.value === '' ? null : Number(e.target.value)); markDirty() }}
                  className="w-full bg-gray-800/60 border border-gray-700/60 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-colors appearance-none cursor-pointer"
                >
                  {RESOLUTION_OPTIONS.map((opt) => (
                    <option key={String(opt.value)} value={opt.value === null ? '' : String(opt.value)}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-gray-600 mt-1.5">Only trade markets that resolve within this window</p>
              </div>
            </div>
          </div>

          {/* Save */}
          <div className="flex items-center gap-4">
            <button
              onClick={handleSave}
              disabled={updateConfig.isPending || !dirty}
              className={`
                px-6 py-3 rounded-xl font-medium text-sm transition-all duration-200
                disabled:opacity-40 disabled:cursor-not-allowed
                ${saved
                  ? 'bg-emerald-500/20 border-2 border-emerald-500/40 text-emerald-400'
                  : 'bg-emerald-500/10 border-2 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 hover:border-emerald-500/50'
                }
              `}
            >
              {updateConfig.isPending ? (
                <span className="flex items-center gap-2">
                  <span className="inline-block w-4 h-4 border-2 border-emerald-900 border-t-emerald-400 rounded-full spin-slow" />
                  Saving...
                </span>
              ) : saved ? (
                'Settings saved'
              ) : (
                'Save Settings'
              )}
            </button>
            {dirty && !saved && (
              <span className="text-[11px] text-amber-400/70">Unsaved changes</span>
            )}
          </div>
        </div>
      )}

      {!isLoading && !profile?.config && (
        <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl p-12 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-800/60 mb-4">
            <svg className="w-6 h-6 text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
            </svg>
          </div>
          <div className="text-gray-400 font-medium">No configuration found</div>
          <div className="text-sm text-gray-600 mt-1">Complete onboarding to set up your trading parameters</div>
        </div>
      )}
    </div>
  )
}
