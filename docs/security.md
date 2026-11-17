# Security

OpenADUC sits in front of Active Directory and writes to it on behalf of operators. The threat surface is "an attacker who can get a session as an OpenADUC admin can do anything that admin can do in AD." Everything below is in service of narrowing that surface.

This document is a high-level summary. Implementation details are in [`apps/api/src/services/`](../apps/api/src/services), [`apps/api/src/plugins/auth.ts`](../apps/api/src/plugins/auth.ts), and [`apps/api/src/lib/encryption.ts`](../apps/api/src/lib/encryption.ts).

## Threat model summary

- **In scope.** Privilege escalation by authenticated users, capability bypass, session theft, audit tampering, secrets extraction from the database, write-as-user impersonation.
- **Out of scope.** Compromise of the host operating system, compromise of the domain controller itself, denial of service, social engineering, and physical security. The dev-mode Samba container shipped for local development is explicitly **not hardened** and should never be used in production.

## Authentication

Operators sign in with their Active Directory username and password. The API performs a live LDAPS bind against a domain controller — there is no in-app password store and no local recovery account: if the directory link is broken, nobody can sign in until it is repaired.

A refused sign-in gets one generic message whatever the reason (unknown user, wrong password, disabled, locked, expired); the reason is recorded in the audit trail only.

The first-run wizard makes the account that completes step 1 the first administrator. That account must be a member of the directory's administrators group (`Domain Admins` unless another group was configured); any other domain account is refused.

## Sessions

Successful sign-in mints an `admin_sessions` row and a cookie holding a random 256-bit token; only its SHA-256 is stored. The cookie is `HttpOnly`, `Secure` in production and `SameSite=Lax`. It is not signed: `SESSION_COOKIE_SECRET` is required by the configuration but not used for the cookie, and rotating it does not end sessions — revoke them instead.

The session stores a **snapshot** of the operator's capabilities. It is taken at sign-in and taken again at every step-up from the groups that bind reads; an operator who no longer has any capability is signed out at that point. Between the two, group changes do not take effect.

Two timeouts apply. Their values are application settings (`session.idle_timeout_minutes`, `session.absolute_timeout_hours`, changed under Settings); the `SESSION_*` environment variables are not read.

- **Idle timeout** (default 60 min) — sliding window, refreshed on every authenticated request.
- **Absolute timeout** (default 12 h) — hard cap from sign-in regardless of activity. Step-up rotates the session token but keeps this expiry.

## Capabilities

Authorization is capability-based, not role-based at the call site. Routes declare the capability they need (`app.requireCapability('write:user.resetPassword')`) and the auth plugin checks the actor's snapshot. Roles (`admin`, `operator`, `auditor`) are convenience bundles defined in [`packages/shared/src/capabilities.ts`](../packages/shared/src/capabilities.ts) — adding a role is a config change, not a code change.

The capability set is intentionally fine-grained (`read:user`, `write:user.resetPassword`, `write:user.unlock`, `write:user.attributes`, `write:group.membership`, `configure:directory`, `view:audit`, `view:raw_attributes`, etc.) so that giving someone "the ability to unlock accounts" doesn't also give them "the ability to reset passwords."

A failed capability check returns 403 and writes an `authz.deny` row to the audit log with the required capability, the actor, and the request correlation id.

Capabilities are checked on the server for every route. `view:raw_attributes` governs the secret-bearing raw attributes (LAPS passwords, BitLocker recovery keys, password material): they are left out of user and computer responses for sessions without it.

Multi-directory installations: a directory id in the URL is not compared with the directory of the session, so an administrator of one directory can configure another, and audit queries are not filtered by directory. With a single directory this has no effect.

## Step-up authentication

Mutating routes require **step-up auth**: the operator re-enters their AD password, the API rebinds against the directory, and on success mints an `elevated_sessions` row with a short TTL (application setting `session.step_up_ttl_minutes`, default 60 min). Directory writes, security settings, directory configuration changes, the service-account test bind and sync resets all require it; read routes and scheduled sync runs do not. A route that needs step-up answers 403 with code `step_up_required`.

