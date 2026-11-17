// SPDX-License-Identifier: BUSL-1.1
import { describe, expect, it } from 'vitest';
import { passwordSettingSummary } from './usePasswordSettings.js';

const account = { id: 'u1', displayName: 'Ivan Petrov', samAccountName: 'i.petrov' };

describe('passwordSettingSummary', () => {
  it('says what each setting now is', () => {
    expect(passwordSettingSummary({ setting: 'neverExpires', on: true, account })).toBe(
      'Ivan Petrov’s password never expires',
    );
    expect(passwordSettingSummary({ setting: 'neverExpires', on: false, account })).toBe(
      'Ivan Petrov’s password expires normally',
    );
    expect(passwordSettingSummary({ setting: 'mustChange', on: true, account })).toBe(
      'Ivan Petrov must change the password at next sign-in',
    );
    expect(passwordSettingSummary({ setting: 'mustChange', on: false, account })).toBe(
      'Ivan Petrov no longer has to change the password',
    );
  });
});
