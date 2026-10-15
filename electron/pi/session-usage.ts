import type { SessionUsage } from '../../shared/usage';
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const amount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** The same persisted entry kinds counted by Pi's public get_session_stats response. */
export function sessionUsage(entries: unknown[]): SessionUsage {
  let tokens = 0,
    cost = 0,
    validTokens = true,
    validCost = true;
  for (const entry of entries) {
    if (!record(entry)) continue;
    let usage: unknown;
    if (entry.type === 'usage' || entry.type === 'compaction' || entry.type === 'branch_summary')
      usage = entry.usage;
    else if (entry.type === 'message' && record(entry.message)) {
      if (entry.message.role === 'assistant' || entry.message.role === 'toolResult')
        usage = entry.message.usage;
      if (entry.message.role === 'assistant' && usage === undefined) {
        validTokens = false;
        validCost = false;
      }
    }
    if (usage === undefined) continue;
    if (!record(usage)) {
      validTokens = false;
      validCost = false;
      continue;
    }
    const values = [usage.input, usage.output, usage.cacheRead, usage.cacheWrite];
    if (values.every(amount)) tokens += values.reduce((sum, value) => sum + value, 0);
    else validTokens = false;
    if (record(usage.cost) && amount(usage.cost.total)) cost += usage.cost.total;
    else validCost = false;
  }
  return { tokens: validTokens ? tokens : undefined, cost: validCost ? cost : undefined };
}
