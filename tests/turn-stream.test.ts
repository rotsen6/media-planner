import { describe, expect, it, vi } from "vitest";
import type { TurnResponse } from "../src/lib/chat/protocol";
import { readTurnResponse } from "../src/lib/chat/read-response";

const result: TurnResponse = {
  status: "clarification", brief: {}, missing: ["budget"], pending: [],
  recommendation: null, explanation: ["What’s your budget?"], modelStatus: "used",
};
const line = (event: unknown) => `${JSON.stringify(event)}\n`;
const final = line({ type: "result", response: result });
const headers = { "Content-Type": "application/x-ndjson" };

describe("streamed turn reader", () => {
  it("reports progress before completion and decodes split UTF-8 and event boundaries", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start: (stream) => { controller = stream; } });
    Object.defineProperty(body, Symbol.asyncIterator, { value: undefined });
    const progress = vi.fn();
    const reading = readTurnResponse(new Response(body, { headers }), progress);
    const encoder = new TextEncoder();
    controller.enqueue(encoder.encode(line({ type: "progress", stage: "extract" })));
    await vi.waitFor(() => expect(progress).toHaveBeenCalledWith("extract"));
    for (const byte of encoder.encode(final)) controller.enqueue(Uint8Array.of(byte));
    controller.close();
    expect(await reading).toEqual(result);
  });

  it.each([
    [line({ type: "progress", stage: "respond" }), /before completion/],
    [final.slice(0, -5), /unreadable/],
    [line({ type: "result", response: { status: "ready" } }), /unreadable/],
    [final + final, /unreadable/],
  ])("rejects an incomplete or invalid response (%#)", async (body, message) => {
    await expect(readTurnResponse(new Response(body, { headers }), vi.fn())).rejects.toThrow(message);
  });

  it("cancels oversized bodies and propagates a disconnected stream", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => controller.enqueue(new Uint8Array(262_145)), cancel,
    });
    await expect(readTurnResponse(new Response(body, { headers }), vi.fn())).rejects.toThrow(/unreadable/);
    expect(cancel).toHaveBeenCalledOnce();
    const disconnected = new ReadableStream<Uint8Array>({
      start: (controller) => controller.error(new DOMException("Stopped", "AbortError")),
    });
    await expect(readTurnResponse(new Response(disconnected, { headers }), vi.fn())).rejects.toMatchObject({ name: "AbortError" });
  });

  it("accepts existing JSON results and preserves HTTP validation errors", async () => {
    const response = Response.json(result);
    Object.defineProperty(response.body, Symbol.asyncIterator, { value: undefined });
    expect(await readTurnResponse(response, vi.fn())).toEqual(result);
    await expect(readTurnResponse(Response.json({ error: "Invalid request" }, { status: 400 }), vi.fn())).rejects.toThrow("Invalid request");
  });
});
