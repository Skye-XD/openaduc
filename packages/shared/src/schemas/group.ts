// SPDX-License-Identifier: BUSL-1.1
import { z } from 'zod';

export const groupSummarySchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  samAccountName: z.string().nullable(),
  distinguishedName: z.string(),
  description: z.string().nullable(),
  groupType: z.string().nullable(),
  groupScope: z.string().nullable(),
  memberCount: z.number().int(),
});
export type GroupSummary = z.infer<typeof groupSummarySchema>;

export const groupSearchQuerySchema = z.object({
  q: z.string().max(256).optional(),
  type: z.enum(['security', 'distribution']).optional(),
  scope: z.enum(['global', 'domain-local', 'universal']).optional(),
  hasMembers: z.enum(['yes', 'no']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  // Cap raised to 50_000 so the web client can load the full dataset
  // in one request and filter/sort entirely in the browser.
  pageSize: z.coerce.number().int().min(1).max(50_000).default(50),
  sort: z
    .enum(['name', 'samAccountName', 'memberCount', 'groupType', 'groupScope'])
    .default('name'),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
});
export type GroupSearchQuery = z.infer<typeof groupSearchQuerySchema>;

export const groupSearchResponseSchema = z.object({
  rows: z.array(groupSummarySchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type GroupSearchResponse = z.infer<typeof groupSearchResponseSchema>;

export const groupMemberSchema = z.object({
  id: z.string(),
  samAccountName: z.string(),
  userPrincipalName: z.string().nullable(),
  displayName: z.string().nullable(),
  email: z.string().nullable(),
  enabled: z.boolean(),
  locked: z.boolean(),
  passwordNeverExpires: z.boolean(),
});
export type GroupMember = z.infer<typeof groupMemberSchema>;

export const groupDetailSchema = groupSummarySchema.extend({
  email: z.string().nullable(),
  members: z.array(groupMemberSchema),
  freshness: z.object({
    cachedAt: z.string().nullable(),
    liveRefreshedAt: z.string().nullable(),
  }),
});
export type GroupDetail = z.infer<typeof groupDetailSchema>;

// ---- Create group --------------------------------------------------------
export const groupCreateRequestSchema = z.object({
  // Target OU DN; validated against the cached directory_ous table server-side.
  parentDn: z.string().min(1).max(1024),
  // The group's name (CN / RDN). Reject DN-reserved characters.
  name: z
    .string()
    .trim()
    .min(1, 'name is required')
    .max(64, 'name is too long')
    .regex(/^[^,=+<>#;\\"]+$/, 'name contains a reserved character'),
  // sAMAccountName — no whitespace or AD-reserved characters.
  samAccountName: z
    .string()
    .trim()
    .min(1, 'logon name is required')
    .max(64, 'logon name is too long')
    .regex(/^[^\s"[\]:;|=+*?<>/\\,]+$/, 'logon name contains a reserved character'),
  description: z
    .string()
    .trim()
    .max(1024)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  scope: z.enum(['global', 'domainLocal', 'universal']).default('global'),
  category: z.enum(['security', 'distribution']).default('security'),
});
export type GroupCreateRequest = z.infer<typeof groupCreateRequestSchema>;

export const groupCreateResponseSchema = z.object({
  ok: z.boolean(),
  id: z.string(),
  distinguishedName: z.string(),
  samAccountName: z.string(),
});
export type GroupCreateResponse = z.infer<typeof groupCreateResponseSchema>;
