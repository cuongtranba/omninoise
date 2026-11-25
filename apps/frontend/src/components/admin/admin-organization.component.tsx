'use client';

import React, { FC, useCallback, useState } from 'react';
import { Link } from 'react-router';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { Button } from '@gitroom/react/form/button';
import { Select } from '@gitroom/react/form/select';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { formatDate } from '@gitroom/frontend/components/layout/set.timezone';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import {
  ADMIN_INPUT_CLASS,
  ADMIN_ROLES,
  AdminBadge,
  AdminOrganizationMember,
  AdminRole,
  readAdminError,
  useAdminOrganization,
} from '@gitroom/frontend/components/admin/admin.shared';

const DISABLED_MEMBERSHIP_HINT =
  'A plan change can re-enable a disabled membership; block the account on the Users page for a durable block.';

const AddMemberModal: FC<{
  organizationId: string;
  close: () => void;
  onAdded: () => Promise<unknown>;
}> = ({ organizationId, close, onAdded }) => {
  const fetch = useFetch();
  const toaster = useToaster();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AdminRole>('USER');
  const [saving, setSaving] = useState(false);

  const submit = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch(
        `/admin/organizations/${organizationId}/members`,
        {
          method: 'POST',
          body: JSON.stringify({ email: email.trim(), role }),
        }
      );
      if (!res.ok) {
        toaster.show(
          await readAdminError(res, 'Could not add the member'),
          'warning'
        );
        return;
      }
      toaster.show('Member added', 'success');
      await onAdded();
      close();
    } finally {
      setSaving(false);
    }
  }, [fetch, toaster, organizationId, email, role, close, onAdded]);

  return (
    <div className="flex flex-col gap-[10px] min-w-[400px]">
      <div className="flex flex-col gap-[6px]">
        <div className="text-[14px]">Email</div>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="user@example.com"
          className={ADMIN_INPUT_CLASS}
        />
      </div>
      <Select
        label="Role"
        name="role"
        disableForm={true}
        hideErrors={true}
        value={role}
        onChange={(e) => setRole(e.target.value as AdminRole)}
      >
        {ADMIN_ROLES.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </Select>
      <Button
        onClick={submit}
        loading={saving}
        disabled={!email.trim()}
        className="rounded-[4px]"
      >
        Add member
      </Button>
    </div>
  );
};

const Field: FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <div>
    <div className="opacity-60 text-[12px]">{label}</div>
    <div className="text-[14px] break-all">{children}</div>
  </div>
);

