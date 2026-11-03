import type { User } from '@prisma/client';
import type { RequestOrganization } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';

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
