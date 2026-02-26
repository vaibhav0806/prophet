# Prophit

Prediction market arbitrage agent trading across Predict and Probable CLOBs.

## Stack

- pnpm monorepo: `packages/agent`, `packages/platform`, `packages/frontend`, `packages/shared`
- Frontend: Next.js (`:3000`)
- Platform API: Express (`:40000`)
- Auth/wallet custody: Privy (embedded wallets, delegated signing)

## Architecture

- Predict leg: EOA wallet
- Probable leg: Safe proxy
- Sequential execution: Predict FOK first, verify via balance diff, then Probable

## Build & Test

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
```

## Rules

- Never commit `.env` files or secrets
- Read code before editing — match existing patterns
- Prefer editing existing files over creating new ones
