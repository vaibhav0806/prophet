'use client'

import { useReadContract } from 'wagmi'
import { ADDRESSES, VAULT_ABI } from '@/lib/contracts'

export function useVaultBalance() {
  return useReadContract({
    address: ADDRESSES.vault,
    abi: VAULT_ABI,
    functionName: 'vaultBalance',
  })
}

export function usePositionCount() {
  return useReadContract({
    address: ADDRESSES.vault,
    abi: VAULT_ABI,
    functionName: 'positionCount',
  })
}
