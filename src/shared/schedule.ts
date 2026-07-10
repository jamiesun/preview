export function scheduleAfterPaint(
  task: () => void,
  signal: AbortSignal,
): () => void {
  let frame = 0;
  let timer: number | undefined;
  let cancelled = false;

  const cancel = () => {
    cancelled = true;
    if (frame) cancelAnimationFrame(frame);
    if (timer !== undefined) clearTimeout(timer);
  };

  if (signal.aborted) return cancel;
  signal.addEventListener("abort", cancel, { once: true });
  frame = requestAnimationFrame(() => {
    timer = window.setTimeout(() => {
      if (!cancelled && !signal.aborted) task();
    }, 0);
  });
  return cancel;
}
