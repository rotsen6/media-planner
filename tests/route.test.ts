import { describe, expect, it } from "vitest";
import { POST } from "../src/app/api/chat/route";
import { chatRequest as request } from "./fixtures";

describe("HTTP boundary", () => {
  it("accepts a same-origin browser even if Next normalizes the internal URL", async () => {
    const response = await POST(
      request(JSON.stringify({ mode: "brief", brief: {} })),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "clarification",
      pending: [],
      recommendation: null,
    });
  });
  it("rejects cross-origin JSON and oversized bodies", async () => {
    expect(
      (await POST(request("{}", "https://unrelated.example"))).status,
    ).toBe(403);
    expect((await POST(request("x".repeat(17000)))).status).toBe(413);
  });
  it("rejects malformed and unexpected input without model calls", async () => {
    expect((await POST(request("{"))).status).toBe(400);
    expect(
      (await POST(request('{"mode":"brief","brief":{"budget":-2}}'))).status,
    ).toBe(400);
    expect(
      (await POST(request('{"mode":"brief","brief":{},"rankings":[]}'))).status,
    ).toBe(400);
  });
});
