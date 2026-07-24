<!-- SPDX-License-Identifier: BUSL-1.1
     Classic "New Object - User" dialog. Provisions a new AD account into
     the selected OU. Per this deployment's policy the account is created
     DISABLED with no password (a single LDAP add); the operator then sets a
     password and enables it via the existing Reset Password / Enable
     actions. Routes through useAuth.requireEdit so the step-up flow runs
     before the API call. -->
<script setup lang="ts">
import { computed, ref } from 'vue';
import WinDialog from './WinDialog.vue';
import { api } from '../../api/index.js';
import { ApiError } from '../../api/client.js';
import { useAuthStore } from '../../stores/auth.js';
import { useOldSchool } from '../stores/useOldSchool.js';
import { useToast } from 'primevue/usetoast';

const props = defineProps<{ windowId: number; parentDn: string | null; parentLabel: string }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const auth = useAuthStore();
const store = useOldSchool();
const toast = useToast();

const givenName = ref('');
const surname = ref('');
const displayName = ref('');
const samAccountName = ref('');
const userPrincipalName = ref('');
const email = ref('');
const err = ref<string | null>(null);

// Mirror the server-side sAMAccountName rule: 1..20 chars, none of the AD
// reserved characters or whitespace.
const SAM_RE = /^[^\s"[\]:;|=+*?<>/\\,]+$/;
const samValid = computed(
  () => samAccountName.value.length >= 1 && samAccountName.value.length <= 20 && SAM_RE.test(samAccountName.value),
);
const canOk = computed(() => props.parentDn !== null && samValid.value);

async function submit(): Promise<void> {
  if (props.parentDn === null) {
    err.value = 'Select an OU in the tree first, then open New User.';
    return;
  }
  if (!samValid.value) {
    err.value =
      samAccountName.value.length > 20
        ? 'Logon name must be 20 characters or fewer.'
        : 'Logon name is required and cannot contain spaces or any of " [ ] : ; | = + * ? < > / \\ ,';
    return;
  }
  err.value = null;
  const parentDn = props.parentDn;
  auth.requireEdit(async () => {
    try {
      const res = await api.users.create({
        parentDn,
        samAccountName: samAccountName.value.trim(),
        userPrincipalName: userPrincipalName.value.trim() || undefined,
        givenName: givenName.value.trim() || undefined,
        surname: surname.value.trim() || undefined,
        displayName: displayName.value.trim() || undefined,
        email: email.value.trim() || undefined,
      });
      toast.add({
        severity: 'success',
        summary: 'User created',
        detail: `${res.samAccountName} was created (disabled). Set a password and enable the account to activate it.`,
        life: 6000,
      });
      store.bumpData();
      emit('close');
    } catch (e) {
      err.value = e instanceof ApiError ? e.message : (e as Error).message;
    }
  }, 'Creating a user requires step-up authentication.');
}
</script>

<template>
  <WinDialog
    :window-id="windowId"
    title="New Object - User"
    icon="newuser"
    hide-apply
    ok-label="OK"
    :can-ok="canOk"
    @ok="submit"
    @cancel="emit('close')"
    @close="emit('close')"
  >
    <div style="padding: 18px 18px 14px 18px; font-size: 12px">
      <div style="margin-bottom: 14px">
        Create in:
        <strong v-if="parentDn">{{ parentLabel }}</strong>
        <span v-else style="color: #b00020">no OU selected</span>
      </div>

      <div class="os-form" style="grid-template-columns: 150px minmax(0, 1fr); row-gap: 8px">
        <label class="label" for="nu-given">First name:</label>
        <input id="nu-given" type="text" class="os-input" v-model="givenName" autocomplete="off" />

        <label class="label" for="nu-surname">Last name:</label>
        <input id="nu-surname" type="text" class="os-input" v-model="surname" autocomplete="off" />

        <label class="label" for="nu-display">Display name:</label>
        <input
          id="nu-display"
          type="text"
          class="os-input"
          v-model="displayName"
          placeholder="defaults to First Last"
          autocomplete="off"
        />

        <label class="label" for="nu-sam">User logon name:</label>
        <input
          id="nu-sam"
          type="text"
          class="os-input"
          v-model="samAccountName"
          autocomplete="off"
          maxlength="20"
        />

        <label class="label" for="nu-upn">User principal name:</label>
        <input
          id="nu-upn"
          type="text"
          class="os-input"
          v-model="userPrincipalName"
          placeholder="user@domain"
          autocomplete="off"
        />

        <label class="label" for="nu-email">Email:</label>
        <input id="nu-email" type="text" class="os-input" v-model="email" autocomplete="off" />
      </div>

      <div v-if="err" class="os-error" style="margin-top: 12px">{{ err }}</div>
      <div v-else class="os-info" style="margin-top: 12px">
        The account is created <strong>disabled with no password</strong>. Use Reset Password and
        Enable Account afterwards to activate it.
      </div>
    </div>
  </WinDialog>
</template>
