import { DynamicStructuredTool } from "@langchain/core/tools";
import { jsonSchemaToZod } from "json-schema-to-zod";
import { createCode402Client, toLangChainTools } from "@code-402/agent-tools";

/**
 * Options for building code402 LangChain tools.
 */
export interface Code402LangChainOptions {
  /** code402 endpoint origin. Default "https://hcrb.in". */
  baseUrl?: string;
  /** A viem local account (privateKeyToAccount(...)). Omit for free-tier / quote-only use. */
  account?: unknown;
  /**
   * Hard client-side spend cap in USDC minor units (6 decimals): "5000" = 0.005 USDC.
   * Default "0" = never pay. Enforced before any signature is produced.
   */
  maxAmountMinor?: string;
  /** Base mainnet (chain 8453) requires an explicit opt-in. */
  allowMainnet?: boolean;
  /** Tool name prefix. Default "code402_". */
  prefix?: string;
  /** Include the free code402_check_price tool. Default true. */
  includeCheckPrice?: boolean;
  /** Fetch implementation override, used by tests and non-standard runtimes. */
  fetch?: typeof globalThis.fetch;
}

/**
 * Build LangChain DynamicStructuredTools from the live code402 catalog.
 *
 * Every tool is a real DynamicStructuredTool whose schema is derived from the
 * seller's published input schema. Payments are non-custodial: the agent's
 * wallet signs an EIP-3009 transfer directly to the seller named in the 402
 * challenge (USDC on Base). The live 402 challenge is the only price ever
 * signed; maxAmountMinor caps it per call before signing.
 */
export async function getCode402Tools(
  opts: Code402LangChainOptions = {},
): Promise<DynamicStructuredTool[]> {
  const client = createCode402Client({
    baseUrl: opts.baseUrl ?? "https://hcrb.in",
    account: opts.account as never,
    maxAmountMinor: opts.maxAmountMinor ?? "0",
    allowMainnet: opts.allowMainnet ?? false,
    fetch: opts.fetch,
  });
  return toLangChainTools(client, {
    DynamicStructuredTool,
    schema: (s) => jsonSchemaToZod(s as unknown as Parameters<typeof jsonSchemaToZod>[0]),
    prefix: opts.prefix,
    includeCheckPrice: opts.includeCheckPrice,
  }) as Promise<DynamicStructuredTool[]>;
}

export type { DynamicStructuredTool };
