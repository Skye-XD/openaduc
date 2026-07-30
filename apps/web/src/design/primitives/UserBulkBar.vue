<!-- SPDX-License-Identifier: BUSL-1.1
     Inline (in-flow) bulk-action toolbar for a set of selected users, plus
     the Move/Edit dialogs. Rendered at the TOP of a page/pane (not floating),
     so it never overlaps page content or the edit-mode timer/FAB.

     Shared by the Users list and the OU browser. Each action runs as an
     elevate-once batch over the existing per-user endpoints (already
     capability-checked + audited server-side). -->
<script setup lang="ts">
import { computed, ref } from 'vue';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import TreeSelect from 'primevue/treeselect';
import type { TreeNode } from 'primevue/treenode';
import { useToast } from 'primevue/usetoast';
import { api } from '../../api/index.js';
import { ApiError } from '../../api/client.js';
import { useAuthStore } from '../../stores/auth.js';
import type { UserUpdateRequest } from '@openaduc/shared';

const props = defineProps<{
  selectedIds: Set<string>;
  /** All selectable ids in the host context — enables the "Select all"
      button inside the bar. Omit to hide it. */
  allIds?: string[];
}>();
const emit = defineEmits<{
  (e: 'update:selectedIds', value: Set<string>): void;
  (e: 'done'): void;
}>();

const auth = useAuthStore();
const toast = useToast();

const selectedCount = computed(() => props.selectedIds.size);
function clearSelection(): void {
  emit('update:selectedIds', new Set());
}
const canSelectAll = computed(() => (props.allIds?.length ?? 0) > selectedCount.value);
function selectAll(): void {
  emit('update:selectedIds', new Set(props.allIds ?? []));
}

const canBulkDisable = computed(() => auth.hasCapability('write:user.enableDisable'));
const canBulkUnlock = computed(() => auth.hasCapability('write:user.unlock'));
const canBulkMove = computed(() => auth.hasCapability('write:user.move'));
const canBulkEdit = computed(() => auth.hasCapability('write:user.attributes'));

type BulkAction = 'disable' | 'enable' | 'unlock' | 'move' | 'edit';
const pendingBulkAction = ref<BulkAction | null>(null);
const bulkRunning = ref(false);
const bulkProgress = ref<{ done: number; total: number; failures: { id: string; error: string }[] }>(
  { done: 0, total: 0, failures: [] },
);
const bulkBusyMessage = computed(() =>
  bulkRunning.value ? `${bulkProgress.value.done} of ${bulkProgress.value.total} done` : null,
);

async function execBulk(
  action: BulkAction,
  op: (id: string) => Promise<void>,
  verb: string,
): Promise<void> {
  if (props.selectedIds.size === 0) return;
  pendingBulkAction.value = action;
  const ids = Array.from(props.selectedIds);
  bulkRunning.value = true;
  bulkProgress.value = { done: 0, total: ids.length, failures: [] };
  try {
    for (const id of ids) {
      try {
        await op(id);
      } catch (err) {
        bulkProgress.value.failures.push({
          id,
          error: err instanceof ApiError ? err.message : String(err),
        });
      } finally {
        bulkProgress.value = { ...bulkProgress.value, done: bulkProgress.value.done + 1 };
      }
    }
    const succeeded = bulkProgress.value.total - bulkProgress.value.failures.length;
    if (bulkProgress.value.failures.length === 0) {
      toast.add({
        severity: 'success',
        summary: `${verb} ${succeeded} ${succeeded === 1 ? 'account' : 'accounts'}`,
        life: 4000,
      });
    } else {
      toast.add({
        severity: 'warn',
        summary: `${succeeded} succeeded, ${bulkProgress.value.failures.length} failed`,
        detail: bulkProgress.value.failures
          .slice(0, 3)
          .map((f) => f.error)
          .join('; '),
        life: 8000,
      });
    }
    clearSelection();
    emit('done');
  } finally {
    bulkRunning.value = false;
    pendingBulkAction.value = null;
  }
}

function startBulk(action: 'disable' | 'enable' | 'unlock'): void {
  const op =
    action === 'disable'
      ? async (id: string) => void (await api.users.disable(id))
      : action === 'enable'
        ? async (id: string) => void (await api.users.enable(id))
        : async (id: string) => void (await api.users.unlock(id));
  const verb = action === 'disable' ? 'Disabled' : action === 'enable' ? 'Enabled' : 'Unlocked';
  auth.requireEdit(() => execBulk(action, op, verb));
}

// ---- Move to OU ----------------------------------------------------------
const bulkMoveOpen = ref(false);
const bulkOuNodes = ref<TreeNode[]>([]);
const bulkOuLoading = ref(false);
const bulkMoveSelection = ref<Record<string, boolean>>({});
const bulkMoveTargetDn = computed<string | null>(
  () => Object.keys(bulkMoveSelection.value).find((k) => bulkMoveSelection.value[k]) ?? null,
);

