'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { formatUnits } from 'viem'
import { useWallet, useWithdraw, hasSession } from '@/hooks/use-platform-api'
import { formatUSD, formatNumber } from '@/lib/format'

// --- Helpers ---

function toHuman(raw: string, decimals = 18): number {
  try {
    return Number(formatUnits(BigInt(raw), decimals))
  } catch {
    return 0
  }
}

function isValidAddress(addr: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(addr)
}

// --- Skeletons ---

function SkeletonBalances() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {[0, 1].map((i) => (
        <div key={i} className="bg-gray-900/50 border border-gray-800/60 rounded-xl p-6">
          <div className="skeleton h-3 w-24 mb-3" />
          <div className="skeleton h-8 w-40" />
        </div>
      ))}
    </div>
  )
}

function SkeletonDeposit() {
  return (
    <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl p-6">
      <div className="skeleton h-4 w-32 mb-4" />
      <div className="skeleton h-12 w-full mb-3" />
      <div className="skeleton h-3 w-64" />
    </div>
  )
}

function SkeletonHistory() {
  return (
    <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-800/60">
        <div className="skeleton h-4 w-40" />
      </div>
      <div className="divide-y divide-gray-800/40">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="px-5 py-4 flex items-center gap-4">
            <div className="skeleton h-3 w-12" />
            <div className="skeleton h-3 w-24" />
            <div className="skeleton h-3 w-32 ml-auto" />
          </div>
        ))}
      </div>
    </div>
  )
}

// --- Components ---

function BalanceCards({ usdtRaw, bnbRaw }: { usdtRaw: string; bnbRaw: string }) {
  const usdt = toHuman(usdtRaw)
  const bnb = toHuman(bnbRaw)

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {/* USDT */}
      <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl p-6">
        <div className="text-[11px] text-gray-500 uppercase tracking-wide mb-2">USDT Balance</div>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-mono font-bold tabular-nums text-emerald-400">
            {formatUSD(usdt, 2)}
          </span>
        </div>
        <div className="text-xs text-gray-600 font-mono mt-1.5">
          {formatNumber(usdt, 6)} USDT
        </div>
      </div>

      {/* BNB */}
      <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl p-6">
        <div className="text-[11px] text-gray-500 uppercase tracking-wide mb-2">BNB Balance</div>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-mono font-bold tabular-nums text-amber-400">
            {formatNumber(bnb, 6)}
          </span>
          <span className="text-sm text-gray-500 font-medium">BNB</span>
        </div>
      </div>
    </div>
  )
}

function DepositCard({ address }: { address: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
    } catch {
      // Fallback for older browsers
      const el = document.createElement('textarea')
      el.value = address
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      setCopied(true)
    }
  }

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(t)
  }, [copied])

  return (
    <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl p-6">
      <h2 className="text-base font-semibold mb-4">Deposit</h2>

      <div className="bg-gray-800/40 border border-gray-700/50 rounded-lg p-4 flex items-center gap-3">
        <code className="flex-1 font-mono text-sm sm:text-base text-gray-200 break-all leading-relaxed select-all">
          {address}
        </code>
        <button
          onClick={handleCopy}
          className={`
            shrink-0 px-3.5 py-2 rounded-lg text-xs font-medium transition-all duration-200
            ${copied
              ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400'
              : 'bg-gray-700/60 border border-gray-600/40 text-gray-300 hover:bg-gray-600/60 hover:text-white'
            }
          `}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>

      <p className="text-xs text-gray-500 mt-3">
        Send USDT and BNB to this address on BSC (BEP-20)
      </p>
      <p className="text-[11px] text-amber-400/80 mt-1.5 flex items-center gap-1.5">
        <span className="inline-block w-1 h-1 rounded-full bg-amber-400/80" />
        Only send assets on the BNB Smart Chain network
      </p>
    </div>
  )
}

