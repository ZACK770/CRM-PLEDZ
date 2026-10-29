import { env, createExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../server/index";

const call = (url: string, init?: RequestInit) =>
  worker.fetch(new Request(url, init) as Request<unknown, IncomingRequestCfProperties>, env, createExecutionContext());

describe("serving under /crm", () => {
  it("routes prefixed API calls and redirects the bare prefix", async () => {
    const api = await call("https://site.test/crm/api/auth/status");
    expect(api.status).toBe(200);
    expect(await api.json()).toHaveProperty("setup");
    const bare = await call("https://site.test/crm?x=1");
    expect(bare.status).toBe(308);
    expect(bare.headers.get("Location")).toBe("https://site.test/crm/?x=1");
  });
  it("keeps unprefixed API calls working and ignores a spoofed base header", async () => {
    const res = await call("https://site.test/unsubscribe?workspace=women&lead=x&token=y", {
      headers: { "X-Base-Path": "/evil" },
    });
    expect(res.status).toBe(400);
    expect((await call("https://site.test/api/auth/status")).status).toBe(200);
  });
});
