const CHARACTER_INTERVAL_MS = 30;

/** Reveal validated reply text, then pause before completing. */
export async function revealText(
  text: string,
  onText: (text: string) => void,
  signal: AbortSignal,
  shouldAnimate: () => boolean = () => true,
  pauseAfter = CHARACTER_INTERVAL_MS,
): Promise<void> {
  signal.throwIfAborted();
  if (!text.trim()) return onText(text);
  const characters = new Intl.Segmenter(undefined, { granularity: "grapheme" })
    .segment(text)[Symbol.iterator]();
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const finish = (aborted = false) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (aborted) reject(signal.reason);
      else resolve();
    };
    const abort = () => finish(true);
    const step = () => {
      if (!shouldAnimate()) {
        onText(text);
        finish();
        return;
      }
      const character = characters.next();
      if (character.done) {
        finish();
        return;
      }
      // Schedule before dispatch so cancellation from the callback clears it too.
      const end = character.value.index + character.value.segment.length;
      const delay = end === text.length ? pauseAfter : CHARACTER_INTERVAL_MS;
      timer = setTimeout(step, delay);
      onText(text.slice(0, end));
    };
    signal.addEventListener("abort", abort, { once: true });
    step();
  });
}
