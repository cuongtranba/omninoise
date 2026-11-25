'use client';

import React, { FC, useCallback, useState } from 'react';
import useSWR from 'swr';
import { Link } from 'react-router';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/react/form/button';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { formatDate } from '@gitroom/frontend/components/layout/set.timezone';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import {
  ADMIN_INPUT_CLASS,
  AdminBadge,
  AdminPage,
  AdminPagination,
  AdminRole,
  readAdminError,
} from '@gitroom/frontend/components/admin/admin.shared';

interface AdminUserOrganization {
  id: string;
  name: string;
  role: AdminRole;
  disabled: boolean;
  deletedAt: string | null;
}

interface AdminUserRow {
  id: string;
  name: string | null;
  email: string;
  activated: boolean;
  isSuperAdmin: boolean;
  disabledAt: string | null;
  createdAt: string;
  lastOnline: string;
  organizations: AdminUserOrganization[];
}

const LIMIT = 20;

const useAdminUsers = (params: { search: string; page: number }) => {
  const fetch = useFetch();
  const query = new URLSearchParams({
    page: String(params.page),
    limit: String(LIMIT),
    ...(params.search ? { search: params.search } : {}),
  });
  return useSWR<AdminPage<AdminUserRow>>(
    `/admin/users?${query.toString()}`,
    async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(await readAdminError(res, 'Failed to load users'));
      }
      return res.json();
    }
  );
};

export const AdminUsersComponent: FC = () => {
  const user = useUser();
  const fetch = useFetch();
  const toaster = useToaster();

  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [pendingId, setPendingId] = useState('');

  const { data, isLoading, error, mutate } = useAdminUsers({ search, page });

  const onApplySearch = useCallback(() => {
    setPage(0);
    setSearch(searchInput.trim());
  }, [searchInput]);

  const onClear = useCallback(() => {
    setPage(0);
    setSearch('');
    setSearchInput('');
  }, []);

  const setAccess = useCallback(
    (row: AdminUserRow, disabled: boolean) => async () => {
      if (
        disabled &&
        !(await deleteDialog(
          `${row.email} will not be able to sign in or use any organization until the account is unblocked.`,
          'Yes, block it',
          'Block account?',
          'No, cancel',
          true
        ))
      ) {
        return;
      }
      setPendingId(row.id);
      try {
        const res = await fetch(`/admin/users/${row.id}/access`, {
          method: 'PUT',
          body: JSON.stringify({ disabled }),
        });
        if (!res.ok) {
          toaster.show(
            await readAdminError(res, 'Could not change the account access'),
            'warning'
          );
          return;
        }
        toaster.show(
          disabled ? 'Account blocked' : 'Account unblocked',
          'success'
        );
        await mutate();
      } finally {
        setPendingId('');
      }
    },
    [fetch, toaster, mutate]
  );

  if (!user?.isSuperAdmin) {
    return (
      <div className="text-textColor p-[20px]">
        You do not have access to this page.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[16px] text-textColor">
      <div className="flex items-center justify-between">
        <div className="text-[20px] font-[600]">Users</div>
        <div className="text-[13px] opacity-70">
          {data ? `${data.total} total` : ''}
        </div>
      </div>

      <div className="flex flex-wrap gap-[12px] items-end bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[12px]">
        <div className="flex flex-col gap-[6px]">
          <div className="text-[12px] opacity-70">Email or name contains</div>
          <div className="flex gap-[8px]">
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onApplySearch();
              }}
              placeholder="user@example.com"
              className={`${ADMIN_INPUT_CLASS} min-w-[280px]`}
            />
            <Button onClick={onApplySearch}>Apply</Button>
          </div>
        </div>
        <Button secondary onClick={onClear}>
          Clear filters
        </Button>
      </div>

      {isLoading ? (
        <LoadingComponent />
      ) : error ? (
        <div className="text-red-400">
          {error instanceof Error ? error.message : 'Failed to load users.'}
        </div>
      ) : !data || data.items.length === 0 ? (
        <div className="opacity-70">No users found.</div>
      ) : (
        <div className="border border-newTableBorder rounded-[8px] overflow-x-auto">
          <div className="min-w-[1100px]">
            <div className="grid grid-cols-[1.4fr_130px_150px_90px_1.6fr_110px] gap-[12px] px-[12px] py-[10px] bg-newBgColorInner text-[12px] uppercase opacity-70 border-b border-newTableBorder">
              <div>User</div>
              <div>Created</div>
              <div>Last online</div>
              <div>Activated</div>
              <div>Organizations</div>
              <div className="text-right">Actions</div>
            </div>
            {data.items.map((row) => (
              <div
                key={row.id}
                className="grid grid-cols-[1.4fr_130px_150px_90px_1.6fr_110px] gap-[12px] px-[12px] py-[10px] text-[13px] border-b border-newTableBorder last:border-b-0 items-start"
              >
                <div className="break-all">
                  <div className="flex flex-wrap items-center gap-[6px]">
                    <span>{row.email}</span>
                    {row.isSuperAdmin && <AdminBadge>Super admin</AdminBadge>}
                    {!!row.disabledAt && (
                      <AdminBadge tone="danger">Blocked</AdminBadge>
                    )}
                  </div>
                  <div className="opacity-60 text-[12px]">
                    {row.name || '—'}
                  </div>
                </div>
                <div className="opacity-90">
                  {formatDate(row.createdAt, 'date')}
                </div>
                <div className="opacity-90">
                  {formatDate(row.lastOnline, 'dateTime')}
                </div>
                <div>{row.activated ? 'Yes' : 'No'}</div>
                <div className="flex flex-col gap-[4px]">
                  {row.organizations.length === 0 && (
                    <span className="opacity-60">—</span>
                  )}
                  {row.organizations.map((org) => (
                    <div
                      key={org.id}
                      className="flex flex-wrap items-center gap-[6px]"
                    >
                      <Link
                        to={`/admin/organizations/${org.id}`}
                        className="underline break-all"
                      >
                        {org.name}
                      </Link>
                      <span className="opacity-60 text-[12px]">{org.role}</span>
                      {org.disabled && (
                        <AdminBadge tone="danger">disabled</AdminBadge>
                      )}
                      {!!org.deletedAt && (
                        <AdminBadge tone="danger">deleted</AdminBadge>
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex justify-end">
                  {row.id !== user.id &&
                    (row.disabledAt ? (
                      <Button
                        secondary
                        loading={pendingId === row.id}
                        onClick={setAccess(row, false)}
                      >
                        Unblock
                      </Button>
                    ) : (
                      <Button
                        loading={pendingId === row.id}
                        onClick={setAccess(row, true)}
                      >
                        Block
                      </Button>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <AdminPagination
        page={page}
        limit={LIMIT}
        total={data?.total}
        hasMore={!!data?.hasMore}
        onPage={setPage}
      />
    </div>
  );
};