function buildOuTree(
  ous: { distinguishedName: string; name: string; parentDn: string | null }[],
): TreeNode[] {
  const byDn = new Map<string, TreeNode & { children: TreeNode[] }>();
  for (const o of ous) {
    byDn.set(o.distinguishedName.toLowerCase(), { key: o.distinguishedName, label: o.name, children: [] });
  }
  const roots: TreeNode[] = [];
  for (const o of ous) {
    const node = byDn.get(o.distinguishedName.toLowerCase())!;
    const parent = o.parentDn ? byDn.get(o.parentDn.toLowerCase()) : undefined;
    if (parent) parent.children!.push(node);
    else roots.push(node);
  }
  const sortRec = (nodes: TreeNode[]): void => {
    nodes.sort((a, b) => (a.label ?? '').localeCompare(b.label ?? ''));
    for (const n of nodes) if (n.children) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}

async function openBulkMove(): Promise<void> {
  bulkMoveSelection.value = {};
  bulkMoveOpen.value = true;
  if (bulkOuNodes.value.length === 0) {
    bulkOuLoading.value = true;
    try {
      const resp = await api.ous.list();
      bulkOuNodes.value = buildOuTree(resp.ous);
    } catch (err) {
      toast.add({
        severity: 'error',
        summary: 'Could not load OUs',
        detail: err instanceof ApiError ? err.message : String(err),
        life: 5000,
      });
    } finally {
      bulkOuLoading.value = false;
    }
  }
}

function confirmBulkMove(): void {
  const dn = bulkMoveTargetDn.value;
  if (!dn) return;
  bulkMoveOpen.value = false;
  auth.requireEdit(() =>
    execBulk('move', async (id) => void (await api.users.move(id, { targetOuDn: dn })), 'Moved'),
  );
}

// ---- Edit common attributes ----------------------------------------------
const bulkEditOpen = ref(false);
function blankDraft() {
  return { department: '', title: '', company: '', description: '', l: '', st: '', co: '', postalCode: '' };
}
const bulkEditDraft = ref(blankDraft());

function openBulkEdit(): void {
  bulkEditDraft.value = blankDraft();
  bulkEditOpen.value = true;
}

const bulkEditPatch = computed<NonNullable<UserUpdateRequest['patch']>>(() => {
  const d = bulkEditDraft.value;
  const patch: NonNullable<UserUpdateRequest['patch']> = {};
  if (d.department.trim()) patch.department = d.department.trim();
  if (d.title.trim()) patch.title = d.title.trim();
  if (d.company.trim()) patch.company = d.company.trim();
  if (d.description.trim()) patch.description = d.description.trim();
  if (d.l.trim()) patch.l = d.l.trim();
  if (d.st.trim()) patch.st = d.st.trim();
  if (d.co.trim()) patch.co = d.co.trim();
  if (d.postalCode.trim()) patch.postalCode = d.postalCode.trim();
  return patch;
});
const bulkEditHasChanges = computed(() => Object.keys(bulkEditPatch.value).length > 0);

function confirmBulkEdit(): void {
  if (!bulkEditHasChanges.value) return;
  const patch = bulkEditPatch.value;
  bulkEditOpen.value = false;
  auth.requireEdit(() =>
    execBulk('edit', async (id) => void (await api.users.update(id, { patch })), 'Updated'),
  );
}
</script>

<template>
  <div v-if="selectedCount > 0" class="ubulk" role="region" aria-label="Bulk actions">
    <span class="ubulk-count"><strong>{{ selectedCount }}</strong> selected</span>
    <div class="ubulk-actions">
      <Button
        v-if="canBulkEdit"
        label="Edit…"
        icon="pi pi-pencil"
        severity="secondary"
        size="small"
        :disabled="bulkRunning"
        @click="openBulkEdit"
      />
      <Button
        v-if="canBulkMove"
        label="Move…"
        icon="pi pi-folder-open"
        severity="secondary"
        size="small"
        :disabled="bulkRunning"
        @click="openBulkMove"
      />
      <Button
        v-if="canBulkUnlock"
        label="Unlock"
        icon="pi pi-unlock"
        severity="warn"
        size="small"
        :loading="bulkRunning && pendingBulkAction === 'unlock'"
        :disabled="bulkRunning"
        @click="startBulk('unlock')"
      />
      <Button
        v-if="canBulkDisable"
        label="Disable"
        icon="pi pi-ban"
        severity="danger"
        size="small"
        :loading="bulkRunning && pendingBulkAction === 'disable'"
        :disabled="bulkRunning"
        @click="startBulk('disable')"
      />
      <Button
        v-if="canBulkDisable"
        label="Enable"
        icon="pi pi-check"
        severity="secondary"
        size="small"
        :loading="bulkRunning && pendingBulkAction === 'enable'"
        :disabled="bulkRunning"
        @click="startBulk('enable')"
      />
    </div>
    <span v-if="bulkBusyMessage" class="ubulk-progress mono">{{ bulkBusyMessage }}</span>
    <div class="ubulk-right">
      <Button
        v-if="canSelectAll"
        label="Select all"
        icon="pi pi-check-square"
        text
        severity="secondary"
        size="small"
        :disabled="bulkRunning"
        @click="selectAll"
      />
      <Button
        label="Clear"
        icon="pi pi-times"
        text
        severity="secondary"
        size="small"
        :disabled="bulkRunning"
        @click="clearSelection"
      />
    </div>
  </div>

  <!-- Move selected users to an OU -->
  <Dialog
    :visible="bulkMoveOpen"
    modal
    :header="`Move ${selectedCount} user${selectedCount === 1 ? '' : 's'} to an OU`"
    :style="{ width: '32rem' }"
    @update:visible="(v) => !v && (bulkMoveOpen = false)"
  >
    <p style="font-size: 13px; color: var(--text-3); margin: 0 0 12px">
      Pick the destination organizational unit. Every selected user is moved there (each keeps its
      own name).
    </p>
    <div v-if="bulkOuLoading" style="font-size: 13px; color: var(--text-3)">Loading OUs…</div>
    <TreeSelect
      v-else
      v-model="bulkMoveSelection"
      :options="bulkOuNodes"
      selection-mode="single"
      placeholder="Select an OU"
      fluid
      filter
    />
    <template #footer>
      <Button label="Cancel" text severity="secondary" @click="bulkMoveOpen = false" />
      <Button
        label="Move users"
        icon="pi pi-folder-open"
        :disabled="!bulkMoveTargetDn"
        @click="confirmBulkMove"
      />
    </template>
  </Dialog>

  <!-- Edit common attributes on selected users -->
  <Dialog
    :visible="bulkEditOpen"
    modal
    :header="`Edit ${selectedCount} user${selectedCount === 1 ? '' : 's'}`"
    :style="{ width: '34rem' }"
    @update:visible="(v) => !v && (bulkEditOpen = false)"
  >
    <p style="font-size: 13px; color: var(--text-3); margin: 0 0 14px">
      Only the fields you fill in are applied to <strong>every</strong> selected user. Blank fields
      are left unchanged.
    </p>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px">
      <div style="display: flex; flex-direction: column; gap: 4px">
        <span style="font-size: 12px; color: var(--text-3)">Department</span>
        <InputText v-model="bulkEditDraft.department" fluid />
      </div>
      <div style="display: flex; flex-direction: column; gap: 4px">
        <span style="font-size: 12px; color: var(--text-3)">Title</span>
        <InputText v-model="bulkEditDraft.title" fluid />
      </div>
      <div style="display: flex; flex-direction: column; gap: 4px">
        <span style="font-size: 12px; color: var(--text-3)">Company</span>
        <InputText v-model="bulkEditDraft.company" fluid />
      </div>
      <div style="display: flex; flex-direction: column; gap: 4px">
        <span style="font-size: 12px; color: var(--text-3)">City</span>
        <InputText v-model="bulkEditDraft.l" fluid />
      </div>
      <div style="display: flex; flex-direction: column; gap: 4px">
        <span style="font-size: 12px; color: var(--text-3)">State / Province</span>
        <InputText v-model="bulkEditDraft.st" fluid />
      </div>
      <div style="display: flex; flex-direction: column; gap: 4px">
        <span style="font-size: 12px; color: var(--text-3)">Country</span>
        <InputText v-model="bulkEditDraft.co" fluid />
      </div>
      <div style="display: flex; flex-direction: column; gap: 4px">
        <span style="font-size: 12px; color: var(--text-3)">Postal code</span>
        <InputText v-model="bulkEditDraft.postalCode" fluid />
      </div>
      <div style="display: flex; flex-direction: column; gap: 4px; grid-column: 1 / -1">
        <span style="font-size: 12px; color: var(--text-3)">Description</span>
        <InputText v-model="bulkEditDraft.description" fluid />
      </div>
    </div>
    <template #footer>
      <Button label="Cancel" text severity="secondary" @click="bulkEditOpen = false" />
      <Button
        label="Apply to all"
        icon="pi pi-check"
        :disabled="!bulkEditHasChanges"
        @click="confirmBulkEdit"
      />
    </template>
  </Dialog>
</template>

<style scoped>
/* In-flow toolbar: sits at the top of the page/pane, full width, pushes
   content down. No fixed positioning, so it never overlaps rows or the
   bottom edit-mode timer/FAB. */
.ubulk {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  margin-bottom: 12px;
  background: var(--surface-2);
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  flex-wrap: wrap;
}
.ubulk-count {
  font-size: 13px;
  color: var(--text-2);
}
.ubulk-count strong {
  color: var(--text);
  font-weight: 600;
}
.ubulk-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.ubulk-progress {
  font-size: 12px;
  color: var(--text-3);
}
.ubulk-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
}
.mono {
  font-family: var(--font-mono);
}
</style>