export const AdminOrganizationComponent: FC<{ id: string }> = ({ id }) => {
  const user = useUser();
  const fetch = useFetch();
  const toaster = useToaster();
  const modals = useModals();
  const [busy, setBusy] = useState(false);

  const { data, isLoading, error, mutate } = useAdminOrganization(id);

  // Runs one write, shows the server error when it fails and refreshes the
  // organization when it succeeds
  const write = useCallback(
    async (
      request: () => Promise<Response>,
      fallback: string,
      success: string
    ) => {
      setBusy(true);
      try {
        const res = await request();
        if (!res.ok) {
          toaster.show(await readAdminError(res, fallback), 'warning');
          return false;
        }
        toaster.show(success, 'success');
        await mutate();
        return true;
      } finally {
        setBusy(false);
      }
    },
    [toaster, mutate]
  );

  const updateMember = useCallback(
    (
      member: AdminOrganizationMember,
      body: { role?: AdminRole; disabled?: boolean }
    ) =>
      write(
        () =>
          fetch(`/admin/organizations/${id}/members/${member.userId}`, {
            method: 'PUT',
            body: JSON.stringify(body),
          }),
        'Could not update the member',
        'Member updated'
      ),
    [fetch, write, id]
  );

  const removeMember = useCallback(
    (member: AdminOrganizationMember) => async () => {
      if (
        !(await deleteDialog(
          `${member.email} will lose access to this organization.`,
          'Yes, remove',
          'Remove member?',
          'No, cancel',
          true
        ))
      ) {
        return;
      }
      await write(
        () =>
          fetch(`/admin/organizations/${id}/members/${member.userId}`, {
            method: 'DELETE',
          }),
        'Could not remove the member',
        'Member removed'
      );
    },
    [fetch, write, id]
  );

  const addMember = useCallback(() => {
    modals.openModal({
      title: 'Add member',
      children: (close) => (
        <AddMemberModal organizationId={id} close={close} onAdded={mutate} />
      ),
    });
  }, [modals, id, mutate]);

  const deleteOrganization = useCallback(async () => {
    if (
      !(await deleteDialog(
        'The organization will be deleted and its enabled channels will be disabled. Restoring the organization restores those channels.',
        'Yes, delete it',
        'Delete organization?',
        'No, cancel',
        true
      ))
    ) {
      return;
    }
    await write(
      () => fetch(`/admin/organizations/${id}`, { method: 'DELETE' }),
      'Could not delete the organization',
      'Organization deleted'
    );
  }, [fetch, write, id]);

  const restoreOrganization = useCallback(
    () =>
      write(
        () => fetch(`/admin/organizations/${id}/restore`, { method: 'POST' }),
        'Could not restore the organization',
        'Organization restored'
      ),
    [fetch, write, id]
  );

  const openAsOwner = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch('/user/change-org', {
        method: 'POST',
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        toaster.show(
          await readAdminError(res, 'Could not open the organization'),
          'warning'
        );
        return;
      }
      window.location.href = '/launches';
    } finally {
      setBusy(false);
    }
  }, [fetch, toaster, id]);

  if (!user?.isSuperAdmin) {
    return (
      <div className="text-textColor p-[20px]">
        You do not have access to this page.
      </div>
    );
  }

  if (isLoading) {
    return <LoadingComponent />;
  }

  if (error || !data) {
    return (
      <div className="flex flex-col gap-[12px] text-textColor">
        <Link to="/admin/organizations" className="underline text-[13px]">
          Back to organizations
        </Link>
        <div className="text-red-400">
          {error instanceof Error
            ? error.message
            : 'Failed to load the organization.'}
        </div>
      </div>
    );
  }

  const { organization, subscription, owner, users, members } = data;
  const isDeleted = !!organization.deletedAt;

  return (
    <div className="flex flex-col gap-[16px] text-textColor">
      <Link to="/admin/organizations" className="underline text-[13px]">
        Back to organizations
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-[12px]">
        <div className="flex items-center gap-[10px]">
          <div className="text-[20px] font-[600] break-all">
            {organization.name}
          </div>
          {isDeleted && <AdminBadge tone="danger">Deleted</AdminBadge>}
        </div>
        <div className="flex gap-[8px]">
          {!isDeleted && (
            <Button secondary loading={busy} onClick={openAsOwner}>
              Open as owner
            </Button>
          )}
          {isDeleted ? (
            <Button loading={busy} onClick={restoreOrganization}>
              Restore organization
            </Button>
          ) : (
            <Button loading={busy} onClick={deleteOrganization}>
              Delete organization
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 mobile:grid-cols-1 gap-[12px] bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[12px]">
        <Field label="Id">{organization.id}</Field>
        <Field label="Created">
          {formatDate(organization.createdAt, 'dateTime')}
        </Field>
        <Field label="Status">
          {isDeleted
            ? `Deleted ${formatDate(organization.deletedAt, 'dateTime')}`
            : 'Active'}
        </Field>
        <Field label="Owner">{owner?.email || '—'}</Field>
        <Field label="Subscription">
          {subscription
            ? `${subscription.subscriptionTier} (${subscription.period}${
                subscription.isLifetime ? ', lifetime' : ''
              }), ${subscription.totalChannels} channels${
                subscription.cancelAt
                  ? `, cancels ${formatDate(subscription.cancelAt, 'date')}`
                  : ''
              }`
            : 'None'}
        </Field>
        <Field label="Trial">
          {organization.isTrailing
            ? 'In trial'
            : organization.allowTrial
              ? 'Trial available'
              : 'No trial'}
        </Field>
        <Field label="Members">
          {`${users.total} total, ${users.activated} activated, ${users.disabled} disabled`}
        </Field>
        <Field label="Last online">
          {users.lastOnlineMax
            ? formatDate(users.lastOnlineMax, 'dateTime')
            : '—'}
        </Field>
      </div>

      <div className="flex items-center justify-between">
        <div className="text-[16px] font-[600]">Members</div>
        <Button onClick={addMember}>Add member</Button>
      </div>

      <div className="border border-newTableBorder rounded-[8px] overflow-x-auto">
        <div className="min-w-[900px]">
          <div className="grid grid-cols-[1.6fr_1fr_160px_130px_100px] gap-[12px] px-[12px] py-[10px] bg-newBgColorInner text-[12px] uppercase opacity-70 border-b border-newTableBorder">
            <div>Email</div>
            <div>Name</div>
            <div>Role</div>
            <div>Membership</div>
            <div className="text-right">Actions</div>
          </div>
          {members.map((member) => (
            <div
              key={member.userId}
              className="grid grid-cols-[1.6fr_1fr_160px_130px_100px] gap-[12px] px-[12px] py-[10px] text-[13px] border-b border-newTableBorder last:border-b-0 items-center"
            >
              <div className="flex flex-wrap items-center gap-[6px] break-all">
                <span>{member.email}</span>
                {!!member.accountDisabledAt && (
                  <AdminBadge tone="danger">Account blocked</AdminBadge>
                )}
              </div>
              <div className="break-all">{member.name || '—'}</div>
              <Select
                label=""
                name={`role-${member.userId}`}
                disableForm={true}
                hideErrors={true}
                className="!h-[34px]"
                disabled={busy}
                value={member.role}
                onChange={(e) =>
                  updateMember(member, { role: e.target.value as AdminRole })
                }
              >
                {ADMIN_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
              <label
                className="flex items-center gap-[6px] cursor-pointer"
                title={DISABLED_MEMBERSHIP_HINT}
              >
                <input
                  type="checkbox"
                  title={DISABLED_MEMBERSHIP_HINT}
                  disabled={busy}
                  checked={member.disabled}
                  onChange={(e) =>
                    updateMember(member, { disabled: e.target.checked })
                  }
                />
                Disabled
              </label>
              <div className="flex justify-end">
                <Button
                  secondary
                  disabled={busy}
                  onClick={removeMember(member)}
                  className="!h-[34px] !px-[12px]"
                >
                  Remove
                </Button>
              </div>
            </div>
          ))}
          {members.length === 0 && (
            <div className="px-[12px] py-[10px] opacity-70 text-[13px]">
              No members.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
