"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const API_BASE = process.env.NEXT_PUBLIC_PLATFORM_URL || "http://localhost:4000";

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("prophit_token");
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `API error: ${res.status}`);
  }
  return res.json();
}

// --- Auth ---
export function useRequestNonce() {
  return useMutation({
    mutationFn: () => apiFetch<{ nonce: string }>("/api/auth/nonce", { method: "POST" }),
  });
}

export function useVerifySignature() {
  return useMutation({
    mutationFn: (params: { message: string; signature: string }) =>
      apiFetch<{ token: string; userId: string; address: string }>("/api/auth/verify", {
        method: "POST",
        body: JSON.stringify(params),
      }),
  });
}

// --- User Profile ---
export function useProfile() {
  return useQuery({
    queryKey: ["profile"],
    queryFn: () => apiFetch<{
      id: string;
      walletAddress: string;
      createdAt: string;
      config: {
        minTradeSize: string;
        maxTradeSize: string;
        minSpreadBps: number;
        maxTotalTrades: number | null;
        tradingDurationMs: string | null;
        dailyLossLimit: string;
        maxResolutionDays: number | null;
        agentStatus: string;
      } | null;
    }>("/api/me"),
    enabled: !!getToken(),
    refetchInterval: 10000,
  });
}

export function useUpdateConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: Record<string, unknown>) =>
      apiFetch("/api/me/config", { method: "PATCH", body: JSON.stringify(config) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["profile"] }),
  });
}

// --- Wallet ---
export function useWallet() {
  return useQuery({
    queryKey: ["wallet"],
    queryFn: () => apiFetch<{
      address: string;
      usdtBalance: string;
      bnbBalance: string;
      deposits: Array<{ id: string; token: string; amount: string; confirmedAt: string }>;
    }>("/api/wallet"),
    enabled: !!getToken(),
    refetchInterval: 15000,
  });
}

export function useWithdraw() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { token: string; amount: string; toAddress: string }) =>
      apiFetch<{ id: string; status: string; txHash?: string }>("/api/wallet/withdraw", {
        method: "POST",
        body: JSON.stringify(params),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wallet"] }),
  });
}

// --- Agent ---
export function useAgentStatus() {
  return useQuery({
    queryKey: ["agent-status"],
    queryFn: () => apiFetch<{
      running: boolean;
      tradesExecuted: number;
      lastScan: number;
      uptime: number;
      config?: Record<string, unknown>;
    }>("/api/agent/status"),
    enabled: !!getToken(),
    refetchInterval: 3000,
  });
}

export function useStartAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch("/api/agent/start", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agent-status"] }),
  });
}

export function useStopAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch("/api/agent/stop", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agent-status"] }),
  });
}

// --- Markets (public, no auth) ---
export function useMarkets() {
  return useQuery({
    queryKey: ["markets"],
    queryFn: () => apiFetch<{
      quoteCount: number;
      updatedAt: number;
      opportunities: Array<{
        marketId: string;
        protocolA: string;
        protocolB: string;
        spreadBps: number;
        grossSpreadBps: number;
        estProfit: string;
        totalCost: string;
        liquidityA: string;
        liquidityB: string;
      }>;
    }>("/api/markets"),
    refetchInterval: 10000,
  });
}

// --- Trades ---
export function useTrades(limit = 50, offset = 0) {
  return useQuery({
    queryKey: ["trades", limit, offset],
    queryFn: () => apiFetch<{
      trades: Array<{
        id: string;
        marketId: string;
        status: string;
        legA: unknown;
        legB: unknown;
        totalCost: number;
        expectedPayout: number;
        spreadBps: number;
        pnl: number | null;
        openedAt: string;
        closedAt: string | null;
      }>;
      limit: number;
      offset: number;
    }>(`/api/trades?limit=${limit}&offset=${offset}`),
    enabled: !!getToken(),
  });
}

// --- Session helpers ---
export function setSession(token: string) {
  localStorage.setItem("prophit_token", token);
}

export function clearSession() {
  localStorage.removeItem("prophit_token");
}

export function hasSession(): boolean {
  return !!getToken();
}
