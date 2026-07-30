<!-- SPDX-License-Identifier: BUSL-1.1
     Triggers a real Active Directory (LDAP) sync of one or more sync tasks
     for the active directory, then — in poll mode — waits for them to finish
     and emits `done` so the host page can reload its now-fresh cache.

     This is distinct from the plain "Refresh" buttons on the list views,
     which only re-read the local cache. Gated on `configure:directory` (the
     capability the trigger endpoint requires); the button is hidden for
     operators/auditors who can't trigger syncs. -->
<script setup lang="ts">
import { computed, ref } from 'vue';
import Button from 'primevue/button';
import { useToast } from 'primevue/usetoast';
import { api, type SyncTaskKey } from '../../api/index.js';
import { ApiError } from '../../api/client.js';
import { useAuthStore } from '../../stores/auth.js';

const props = withDefaults(
  defineProps<{
    /** Sync task keys to trigger, e.g. ['users.full']. */
    taskKeys: string[];
    label?: string;
    /** Wait for the tasks to finish then emit `done` (default). When false,
        fire-and-forget: queue + toast, don't block (used for the heavy
        "full sync everything" in the topbar). */
    poll?: boolean;
    /** Render icon-only (for the topbar). */
    iconOnly?: boolean;
    title?: string;
  }>(),
  { label: 'Sync from AD', poll: true, iconOnly: false },
);

const emit = defineEmits<{ (e: 'done'): void }>();

const auth = useAuthStore();
const toast = useToast();
const running = ref(false);

// The trigger endpoint requires configure:directory. Only surface the button
// when the operator can use it and we know which directory to sync.
const canSync = computed(
  () => auth.hasCapability('configure:directory') && auth.actor?.directoryId != null,
);

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function run(): Promise<void> {
  const dirId = auth.actor?.directoryId;
  if (dirId == null || running.value) return;
  running.value = true;
  try {
    let anyQueued = false;
    for (const key of props.taskKeys) {
      try {
        const r = await api.directories.syncTasks.run(dirId, key as SyncTaskKey);
        if (r.queued) anyQueued = true;
      } catch (err) {
        toast.add({
          severity: 'warn',
          summary: `Could not start ${key}`,
          detail: err instanceof ApiError ? err.message : String(err),
          life: 4000,
        });
      }
    }

    if (!props.poll) {
      toast.add({
        severity: 'info',
        summary: 'Full sync started',
        detail: 'Running in the background — track progress on the Tasks page.',
        life: 4500,
      });
      return;
    }

    toast.add({
      severity: 'info',
      summary: anyQueued ? 'Syncing from Active Directory…' : 'Sync already in progress…',
      life: 2000,
    });

    // Poll the queue until our tasks clear, or give up after a bit and refresh
    // anyway — the sync keeps running server-side regardless.
    const deadline = Date.now() + 90_000;
    let stillBusy = true;
    while (Date.now() < deadline) {
      await sleep(2000);
      try {
        const q = await api.directories.syncTasks.queue(dirId);
        const busy = new Set<string>([...q.inFlight, ...q.queued]);
        if (!props.taskKeys.some((k) => busy.has(k))) {
          stillBusy = false;
          break;
        }
      } catch {
        // transient — keep polling
      }
    }

    toast.add(
      stillBusy
        ? {
            severity: 'info',
            summary: 'Still syncing',
            detail: 'Taking a while — showing what we have; it will keep updating.',
            life: 4000,
          }
        : { severity: 'success', summary: 'Synced from Active Directory', life: 2500 },
    );
    emit('done');
  } finally {
    running.value = false;
  }
}
</script>

<template>
  <Button
    v-if="canSync"
    :label="iconOnly ? undefined : label"
    icon="pi pi-sync"
    :loading="running"
    :size="iconOnly ? 'small' : undefined"
    severity="secondary"
    :text="iconOnly"
    :outlined="!iconOnly"
    :rounded="iconOnly"
    :title="title ?? label"
    :aria-label="label"
    @click="run"
  />
</template>
