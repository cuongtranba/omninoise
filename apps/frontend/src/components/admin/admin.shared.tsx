'use client';

import React, { FC } from 'react';
import useSWR from 'swr';
import { Button } from '@gitroom/react/form/button';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

export type AdminRole = 'USER' | 'ADMIN' | 'SUPERADMIN';

export const ADMIN_ROLES: AdminRole[] = ['USER', 'ADMIN', 'SUPERADMIN'];

export interface AdminPage<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

// The backend answers a failed admin call with `{ message }` (Nest exception)
// or with plain text, customFetch does not throw on HTTP errors
export const readAdminError = async (
  response: Response,
  fallback: string
): Promise<string> => {
  const text = await response.text().catch(() => '');
  try {
    const parsed: { message?: string | string[] } = JSON.parse(text);
    const message = Array.isArray(parsed.message)
      ? parsed.message.join(', ')
      : parsed.message;
    return message || fallback;
  } catch {
    return text || fallback;
  }
};

export const AdminBadge: FC<{
  children: string;
  tone?: 'danger' | 'info';
}> = ({ children, tone = 'info' }) => (
  <span
    className={`text-[11px] font-[600] px-[8px] py-[2px] rounded-[999px] whitespace-nowrap ${
      tone === 'danger' ? 'bg-red-500/20 text-red-400' : 'bg-forth/20'
    }`}
  >
    {children}
  </span>
);

export const AdminPagination: FC<{
  page: number;
  limit: number;
  total?: number;
  hasMore: boolean;
  onPage: (page: number) => void;
}> = ({ page, limit, total, hasMore, onPage }) => {
  const totalPages =
    total === undefined ? 1 : Math.max(1, Math.ceil(total / limit));
  return (
    <div className="flex items-center justify-between">
      <div className="text-[13px] opacity-70">
        Page {page + 1} of {totalPages}
      </div>
      <div className="flex gap-[8px]">
        <Button
          secondary
          disabled={page === 0}
          onClick={() => onPage(Math.max(0, page - 1))}
        >
          Previous
        </Button>
        <Button disabled={!hasMore} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
};

export const ADMIN_INPUT_CLASS =
  'bg-newBgColorInner h-[38px] border border-newTableBorder rounded-[8px] px-[10px] text-[14px] text-textColor';

export interface AdminOrganizationMember {
  userId: string;
  email: string;
  name: string | null;
  role: AdminRole;
  disabled: boolean;
  accountDisabledAt: string | null;
  createdAt: string;
}

export interface AdminOrganizationDetails {
  organization: {
    id: string;
    name: string;
    createdAt: string;
    deletedAt: string | null;
    allowTrial: boolean;
    isTrailing: boolean;
  };
  subscription: {
    subscriptionTier: string;
    period: string;
    totalChannels: number;
    isLifetime: boolean;
    cancelAt: string | null;
  } | null;
  owner: { id: string; email: string; role: AdminRole } | null;
  users: {
    total: number;
    activated: number;
    disabled: number;
    lastOnlineMax: string | null;
  };
  members: AdminOrganizationMember[];
}

export const useAdminOrganization = (id: string) => {
  const fetch = useFetch();
  return useSWR<AdminOrganizationDetails>(
    `/admin/organizations/${id}`,
    async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(
          await readAdminError(res, 'Failed to load the organization')
        );
      }
      return res.json();
    }
  );
};
