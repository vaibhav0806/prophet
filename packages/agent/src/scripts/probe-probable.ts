import "dotenv/config"
import { createHmac } from "node:crypto"
import { createWalletClient, defineChain, http } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { signClobAuth, buildHmacSignature } from "../clob/signing.js"

const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`)
const chain = defineChain({ id: 56, name: "BSC", nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 }, rpcUrls: { default: { http: [process.env.RPC_URL!] } } })
const walletClient = createWalletClient({ account, chain, transport: http(process.env.RPC_URL!) })

const API = "https://api.probable.markets"

async function main() {
  // 1. Auth
  const auth = await signClobAuth(walletClient, 56)
  const createRes = await fetch(`${API}/public/api/v1/auth/api-key/56`, {
    method: "POST",
    headers: { "Content-Type": "application/json", PROB_ADDRESS: auth.address, PROB_SIGNATURE: auth.signature, PROB_TIMESTAMP: auth.timestamp, PROB_NONCE: "0" },
  })
  const creds = await createRes.json() as Record<string, string>
  console.log("Auth OK, apiKey:", creds.apiKey)

  // 2. List open orders
  const openPath = `/public/api/v1/orders/56/open`
  const ts1 = Math.floor(Date.now() / 1000)
  const sig1 = buildHmacSignature(creds.secret, ts1, "GET", openPath)
  const openRes = await fetch(`${API}${openPath}`, {
    method: "GET",
    headers: {
      Prob_address: account.address,
      Prob_signature: sig1,
      Prob_timestamp: String(ts1),
      Prob_api_key: creds.apiKey,
      Prob_passphrase: creds.passphrase,
    },
  })
  const openOrders = await openRes.json() as Array<Record<string, unknown>>
  console.log(`\nOpen orders: ${openOrders.length}`)
  for (const o of openOrders) {
    console.log(`  orderId=${o.orderId ?? o.orderID ?? o.id}  tokenId=${o.tokenId}  side=${o.side}  price=${o.price}  size=${o.size}`)
  }

  if (openOrders.length === 0) {
    console.log("No open orders to cancel.")
    return
  }

  // 3. Cancel each open order
  for (const o of openOrders) {
    const orderId = String(o.orderId ?? o.orderID ?? o.id)
    const tokenId = String(o.tokenId ?? "")
    if (!tokenId) {
      console.log(`  Skipping ${orderId} — no tokenId`)
      continue
    }

    // Wait 1.1s for rate limit
    await new Promise(r => setTimeout(r, 1100))

    const cancelPath = `/public/api/v1/order/56/${orderId}`
    const cancelQuery = `?tokenId=${tokenId}`
    const ts = Math.floor(Date.now() / 1000)
    const sig = buildHmacSignature(creds.secret, ts, "DELETE", cancelPath + cancelQuery)

    console.log(`\nCancelling ${orderId} (tokenId=${tokenId.substring(0, 20)}...)`)
    console.log(`  DELETE ${cancelPath}${cancelQuery}`)

    const res = await fetch(`${API}${cancelPath}${cancelQuery}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Prob_address: account.address,
        Prob_signature: sig,
        Prob_timestamp: String(ts),
        Prob_api_key: creds.apiKey,
        Prob_passphrase: creds.passphrase,
      },
    })
    const data = await res.text()
    console.log(`  ${res.status} ${data.substring(0, 300)}`)
  }
}

main().catch(console.error)
