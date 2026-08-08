/** Poll until the predicate holds, or fail loudly after the timeout. */
export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  label = 'condition',
  // Generous, because a filesystem watch event can be delayed when the whole
  // workspace test suite runs in parallel. It only costs time on a real failure.
  timeoutMs = 20_000,
  intervalMs = 25,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
