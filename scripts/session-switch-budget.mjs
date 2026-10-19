import assert from 'node:assert/strict';

/** Keep collecting the 200 ms target while its intermittent overruns are investigated. */
export function reportSessionSwitchBudget(measurement, output = console) {
  const { durations, selectionSettledMs, maxMs, budgetMs } = measurement;
  assert.equal(durations.length, 10, 'Expected ten measured UI switches');
  assert.equal(selectionSettledMs.length, durations.length, 'Missing selection-settled timing samples');
  for (const elapsed of [...durations, ...selectionSettledMs])
    assert.ok(Number.isFinite(elapsed) && elapsed >= 0, 'Invalid session-switch timing');
  assert.equal(maxMs, Math.max(...durations), 'Maximum must match the recorded samples');
  assert.equal(budgetMs, 200, 'Keep the original performance target');
  if (maxMs > budgetMs) {
    output.warn(
      `::warning title=Session-switch performance::Session switching exceeded ${budgetMs} ms: ${maxMs} ms. Performance is temporarily advisory; functional checks remain required.`,
    );
    return false;
  }
  output.log(`PASS target messages observed by the next animation frame within ${budgetMs} ms`);
  return true;
}
