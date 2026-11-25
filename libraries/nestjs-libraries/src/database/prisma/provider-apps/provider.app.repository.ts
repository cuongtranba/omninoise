import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { AuthService } from '@gitroom/helpers/auth/auth.service';

@Injectable()
export class ProviderAppRepository {
  constructor(private _providerApp: PrismaRepository<'providerApp'>) {}

  getApps(org: string) {
    return this._providerApp.model.providerApp.findMany({
      where: { organizationId: org, deletedAt: null },
      select: {
        id: true,
        family: true,
        clientId: true,
        updatedAt: true,
        // the live channels connected through the app
        _count: { select: { integrations: { where: { deletedAt: null } } } },
      },
    });
  }

  getApp(org: string, family: string) {
    return this._providerApp.model.providerApp.findFirst({
      where: { organizationId: org, family, deletedAt: null },
      select: {
        id: true,
        clientId: true,
        _count: { select: { integrations: { where: { deletedAt: null } } } },
      },
    });
  }

  // The only read of the secret, still encrypted
  getCredentials(org: string, id: string) {
    return this._providerApp.model.providerApp.findFirst({
      where: { id, organizationId: org, deletedAt: null },
      select: { family: true, clientId: true, clientSecret: true },
    });
  }

  // No secret keeps the stored one, so the app must exist and be live
  updateClientId(org: string, family: string, clientId: string) {
    return this._providerApp.model.providerApp.update({
      where: { organizationId_family: { organizationId: org, family } },
      data: { clientId },
      select: { id: true },
    });
  }

  // Saving a deleted app restores it
  saveApp(org: string, family: string, clientId: string, clientSecret: string) {
    const encrypted = AuthService.fixedEncryption(clientSecret);

    return this._providerApp.model.providerApp.upsert({
      where: { organizationId_family: { organizationId: org, family } },
      create: {
        organizationId: org,
        family,
        clientId,
        clientSecret: encrypted,
      },
      update: { clientId, clientSecret: encrypted, deletedAt: null },
      select: { id: true },
    });
  }

  deleteApp(org: string, family: string) {
    return this._providerApp.model.providerApp.update({
      where: { organizationId_family: { organizationId: org, family } },
      data: { deletedAt: new Date(), clientSecret: '' },
      select: { id: true },
    });
  }
}
