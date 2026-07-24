// SPDX-License-Identifier: BUSL-1.1
import { upsertUser } from '../../userCache.js';
import type { RunnerContext, RunnerResult } from '../types.js';

/**
 * Full crawl of every user under the directory's base DN. Reconciles
 * drift that the delta sync might have missed and prunes users that no
 * longer exist in AD. Expensive — runs daily by default.
 *
 * Triggers `memberships.rebuild` so the membership join table reflects
 * any moves the crawl picked up.
 */
export async function runUsersFull(ctx: RunnerContext): Promise<RunnerResult> {
  const seen = new Set<string>();
  let count = 0;

  for await (const user of ctx.provider.syncUsers({})) {
    try {
      await upsertUser(ctx.db, ctx.providerId, user, { source: 'sync' });
      seen.add(user.objectGuid);
      count++;
    } catch (err) {
      ctx.log.warn({ err, guid: user.objectGuid }, 'user upsert failed');
    }
  }

  // A completed full crawl is authoritative: any cached user we didn't see
  // no longer exists under the base DN (deleted in AD, or moved out of
  // scope), so soft-delete it. `upsertUser` clears `deleted_at` again if the
  // account ever reappears, so this self-heals on recreate/restore.
  const pruned = await pruneUnseenUsers(ctx, seen);

  return {
    cursor: new Date().toISOString(),
    stats: { usersSeen: count, usersPruned: pruned },
    triggers: ['memberships.rebuild'],
  };
}

/**
 * Soft-delete cached users not seen in this crawl.
 *
 * Guard: never prune when the crawl returned zero users. A full crawl that
 * yields nothing is almost always a failure (bad bind, wrong filter, or a
 * connection dropped mid-stream), and we must not wipe the entire cache on a
 * transient error. In that case we fall back to the old behaviour — flag the
 * absent rows stale — so the UI signals "possibly gone" without destroying
 * data. Returns the number of rows pruned.
 */
async function pruneUnseenUsers(ctx: RunnerContext, seen: Set<string>): Promise<number> {
  const now = new Date().toISOString();

  if (seen.size === 0) {
    ctx.log.warn(
      { providerId: ctx.providerId },
      'users.full: crawl returned zero users — flagging stale instead of pruning to avoid wiping the cache',
    );
    await ctx.db
      .updateTable('user_cache_records')
      .set({ stale_at: now })
      .where('provider_id', '=', ctx.providerId)
      .where('stale_at', 'is', null)
      .where('deleted_at', 'is', null)
      .execute();
    return 0;
  }

  const res = await ctx.db
    .updateTable('user_cache_records')
    .set({ deleted_at: now, stale_at: now })
    .where('provider_id', '=', ctx.providerId)
    .where('deleted_at', 'is', null)
    .where('object_guid', 'not in', Array.from(seen))
    .executeTakeFirst();

  const pruned = Number(res?.numUpdatedRows ?? 0n);
  if (pruned > 0) {
    ctx.log.info({ providerId: ctx.providerId, pruned }, 'users.full: pruned users absent from AD');
  }
  return pruned;
}
