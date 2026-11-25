import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ProviderAppRepository } from '@gitroom/nestjs-libraries/database/prisma/provider-apps/provider.app.repository';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { runWithProviderApp } from '@gitroom/nestjs-libraries/integrations/provider.app.context';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { Disconnect } from '@gitroom/nestjs-libraries/integrations/social.abstract';

// The app a channel or a connect link was bound to is gone. Its token only
// works with that app, so like any Disconnect the channel is flagged for a
// reconnect and the organization is told.
export class ProviderAppNotFound extends Disconnect {
  constructor() {
    super(
      'provider-app',
      '{}',
      '{}',
      'The app this channel connects through was removed, please connect the channel again'
    );
  }
}

@Injectable()
export class ProviderAppService {
  constructor(
    private _providerAppRepository: ProviderAppRepository,
    private _integrationManager: IntegrationManager
  ) {}

  /**
   * Runs provider calls with the app a channel (or a connect) is bound to, or
   * with the server's app when `providerAppId` is empty. Every provider call
   * for an existing channel goes through here: its token only works with the
   * app that issued it. The app is loaded by organization too, so one
   * organization can never sign with another one's app.
   */
  async run<T>(
    // required, so a caller whose `select` lacks the column does not compile
    bound: { organizationId: string; providerAppId: string | null },
    fn: () => Promise<T>
  ): Promise<T> {
    if (!bound.providerAppId) {
      return runWithProviderApp(undefined, fn);
    }

    const app = await this._providerAppRepository.getCredentials(
      bound.organizationId,
      bound.providerAppId
    );
    if (!app) {
      throw new ProviderAppNotFound();
    }

    return runWithProviderApp(
      {
        family: app.family,
        clientId: app.clientId,
        clientSecret: AuthService.fixedDecryption(app.clientSecret),
      },
      fn
    );
  }

  // The app a new channel of `identifier` connects through: the
  // organization's own one for the provider's family, or null for the server's
  async currentAppId(org: string, identifier: string) {
    const family = this._integrationManager.getOwnAppFamily(identifier);
    if (!family) {
      return null;
    }

    return (await this._providerAppRepository.getApp(org, family))?.id || null;
  }

  async list(org: string) {
    const apps = await this._providerAppRepository.getApps(org);

    return this._integrationManager.getProviderAppFamilies().map((family) => {
      const app = apps.find((a) => a.family === family.family);
      return {
        ...family,
        app: app
          ? {
              id: app.id,
              clientId: app.clientId,
              updatedAt: app.updatedAt,
              channels: app._count.integrations,
            }
          : null,
      };
    });
  }

  async save(
    org: string,
    family: string,
    body: { clientId: string; clientSecret?: string }
  ) {
    this.assertFamily(family);

    const existing = await this._providerAppRepository.getApp(org, family);
    if (!existing && !body.clientSecret) {
      throw new HttpException(
        'A client secret is required',
        HttpStatus.BAD_REQUEST
      );
    }

    // the tokens of the connected channels only work with the app that issued
    // them
    if (
      existing &&
      existing.clientId !== body.clientId &&
      existing._count.integrations
    ) {
      throw new HttpException(
        'Channels are connected through this app, delete them before changing its client ID',
        HttpStatus.CONFLICT
      );
    }

    // an empty secret keeps the stored one (`existing` is live here)
    return body.clientSecret
      ? this._providerAppRepository.saveApp(
          org,
          family,
          body.clientId,
          body.clientSecret
        )
      : this._providerAppRepository.updateClientId(org, family, body.clientId);
  }

  async delete(org: string, family: string) {
    this.assertFamily(family);

    const existing = await this._providerAppRepository.getApp(org, family);
    if (!existing) {
      throw new HttpException('App not found', HttpStatus.NOT_FOUND);
    }

    if (existing._count.integrations) {
      throw new HttpException(
        'Channels are connected through this app, delete them first',
        HttpStatus.CONFLICT
      );
    }

    return this._providerAppRepository.deleteApp(org, family);
  }

  private assertFamily(family: string) {
    if (
      !this._integrationManager
        .getProviderAppFamilies()
        .some((f) => f.family === family)
    ) {
      throw new HttpException('Unknown platform', HttpStatus.BAD_REQUEST);
    }
  }
}
