// SPDX-License-Identifier: BUSL-1.1
/**
 * The raw LDAP attributes of an object go to the browser for the property dialogs and the
 * "Raw LDAP" tab. The service account may be able to read attributes that are secrets in
 * themselves (LAPS local-administrator passwords, BitLocker recovery keys, password
 * hashes and key material). Those are dropped here unless the session holds
 * `view:raw_attributes`; checking that capability only in the web client protected nothing.
 */
const SECRET_ATTRIBUTES = new Set(
  [
    'ms-Mcs-AdmPwd',
    'msLAPS-Password',
    'msLAPS-EncryptedPassword',
    'msLAPS-EncryptedPasswordHistory',
    'msLAPS-EncryptedDSRMPassword',
    'msLAPS-EncryptedDSRMPasswordHistory',
    'msFVE-RecoveryPassword',
    'msFVE-KeyPackage',
    'msDS-ManagedPassword',
    'msDS-KeyCredentialLink',
    'unicodePwd',
    'userPassword',
    'unixUserPassword',
    'dBCSPwd',
    'ntPwdHistory',
    'lmPwdHistory',
    'supplementalCredentials',
  ].map((name) => name.toLowerCase()),
);

export function visibleRawAttributes<T extends Record<string, unknown>>(
  raw: T | null | undefined,
  capabilities: readonly string[] | null | undefined,
): Record<string, unknown> {
  if (!raw) return {};
  if (capabilities?.includes('view:raw_attributes')) return raw;
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (!SECRET_ATTRIBUTES.has(name.toLowerCase())) out[name] = value;
  }
  return out;
}
