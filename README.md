# @code-402/langchain

code402's x402 pay-per-call verification tools as LangChain `DynamicStructuredTool`s —
IBAN, LEI, VAT, GSTIN, IFSC, SWIFT/BIC, sanctions screening, and onboarding packs.
Non-custodial: your agent's wallet signs an EIP-3009 transfer directly to the seller
named in the 402 challenge (USDC on Base). The live 402 challenge is the only price
ever signed; a hard client-side spend cap is enforced before any signature.

## Quickstart

```ts
import { privateKeyToAccount } from "viem/accounts";
import { getCode402Tools } from "@code-402/langchain";

const tools = await getCode402Tools({
  baseUrl: "https://hcrb.in",
  account: privateKeyToAccount(process.env.PAYER_PRIVATE_KEY as `0x${string}`),
  maxAmountMinor: "5000", // hard cap: 0.005 USDC per call
});

const iban = tools.find((t) => t.name === "code402_iban_check")!;
console.log(await iban.invoke({ iban: "GB82WEST12345698765432" }));
```

The tool list is read live from the seller's `/.well-known/mcp.json` — nothing is
hardcoded. A free `code402_check_price` tool (x402 price index lookup) is included.

## Spend cap semantics

- `maxAmountMinor` is an integer string in USDC minor units (6 decimals): `"5000"` = 0.005 USDC. Default `"0"` = never pay.
- The cap is enforced **before** signing, per call. A per-call override can only tighten it, never loosen it.
- Base mainnet (chain 8453) is refused unless `allowMainnet: true`.

## Custody

None. This package holds no funds, has no server, and sends nothing anywhere except the
seller's URL. Use a dedicated low-balance agent wallet. No keys are stored or logged.

MIT. No latency or volume figures are stated because none are measured by this package.
