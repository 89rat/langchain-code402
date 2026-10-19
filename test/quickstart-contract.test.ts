import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getCode402Tools } from "../src/index.js";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const catalog = { tools: [{ name: "iban_check", inputSchema: {
  type: "object", properties: { iban: { type: "string" } }, required: ["iban"],
} }] };

describe("published quickstart contract", () => {
  it("separates never-pay evaluation from explicitly authorized Base payments and documents modules catalog", () => {
    const snippets = [...readme.matchAll(/```ts\n([\s\S]*?)```/g)].map(match => match[1]!);
    expect(snippets).toHaveLength(3);
    expect(snippets[0]).toContain('maxAmountMinor: "0"');
    expect(snippets[0]).not.toContain("privateKeyToAccount");
    expect(snippets[1]).toContain("allowMainnet: true");
    expect(snippets[1]).toContain('maxAmountMinor: "5000"');
    expect(snippets[2]).toContain('catalog: "modules"');
    expect(readme).toContain("not an aggregate budget");
    expect(readme).toContain("does not provide a durable recovery journal");
  });

  it("constructs and invokes the documented free-first tool without a signer", async () => {
    const fetch = async (url: string | URL | Request) => Response.json(
      String(url).endsWith("/.well-known/mcp.json") ? catalog : { result: { valid: true }, tier: "free" },
    );
    const tools = await getCode402Tools({ baseUrl: "https://code402.invalid", maxAmountMinor: "0", fetch: fetch as typeof globalThis.fetch });
    const iban = tools.find(tool => tool.name === "code402_iban_check");
    expect(iban).toBeDefined();
    const result = JSON.parse(await iban!.invoke({ iban: "GB82WEST12345698765432" }));
    expect(result.paid).toBe(false);
    expect(result.result.valid).toBe(true);
  });
});
