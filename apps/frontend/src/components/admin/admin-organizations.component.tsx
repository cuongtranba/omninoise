'use client';

import React, { FC, useCallback, useState } from 'react';
import useSWR from 'swr';
import { Link } from 'react-router';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { Button } from '@gitroom/react/form/button';
import { formatDate } from '@gitroom/frontend/components/layout/set.timezone';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import {
  ADMIN_INPUT_CLASS,
  AdminBadge,
  AdminPage,
  AdminPagination,
  readAdminError,
} from '@gitroom/frontend/components/admin/admin.shared';

interface AdminOrganizationRow {
  id: string;
  name: string;
  createdAt: string;
  deletedAt: string | null;
  tier: string | null;
  ownerEmail: string | null;
  members: number;
}

type DeletedFilter = 'false' | 'true' | 'all';

const LIMIT = 20;

const useAdminOrganizations = (params: {
  search: string;
  page: number;
  deleted: DeletedFilter;
}) => {
  const fetch = useFetch();
  const query = new URLSearchParams({
    page: String(params.page),
    limit: String(LIMIT),
    ...(params.search ? { search: params.search } : {}),
    ...(params.deleted === 'all' ? {} : { deleted: params.deleted }),
  });
  return useSWR<AdminPage<AdminOrganizationRow>>(
    `/admin/organizations?${query.toString()}`,
    async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(
          await readAdminError(res, 'Failed to load organizations')
        );
      }
      return res.json();
    }
  );
};

export const AdminOrganizationsComponent: FC = () => {
  const user = useUser();

  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [deleted, setDeleted] = useState<DeletedFilter>('false');

  const { data, isLoading, error } = useAdminOrganizations({
    search,
    page,
    deleted,
  });

  const onApplySearch = useCallback(() => {
    setPage(0);
    setSearch(searchInput.trim());
  }, [searchInput]);

  const onClear = useCallback(() => {
    setPage(0);
    setSearch('');
    setSearchInput('');
    setDeleted('false');
  }, []);

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
        <div className="text-[20px] font-[600]">Organizations</div>
        <div className="text-[13px] opacity-70">
          {data ? `${data.total} total` : ''}
        </div>
      </div>

      <div className="flex flex-wrap gap-[12px] items-end bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[12px]">
        <div className="flex flex-col gap-[6px]">
          <div className="text-[12px] opacity-70">Name contains</div>
          <div className="flex gap-[8px]">
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onApplySearch();
              }}
              placeholder="Organization name"
              className={`${ADMIN_INPUT_CLASS} min-w-[240px]`}
            />
            <Button onClick={onApplySearch}>Apply</Button>
          </div>
        </div>

        <div className="flex flex-col gap-[6px]">
          <div className="text-[12px] opacity-70">Status</div>
          <select
            value={deleted}
            onChange={(e) => {
              setPage(0);
              setDeleted(e.target.value as DeletedFilter);
            }}
            className={`${ADMIN_INPUT_CLASS} min-w-[160px]`}
          >
            <option value="false">Active</option>
            <option value="true">Deleted</option>
            <option value="all">All</option>
          </select>
        </div>

        <Button secondary onClick={onClear}>
          Clear filters
        </Button>
      </div>

      {isLoading ? (
        <LoadingComponent />
      ) : error ? (
        <div className="text-red-400">
          {error instanceof Error
            ? error.message
            : 'Failed to load organizations.'}
        </div>
      ) : !data || data.items.length === 0 ? (
        <div className="opacity-70">No organizations found.</div>
      ) : (
        <div className="border border-newTableBorder rounded-[8px] overflow-x-auto">
          <div className="min-w-[900px]">
            <div className="grid grid-cols-[1.4fr_1.4fr_90px_110px_130px] gap-[12px] px-[12px] py-[10px] bg-newBgColorInner text-[12px] uppercase opacity-70 border-b border-newTableBorder">
              <div>Name</div>
              <div>Owner</div>
              <div>Members</div>
              <div>Tier</div>
              <div>Created</div>
            </div>
            {data.items.map((row) => (
              <div
                key={row.id}
                className="grid grid-cols-[1.4fr_1.4fr_90px_110px_130px] gap-[12px] px-[12px] py-[10px] text-[13px] border-b border-newTableBorder last:border-b-0 items-center"
              >
                <div className="flex flex-wrap items-center gap-[6px] break-all">
                  <Link
                    to={`/admin/organizations/${row.id}`}
                    className="underline"
                  >
                    {row.name}
                  </Link>
                  {!!row.deletedAt && (
                    <AdminBadge tone="danger">Deleted</AdminBadge>
                  )}
                </div>
                <div className="break-all">{row.ownerEmail || '—'}</div>
                <div>{row.members}</div>
                <div>{row.tier || '—'}</div>
                <div className="opacity-90">
                  {formatDate(row.createdAt, 'date')}
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
