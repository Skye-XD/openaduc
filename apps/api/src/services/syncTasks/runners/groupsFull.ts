// SPDX-License-Identifier: BUSL-1.1
import { pruneGroups, upsertGroup } from '../../groupCache.js';
import type { RunnerContext, RunnerResult } from '../types.js';

/**
 * Full group crawl. Daily reconciliation; prunes groups no longer in AD
 * (deleted / moved out of scope) rather than only flagging them stale.
 */
export async function runGroupsFull(ctx: RunnerContext): Promise<RunnerResult> {
  const seen = new Set<string>();
  let count = 0;

  for await (const group of ctx.provider.syncGroups({})) {
    try {
      await upsertGroup(ctx.db, ctx.providerId, group);
      seen.add(group.objectGuid);
      count++;
    } catch (err) {
      ctx.log.warn({ err, guid: group.objectGuid }, 'group upsert failed');
    }
  }

  const pruned = await pruneGroups(ctx.db, ctx.providerId, seen);

  return {
    cursor: new Date().toISOString(),
    stats: { groupsSeen: count, groupsPruned: pruned },
    triggers: ['memberships.rebuild'],
  };
}
