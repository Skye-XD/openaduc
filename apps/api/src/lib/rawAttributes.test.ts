// SPDX-License-Identifier: BUSL-1.1
import { describe, expect, it } from 'vitest';
import { visibleRawAttributes } from './rawAttributes.js';

describe('visibleRawAttributes', () => {
  const raw = {
    cn: 'PC-1',
    'ms-Mcs-AdmPwd': 'S3cret',
    'mslaps-password': '{"p":"x"}',
    description: 'x',
  };

  it('drops secret attributes for a session without view:raw_attributes', () => {
    expect(visibleRawAttributes(raw, ['read:computer'])).toEqual({ cn: 'PC-1', description: 'x' });
    expect(visibleRawAttributes(raw, null)).toEqual({ cn: 'PC-1', description: 'x' });
  });

  it('returns everything to a session that holds the capability', () => {
    expect(visibleRawAttributes(raw, ['view:raw_attributes'])).toBe(raw);
  });

  it('treats a missing bag as empty', () => {
    expect(visibleRawAttributes(undefined, [])).toEqual({});
  });
});