function WithdrawForm({ usdtRaw, bnbRaw }: { usdtRaw: string; bnbRaw: string }) {
  const withdraw = useWithdraw()
  const [token, setToken] = useState<'USDT' | 'BNB'>('USDT')
  const [amount, setAmount] = useState('')
  const [toAddress, setToAddress] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)

  const usdtBalance = toHuman(usdtRaw)
  const bnbBalance = toHuman(bnbRaw)
  const currentBalance = token === 'USDT' ? usdtBalance : bnbBalance
  const minWithdrawal = token === 'USDT' ? 1 : 0.001

  // Reset success state after delay
  useEffect(() => {
    if (!withdraw.isSuccess) return
    const t = setTimeout(() => {
      withdraw.reset()
      setAmount('')
      setToAddress('')
    }, 3000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withdraw.isSuccess])

  const handleMax = () => {
    setAmount(String(currentBalance))
    setValidationError(null)
  }

  const validate = (): string | null => {
    const num = Number(amount)
    if (!amount || isNaN(num) || num <= 0) return 'Enter a valid amount'
    if (num < minWithdrawal) return `Minimum withdrawal: ${minWithdrawal} ${token}`
    if (num > currentBalance) return 'Insufficient balance'
    if (!toAddress.trim()) return 'Enter a destination address'
    if (!isValidAddress(toAddress.trim())) return 'Invalid address (must be 0x... 42 characters)'
    return null
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const err = validate()
    if (err) {
      setValidationError(err)
      return
    }
    setValidationError(null)
    withdraw.mutate({ token, amount, toAddress: toAddress.trim() })
  }

  return (
    <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl p-6">
      <h2 className="text-base font-semibold mb-5">Withdraw</h2>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Token selector */}
        <div>
          <label className="block text-[11px] text-gray-500 uppercase tracking-wide mb-2">
            Token
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { setToken('USDT'); setAmount(''); setValidationError(null) }}
              className={`
                flex-1 py-2.5 rounded-lg text-sm font-medium transition-all duration-200
                ${token === 'USDT'
                  ? 'bg-emerald-500/10 border-2 border-emerald-500/30 text-emerald-400'
                  : 'bg-gray-800/40 border-2 border-gray-700/40 text-gray-500 hover:text-gray-300 hover:border-gray-600/60'
                }
              `}
            >
              USDT
            </button>
            <button
              type="button"
              onClick={() => { setToken('BNB'); setAmount(''); setValidationError(null) }}
              className={`
                flex-1 py-2.5 rounded-lg text-sm font-medium transition-all duration-200
                ${token === 'BNB'
                  ? 'bg-amber-500/10 border-2 border-amber-500/30 text-amber-400'
                  : 'bg-gray-800/40 border-2 border-gray-700/40 text-gray-500 hover:text-gray-300 hover:border-gray-600/60'
                }
              `}
            >
              BNB
            </button>
          </div>
        </div>

        {/* Amount */}
        <div>
          <label className="block text-[11px] text-gray-500 uppercase tracking-wide mb-2">
            Amount
            <span className="text-gray-600 ml-1 normal-case tracking-normal">
              (available: {formatNumber(currentBalance, token === 'USDT' ? 2 : 6)} {token})
            </span>
          </label>
          <div className="relative">
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => { setAmount(e.target.value); setValidationError(null) }}
              placeholder="0.00"
              className="w-full bg-gray-800/60 border border-gray-700/60 rounded-lg px-3.5 py-2.5 pr-16 text-sm font-mono tabular-nums focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-colors"
            />
            <button
              type="button"
              onClick={handleMax}
              className="absolute right-2 top-1/2 -translate-y-1/2 px-2.5 py-1 rounded text-[11px] font-medium uppercase tracking-wide bg-gray-700/60 text-gray-400 hover:text-white hover:bg-gray-600/60 transition-colors"
            >
              Max
            </button>
          </div>
        </div>

        {/* Destination address */}
        <div>
          <label className="block text-[11px] text-gray-500 uppercase tracking-wide mb-2">
            Destination Address
          </label>
          <input
            type="text"
            value={toAddress}
            onChange={(e) => { setToAddress(e.target.value); setValidationError(null) }}
            placeholder="0x..."
            className="w-full bg-gray-800/60 border border-gray-700/60 rounded-lg px-3.5 py-2.5 text-sm font-mono tabular-nums focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-colors"
          />
        </div>

        {/* Validation / mutation error */}
        {(validationError || withdraw.isError) && (
          <div className="text-sm text-red-400 bg-red-950/30 border border-red-900/50 rounded-lg px-3.5 py-2.5">
            {validationError || (withdraw.error as Error)?.message || 'Withdrawal failed'}
          </div>
        )}

        {/* Success */}
        {withdraw.isSuccess && (
          <div className="text-sm text-emerald-400 bg-emerald-950/30 border border-emerald-900/50 rounded-lg px-3.5 py-2.5">
            Withdrawal submitted successfully
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={withdraw.isPending}
          className={`
            w-full py-3 rounded-xl font-medium text-sm transition-all duration-200
            disabled:opacity-50 disabled:cursor-not-allowed
            bg-emerald-500/10 border-2 border-emerald-500/30 text-emerald-400
            hover:bg-emerald-500/20 hover:border-emerald-500/50
          `}
        >
          {withdraw.isPending ? (
            <span className="flex items-center justify-center gap-2">
              <span className="inline-block w-3.5 h-3.5 border-2 border-emerald-400/30 border-t-emerald-400 rounded-full spin-slow" />
              Processing...
            </span>
          ) : (
            `Withdraw ${token}`
          )}
        </button>
      </form>
    </div>
  )
}

