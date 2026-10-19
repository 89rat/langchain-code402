import { describe, expect, test } from "vitest";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { getCode402Tools } from "../src/index.js";

const CATALOG = {
  tools: [
    {
      name: "iban_check",
      description: "IBAN Check & Wire Fraud Shield",
      // Legacy snake_case key; the camelCase inputSchema path is covered by the
      // @code-402/agent-tools suite (the adapter reads both).
      input_schema: {
        type: "object",
        properties: { iban: { type: "string", description: "IBAN to validate" } },
        required: ["iban"],
      },
      price_usdc: 0.005,
    },
    {
      name: "vat_mod97_check",
      description: "VAT mod-97 with an enum",
      input_schema: {
        type: "object",
        properties: { country: { type: "string", enum: ["BE", "NL", "LU"] } },
        required: ["country"],
      },
      price_usdc: 0.005,
    },
  ],
  receipts: { receipt_signing_address: "0x0000000000000000000000000000000000000000" },
};

const MODULES_CATALOG = {
  tools: [
    {
      name: "accelerate-payout",
      description: "Commerce payout acceleration quote",
      call: "POST /v1/commerce/accelerate-payout",
      inputSchema: {
        type: "object",
        properties: { invoice_id: { type: "string" } },
        required: ["invoice_id"],
      },
      price_usdc: 0.005,
    },
  ],
  receipts: { receipt_signing_address: "0x0000000000000000000000000000000000000000" },
};

function mockFetch() {
  return async (url: string | URL | Request) => {
    const u = String(url);
    if (u.endsWith("/.well-known/mcp.json?catalog=modules")) {
      return new Response(JSON.stringify(MODULES_CATALOG), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (u.endsWith("/.well-known/mcp.json")) {
      return new Response(JSON.stringify(CATALOG), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ result: { valid: true }, tier: "free" }), { status: 200, headers: { "content-type": "application/json" } });
  };
}

describe("getCode402Tools", () => {
  test("builds DynamicStructuredTools from the catalog with no network in tests", async () => {
    const tools = await getCode402Tools({ fetch: mockFetch() as never, baseUrl: "https://code402.invalid" });
    expect(tools.length).toBeGreaterThanOrEqual(3); // two catalog tools + free check_price
    for (const t of tools) expect(t).toBeInstanceOf(DynamicStructuredTool);
  });

  test("loads the modules catalog card (?catalog=modules) when catalog: 'modules' is set", async () => {
    const seenUrls: string[] = [];
    const baseMock = mockFetch();
    const trackingFetch = async (url: string | URL | Request) => {
      seenUrls.push(String(url));
      return baseMock(url);
    };
    const tools = await getCode402Tools({
      fetch: trackingFetch as never,
      baseUrl: "https://code402.invalid",
      catalog: "modules",
    });
    expect(seenUrls[0]).toBe("https://code402.invalid/.well-known/mcp.json?catalog=modules");
    expect(tools.some((t) => t.name === "code402_accelerate_payout")).toBe(true);
  });

  test("propagates the live inputSchema as an executable zod schema", async () => {
    const tools = await getCode402Tools({ fetch: mockFetch() as never, baseUrl: "https://code402.invalid" });
    const iban = tools.find((t) => t.name === "code402_iban_check")!;
    const schema = (iban as unknown as { schema: { parse: (v: unknown) => unknown } }).schema;
    expect(typeof schema.parse).toBe("function");
    expect(schema.parse({ iban: "GB82WEST12345698765432" })).toEqual({ iban: "GB82WEST12345698765432" });
    expect(() => schema.parse({})).toThrow(); // required iban missing
    const vat = tools.find((t) => t.name === "code402_vat_mod97_check")!;
    const vatSchema = (vat as unknown as { schema: { parse: (v: unknown) => unknown } }).schema;
    expect(vatSchema.parse({ country: "BE" })).toEqual({ country: "BE" });
    expect(() => vatSchema.parse({ country: "DE" })).toThrow(); // enum rejects
  });

  test("executes a call through the LangChain tool path", async () => {
    const tools = await getCode402Tools({ fetch: mockFetch() as never, baseUrl: "https://code402.invalid" });
    const iban = tools.find((t) => t.name === "code402_iban_check");
    expect(iban).toBeDefined();
    const res = JSON.parse(await iban!.invoke({ iban: "GB82WEST12345698765432" }));
    expect(res).toHaveProperty("result");
    expect(res).toHaveProperty("tier", "free");
  });

  test("refuses to sign without an account when the rail answers 402", async () => {
    const fetch402 = async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith("/.well-known/mcp.json")) {
        return new Response(JSON.stringify(CATALOG), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(
        JSON.stringify({ amount: "5000", recipient: "0xc59c85e661d34084a7769f955d17fd38254a6235", token_address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", chain_id: 8453, eip712: { name: "USD Coin", version: "2" }, maxTimeoutSeconds: 300 }),
        { status: 402, headers: { "content-type": "application/json" } },
      );
    };
    const tools = await getCode402Tools({ fetch: fetch402 as never, baseUrl: "https://code402.invalid" });
    const iban = tools.find((t) => t.name === "code402_iban_check")!;
    // cap default "0" and no account: the guard must fire, never sign
    await expect(iban.invoke({ iban: "GB82WEST12345698765432" })).rejects.toThrow(/requires payment|NoSigner/);
  });
});
