'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useConnect, useAccount, type Connector } from 'wagmi'
import { useAuth } from '@/hooks/use-auth'
import { useProfile, hasSession } from '@/hooks/use-platform-api'

const CONNECTOR_META: Record<string, { label: string; icon: string }> = {
  metaMask: { label: 'MetaMask', icon: '🦊' },
  injected: { label: 'Browser Wallet', icon: '◈' },
  walletConnect: { label: 'WalletConnect', icon: '◎' },
}

function getConnectorInfo(connector: Connector) {
  const meta = CONNECTOR_META[connector.id]
  if (meta) return meta
  return { label: connector.name || connector.id, icon: '◈' }
}

export default function LoginPage() {
  const router = useRouter()
  const { connectors, connect, isPending: isConnecting, error: connectError } = useConnect()
  const { isConnected, address } = useAccount()
  const { signIn, isLoading: isSigningIn } = useAuth()
  const { data: profile, isLoading: isProfileLoading } = useProfile()

  const [signInError, setSignInError] = useState<string | null>(null)
  const [hasSignedIn, setHasSignedIn] = useState(false)

  // If already authenticated, redirect immediately
  useEffect(() => {
    if (hasSession() && profile && !isProfileLoading) {
      router.replace(profile.config ? '/dashboard' : '/onboarding')
    }
  }, [profile, isProfileLoading, router])

  // After sign-in, wait for profile to load to determine route
  useEffect(() => {
    if (!hasSignedIn) return
    if (isProfileLoading) return
    if (profile) {
      router.replace(profile.config ? '/dashboard' : '/onboarding')
    }
  }, [hasSignedIn, profile, isProfileLoading, router])

  const handleSignIn = async () => {
    setSignInError(null)
    try {
      await signIn()
      setHasSignedIn(true)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Signature rejected'
      if (message.toLowerCase().includes('user rejected') || message.toLowerCase().includes('denied')) {
        setSignInError('Signature request was rejected. Please try again.')
      } else {
        setSignInError(message)
      }
    }
  }

  const error = signInError || (connectError ? connectError.message : null)

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden">
      {/* Background mesh */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden>
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage: `
              radial-gradient(ellipse 80% 60% at 20% 40%, rgba(16,185,129,0.08) 0%, transparent 70%),
              radial-gradient(ellipse 60% 80% at 80% 60%, rgba(16,185,129,0.05) 0%, transparent 70%),
              radial-gradient(ellipse 50% 50% at 50% 0%, rgba(16,185,129,0.04) 0%, transparent 60%)
            `,
          }}
        />
        {/* Grid pattern */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `
              linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)
            `,
            backgroundSize: '64px 64px',
          }}
        />
        {/* Diagonal accent lines */}
        <svg className="absolute inset-0 w-full h-full opacity-[0.02]" xmlns="http://www.w3.org/2000/svg">
          <line x1="0" y1="100%" x2="100%" y2="0" stroke="white" strokeWidth="1" />
          <line x1="20%" y1="100%" x2="100%" y2="20%" stroke="white" strokeWidth="0.5" />
          <line x1="0" y1="80%" x2="80%" y2="0" stroke="white" strokeWidth="0.5" />
        </svg>
      </div>

      {/* Content */}
      <div className="relative z-10 w-full max-w-sm px-6">
        {/* Branding */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 mb-3">
            <h1 className="text-4xl font-bold tracking-tight">
              <span className="text-emerald-400">Pro</span>
              <span className="text-white">phit</span>
            </h1>
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 pulse-dot" />
          </div>
          <p className="text-sm text-gray-500 tracking-wide">Prediction Market Arbitrage</p>
        </div>

        {/* Card */}
        <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl p-6">
          {!isConnected ? (
            <>
              <div className="text-[11px] text-gray-500 uppercase tracking-wide mb-4">
                Connect Wallet
              </div>
              <div className="space-y-2.5">
                {connectors.map((connector) => {
                  const info = getConnectorInfo(connector)
                  return (
                    <button
                      key={connector.uid}
                      onClick={() => connect({ connector })}
                      disabled={isConnecting}
                      className="
                        w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium
                        bg-gray-800/60 border border-gray-700/60
                        text-gray-300 hover:text-white hover:bg-gray-800 hover:border-gray-600/80
                        transition-all duration-150
                        disabled:opacity-50 disabled:cursor-not-allowed
                      "
                    >
                      <span className="text-base">{info.icon}</span>
                      <span>{info.label}</span>
                      {isConnecting && (
                        <span className="ml-auto">
                          <span className="inline-block w-4 h-4 border-2 border-gray-600 border-t-emerald-400 rounded-full spin-slow" />
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </>
          ) : (
            <>
              <div className="text-[11px] text-gray-500 uppercase tracking-wide mb-4">
                Wallet Connected
              </div>

              {/* Connected address */}
              <div className="flex items-center gap-2.5 mb-5 px-3.5 py-2.5 bg-gray-800/60 border border-gray-700/60 rounded-lg">
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 status-pulse" />
                <span className="text-sm font-mono text-gray-300 tabular-nums">
                  {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : ''}
                </span>
              </div>

              {/* Sign in button */}
              <button
                onClick={handleSignIn}
                disabled={isSigningIn || (hasSignedIn && isProfileLoading)}
                className="
                  w-full flex items-center justify-center gap-2.5 px-6 py-3 rounded-xl font-medium text-sm
                  bg-emerald-500/10 border-2 border-emerald-500/30 text-emerald-400
                  hover:bg-emerald-500/20 hover:border-emerald-500/50
                  transition-all duration-200
                  disabled:opacity-60 disabled:cursor-not-allowed
                "
              >
                {isSigningIn ? (
                  <>
                    <span className="inline-block w-4 h-4 border-2 border-emerald-900 border-t-emerald-400 rounded-full spin-slow" />
                    Signing...
                  </>
                ) : hasSignedIn && isProfileLoading ? (
                  <>
                    <span className="inline-block w-4 h-4 border-2 border-emerald-900 border-t-emerald-400 rounded-full spin-slow" />
                    Loading...
                  </>
                ) : (
                  'Sign In'
                )}
              </button>
            </>
          )}

          {/* Error */}
          {error && (
            <div className="mt-4 text-red-400 bg-red-950/30 border border-red-900/50 rounded-xl p-4 text-sm">
              {error}
            </div>
          )}
        </div>

        {/* Tagline */}
        <p className="text-center text-[11px] text-gray-600 mt-6 tracking-wide">
          Automated prediction market arbitrage
        </p>
      </div>
    </div>
  )
}