function TransactionHistory({ deposits }: {
  deposits: Array<{ id: string; token: string; amount: string; confirmedAt: string }>
}) {
  const sorted = useMemo(
    () => [...deposits].sort((a, b) => new Date(b.confirmedAt).getTime() - new Date(a.confirmedAt).getTime()),
    [deposits],
  )

  if (sorted.length === 0) {
    return (
      <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl p-12 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-800/60 mb-4">
          <svg className="w-6 h-6 text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
        </div>
        <div className="text-gray-400 font-medium">No deposits yet</div>
        <div className="text-sm text-gray-600 mt-1">Deposits will appear here once confirmed on-chain</div>
      </div>
    )
  }

  return (
    <div className="bg-gray-900/50 border border-gray-800/80 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-800/60">
        <h2 className="text-base font-semibold">Deposit History</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800/80 text-[11px] uppercase tracking-wider text-gray-500">
              <th className="px-5 py-3 text-left font-medium">Token</th>
              <th className="px-5 py-3 text-right font-medium">Amount</th>
              <th className="px-5 py-3 text-right font-medium">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/40">
            {sorted.map((dep, i) => {
              const decimals = 18
              const amount = toHuman(dep.amount, decimals)
              const date = new Date(dep.confirmedAt)
              const dateStr = date.toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })

              return (
                <tr
                  key={dep.id}
                  className={`transition-colors hover:bg-gray-800/30 ${i % 2 === 0 ? '' : 'bg-gray-900/30'}`}
                >
                  <td className="px-5 py-3.5">
                    <span className={`
                      inline-block px-2 py-0.5 rounded text-xs font-medium border
                      ${dep.token === 'USDT' || dep.token === 'usdt'
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                        : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                      }
                    `}>
                      {dep.token.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-right font-mono tabular-nums text-gray-200">
                    {formatNumber(amount, dep.token.toUpperCase() === 'BNB' ? 6 : 2)}
                  </td>
                  <td className="px-5 py-3.5 text-right text-gray-400 text-xs">
                    {dateStr}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// --- Page ---

export default function WalletPage() {
  const router = useRouter()
  const [authed, setAuthed] = useState<boolean | null>(null)

  useEffect(() => {
    if (!hasSession()) {
      router.replace('/login')
    } else {
      setAuthed(true)
    }
  }, [router])

  const { data: wallet, isLoading, error } = useWallet()

  // Don't render until auth check completes
  if (authed === null) return null

  return (
    <div className="p-6 lg:p-8 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Wallet</h1>
        <p className="text-sm text-gray-500 mt-1">Balances, deposits, and withdrawals</p>
      </div>

      {isLoading && (
        <div className="space-y-6">
          <SkeletonBalances />
          <SkeletonDeposit />
          <SkeletonHistory />
        </div>
      )}

      {error && (
        <div className="text-red-400 bg-red-950/30 border border-red-900/50 rounded-xl p-5">
          <div className="font-medium mb-1">Failed to load wallet</div>
          <div className="text-sm text-red-400/70">{(error as Error).message}</div>
        </div>
      )}

      {wallet && (
        <div className="space-y-6">
          <BalanceCards usdtRaw={wallet.usdtBalance} bnbRaw={wallet.bnbBalance} />
          <DepositCard address={wallet.address} />
          <WithdrawForm usdtRaw={wallet.usdtBalance} bnbRaw={wallet.bnbBalance} />
          <TransactionHistory deposits={wallet.deposits} />
        </div>
      )}
    </div>
  )
}