The elevated session records the write capabilities the operator holds; route checks use the session's capability snapshot.

The operator's password is held only in process memory in `CredentialCacheService`. It lives in a `Buffer` that is zeroed on eviction, expires at the elevated session TTL, and is never written to disk or the database. An API restart wipes all cached passwords, forcing re-step-up — which is intentional.

This is what enables **write-as-user**: every AD modification is bound as the operator, not as a shared service account, so AD's own audit log attributes the change to the right human.

## Audit

Every directory write, successful or failed, produces an `audit_events` row, and the write fails if the row cannot be stored. Sign-in, step-up and configuration events are recorded too, but best-effort: if that insert fails the action still goes through and the failure is logged. Reads are recorded only where an audit setting enables it (account views on by default, searches off).

The table is append-only at the database level: a trigger rejects `UPDATE`, `DELETE`, and `TRUNCATE`. The application and its migrations use the same database role, so this stops accidents and casual tampering but not an attacker who controls the application, who could drop the trigger.

Each row captures: action, actor, target type and id, before/after JSON snapshots, source IP, user agent, session id, correlation id, error code, and arbitrary metadata. Keys matching a sensitive-key allowlist (`password`, `secret`, `token`, etc.) are auto-redacted to `[REDACTED]` before insert.

Audit retention is unbounded by default. Operators can prune older rows out-of-band if needed, but the application will not.

## Encryption at rest

Secrets stored in Postgres are encrypted with **AES-256-GCM** using `ENCRYPTION_KEY`. Affected fields:

- `directory_providers.bind_secret_encrypted` — service account password.
- `directory_entra_integrations.client_secret_encrypted` — Entra app secret (when configured).
- `directory_entra_integrations.teams_webhook_url_encrypted` — Teams webhook URLs.

Ciphertexts are stored as `v1.<iv-b64url>.<ct-b64url>.<tag-b64url>`. The version prefix lets us migrate to a new construction or key without breaking older rows. Losing `ENCRYPTION_KEY` makes these rows undecryptable; **back it up alongside your database backups**.

The operator step-up password is **never** encrypted to disk — it only lives in process memory.

## AD-specific risks

Some risks are inherent to writing to AD; OpenADUC mitigates them but cannot eliminate them.

- **Account lockouts via `lockoutTime` writes.** OpenADUC's unlock endpoint zeroes `lockoutTime` rather than incrementing `badPwdCount`. A buggy or malicious caller using raw attribute write would still be capability-gated by `write:user.attributes` and audit-logged.
- **Password reset replication delay.** A password reset against one DC may take seconds to replicate; the API does not poll for replication. The audit row records which DC was written to.
- **Service account scope.** The bootstrap service account only needs read for sync. Write capabilities (`User-Force-Change-Password`, `Reset Password`, `Account Restrictions`) should be **delegated on the OUs you intend to manage**, not granted forest-wide. The setup wizard's documentation links walk through the recommended delegations.
- **LDAPS certificate validation.** Production deployments must keep `AD_TLS_REJECT_UNAUTHORIZED=1` (the setup wizard's default) and, when the domain controllers use the domain's own CA, point `AD_TLS_CA_PATH` at that CA certificate. Turning verification off (only valid for the local Samba dev container) lets anyone between OpenADUC and the domain controller impersonate it: they would receive every password typed into OpenADUC and could answer sign-ins as any administrator.
- **Client addresses.** Rate limits, sign-in backoff and the audit trail use the client address from `X-Forwarded-For`, believing `TRUST_PROXY_HOPS` proxies (default 2: Caddy and the web container's nginx). Set it to the number of proxies actually in front of the API.

## Reporting a vulnerability

Please report security issues privately — see [SECURITY.md](../SECURITY.md). Do not open a public GitHub issue.
