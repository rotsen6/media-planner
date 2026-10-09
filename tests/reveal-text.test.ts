import { afterEach, expect, it, vi } from "vitest";
import { revealText } from "../src/lib/chat/reveal-text";

afterEach(() => vi.useRealTimers());

it("reveals whole characters in order and holds the completed reply before opening the plan", async () => {
  vi.useFakeTimers();
  const onText = vi.fn();
  const done = vi.fn();
  const text = " A,\ne\u0301👩🏽‍💻! ";
  const revealing = revealText(text, onText, new AbortController().signal, undefined, 1000).then(done);
  expect(onText.mock.calls.flat()).toEqual([" "]);
  await vi.advanceTimersByTimeAsync(29);
  expect(onText).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  expect(onText).toHaveBeenLastCalledWith(" A");
  await vi.advanceTimersByTimeAsync(180);
  expect(onText.mock.calls.flat()).toEqual([
    " ", " A", " A,", " A,\n", " A,\ne\u0301", " A,\ne\u0301👩🏽‍💻", " A,\ne\u0301👩🏽‍💻!", text,
  ]);
  expect(done).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(999);
  expect(done).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await revealing;
  expect(done).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("stops immediately on cancellation without any later text or completion", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const onText = vi.fn();
  const done = vi.fn();
  const revealing = revealText("First second third", onText, controller.signal).then(done);
  const rejected = expect(revealing).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await rejected;
  await vi.runAllTimersAsync();
  expect(onText).toHaveBeenCalledOnce();
  expect(done).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  await expect(revealText("Again", onText, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(onText).toHaveBeenCalledOnce();

  const paused = new AbortController();
  const holding = revealText("OK", onText, paused.signal, undefined, 1000);
  const interrupted = expect(holding).rejects.toMatchObject({ name: "AbortError" });
  await vi.advanceTimersByTimeAsync(30);
  expect(onText).toHaveBeenLastCalledWith("OK");
  await vi.advanceTimersByTimeAsync(300);
  paused.abort();
  await interrupted;
  expect(vi.getTimerCount()).toBe(0);
});

it("finishes immediately when animation is disabled, including during a reply", async () => {
  vi.useFakeTimers();
  const onText = vi.fn();
  const signal = new AbortController().signal;
  await revealText("No animation", onText, signal, () => false, 1000);
  expect(onText).toHaveBeenLastCalledWith("No animation");
  expect(vi.getTimerCount()).toBe(0);
  let visible = true;
  const revealing = revealText("One two three", onText, signal, () => visible);
  visible = false;
  await vi.advanceTimersByTimeAsync(30);
  await revealing;
  expect(onText).toHaveBeenLastCalledWith("One two three");
  expect(vi.getTimerCount()).toBe(0);
});
