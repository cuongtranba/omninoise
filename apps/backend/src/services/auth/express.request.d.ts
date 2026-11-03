import type { Organization, Role, User } from '@prisma/client';

// The organization the auth middlewares attach to the request: the full
// organization for a signed-in user or an API key, only its id for the widget
// tickets. users[0].role is the role of the caller in that organization.
export type RequestOrganization = Pick<Organization, 'id'> &
  Partial<Organization> & {
    users?: { role: Role; disabled?: boolean }[];
  };

declare global {
  namespace Express {
    interface Request {
      user?: User;
      org?: RequestOrganization;
      isOAuthApp?: boolean;
      oauthUserId?: string;
      authOrgId?: string;
      includeDeleted?: boolean;
      clippingId?: string;
      uploadSession?: string;
    }
  }
}
