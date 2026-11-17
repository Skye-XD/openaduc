// SPDX-License-Identifier: BUSL-1.1
import { api } from '../../api/index.js';
import { nameOf } from '../lib/format.js';
import { useUndoableWrite, type UndoOffer, type WriteFailure } from '../lib/undoableWrite.js';

/** The account's own password settings, each a flag set on or off. */
export type PasswordSetting = 'neverExpires' | 'mustChange';

export interface PasswordSettingOp<T> {
  setting: PasswordSetting;
  on: boolean;
  account: T;
}

type Named = { id: string; displayName: string | null; samAccountName: string };

const WRITE: Record<PasswordSetting, (id: string, on: boolean) => Promise<unknown>> = {
  neverExpires: (id, on) => api.users.setPasswordNeverExpires(id, { neverExpires: on }),
  mustChange: (id, on) => api.users.setPasswordMustChange(id, { mustChange: on }),
};

/** What a change says once it lands. */
export function passwordSettingSummary(op: PasswordSettingOp<Named>): string {
  const name = nameOf(op.account);
  if (op.setting === 'neverExpires') {
    return op.on ? `${name}’s password never expires` : `${name}’s password expires normally`;
  }
  return op.on
    ? `${name} must change the password at next sign-in`
    : `${name} no longer has to change the password`;
}

export function passwordSettingFailedSummary(op: PasswordSettingOp<Named>): string {
  return `Couldn’t change ${nameOf(op.account)}’s password settings`;
}

/**
 * Turn "password never expires" or "must change password at next sign-in"
 * on or off for one user, with Undo (the same write the other way round).
 */
export function usePasswordSettings<T extends Named>(options: {
  onDone: (op: PasswordSettingOp<T>, offer: UndoOffer) => void | Promise<void>;
  onFailed?: (failure: WriteFailure<PasswordSettingOp<T>>) => void | Promise<void>;
}) {
  const writes = useUndoableWrite<PasswordSettingOp<T>>({
    write: ({ setting, on, account }) => WRITE[setting](account.id, on),
    inverse: (op) => ({ ...op, on: !op.on }),
    key: ({ account }) => account.id,
    onDone: options.onDone,
    onFailed: options.onFailed,
  });
  return {
    run: (setting: PasswordSetting, on: boolean, account: T) =>
      writes.run({ setting, on, account }),
    runningOn: (id: string) => writes.runningOn(id) ?? null,
  };
}
