import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { createCode402Client, toLangChainTools } from "@code-402/agent-tools";

export type CatalogSelector = "core" | "modules" | "experimental";

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
  /**
   * Which seller catalog card to load from `/.well-known/mcp.json`:
   * - `"core"` (default): the 24-tool public catalog
   * - `"modules"`: the 7 paid revenue-module tools (`?catalog=modules`)
   * - `"experimental"`: the full advertised set (`?catalog=experimental`)
   */
  catalog?: CatalogSelector;
  /** Tool name prefix. Default "code402_". */
  prefix?: string;
  /** Include the free code402_check_price tool. Default true. */
  includeCheckPrice?: boolean;
  /** Fetch implementation override, used by tests and non-standard runtimes. */
  fetch?: typeof globalThis.fetch;
}

/**
 * Convert a seller-published JSON Schema (core subset) into an executable Zod
 * schema. Catalog content is untrusted DATA: it is interpreted by this
 * converter, never evaluated as code. Keywords outside the supported subset
 * degrade to a permissive passthrough instead of breaking tool construction.
 */
function jsonSchemaToZodSafe(schema: unknown, depth = 0): z.ZodTypeAny {
  if (depth > 16) return z.any();
  const s = (schema && typeof schema === "object" ? schema : {}) as Record<string, unknown>;
  const described = (base: z.ZodTypeAny): z.ZodTypeAny =>
    typeof s.description === "string" ? base.describe(s.description) : base;
  switch (s.type) {
    case "string": {
      const base = Array.isArray(s.enum) && s.enum.length > 0 && s.enum.every((v) => typeof v === "string")
        ? z.enum(s.enum as [string, ...string[]])
        : z.string();
      return described(base);
    }
    case "number":
      return described(z.number());
    case "integer":
      return described(z.number().int());
    case "boolean":
      return described(z.boolean());
    case "null":
      return described(z.null());
    case "array":
      return described(z.array(s.items !== undefined ? jsonSchemaToZodSafe(s.items, depth + 1) : z.any()));
    case "object": {
      const properties = (s.properties && typeof s.properties === "object" ? s.properties : {}) as Record<string, unknown>;
      const required = new Set(Array.isArray(s.required) ? s.required.filter((key): key is string => typeof key === "string") : []);
      const shape: Record<string, z.ZodTypeAny> = {};
      for (const [key, value] of Object.entries(properties)) {
        const field = jsonSchemaToZodSafe(value, depth + 1);
        shape[key] = required.has(key) ? field : field.optional();
      }
      const object = z.object(shape);
      return described(s.additionalProperties === true ? object.passthrough() : object);
    }
    default:
      // OneOf/anyOf/refs and exotic keywords are not interpreted here; the
      // tool still executes and the seller's own endpoint validates input.
      return z.any();
  }
}

/**
 * Build LangChain DynamicStructuredTools from the live code402 catalog.
 *
 * Every tool is a real DynamicStructuredTool whose schema is derived from the
 * seller's published input schema (MCP `inputSchema` or legacy `input_schema`).
 * Payments are non-custodial: the agent's wallet signs an EIP-3009 transfer
 * directly to the seller named in the 402 challenge (USDC on Base). The live
 * 402 challenge is the only price ever signed; maxAmountMinor caps it per call
 * before signing.
 */
export async function getCode402Tools(
  opts: Code402LangChainOptions = {},
): Promise<DynamicStructuredTool[]> {
  const catalogCard: CatalogSelector = opts.catalog ?? "core";
  const rawFetch = opts.fetch ?? globalThis.fetch;
  const wrappedFetch: typeof globalThis.fetch | undefined = rawFetch
    ? (async (input: string | URL | Request, init?: RequestInit) => {
        if (catalogCard !== "core" && (typeof input === "string" || input instanceof URL)) {
          const u = String(input);
          if (u.endsWith("/.well-known/mcp.json")) {
            return rawFetch(`${u}?catalog=${catalogCard}`, init);
          }
        }
        return rawFetch(input as never, init);
      }) as typeof globalThis.fetch
    : undefined;

  const client = createCode402Client({
    baseUrl: opts.baseUrl ?? "https://hcrb.in",
    account: opts.account as never,
    maxAmountMinor: opts.maxAmountMinor ?? "0",
    allowMainnet: opts.allowMainnet ?? false,
    ...(catalogCard !== "core" ? { catalog: catalogCard } : {}),
    fetch: wrappedFetch,
  } as Parameters<typeof createCode402Client>[0]);
  return toLangChainTools(client, {
    DynamicStructuredTool,
    schema: (s) => jsonSchemaToZodSafe(s),
    prefix: opts.prefix,
    includeCheckPrice: opts.includeCheckPrice,
  }) as Promise<DynamicStructuredTool[]>;
}

export type { DynamicStructuredTool };
