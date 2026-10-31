import { HttpException, Injectable, Logger } from '@nestjs/common';
import {
  ThirdPartyAbstract,
  ThirdPartyParams,
} from '@gitroom/nestjs-libraries/3rdparties/thirdparty.interface';
import { ModuleRef } from '@nestjs/core';
import { ThirdPartyService } from '@gitroom/nestjs-libraries/database/prisma/third-party/third-party.service';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { ImportMediaItemDto } from '@gitroom/nestjs-libraries/dtos/third-party/import-media.dto';

@Injectable()
export class ThirdPartyManager {
  private readonly _logger = new Logger(ThirdPartyManager.name);
  private storage = UploadFactory.createStorage();

  constructor(
    private _moduleRef: ModuleRef,
    private _thirdPartyService: ThirdPartyService,
    private _mediaService: MediaService
  ) {}

  getAllThirdParties(): any[] {
    return (Reflect.getMetadata('third:party', ThirdPartyAbstract) || [])
      .filter((p: any) => !p.installUrl || p.installUrl())
      .map((p: any) => ({
        identifier: p.identifier,
        title: p.title,
        description: p.description,
        fields: p.fields || [],
        installUrl: p.installUrl?.(),
      }));
  }

  checkAvailableThirdPartyFunction(method: any) {
    const thirdPartyFunction = Reflect.getMetadata(
      'third-party-function',
      method
    );
    return !thirdPartyFunction;
  }

  getThirdPartyByName(
    identifier: string
  ): (ThirdPartyParams & { instance: ThirdPartyAbstract }) | undefined {
    const thirdParty = (
      Reflect.getMetadata('third:party', ThirdPartyAbstract) || []
    ).find((p: any) => p.identifier === identifier);

    if (!thirdParty) {
      return undefined;
    }

    return { ...thirdParty, instance: this._moduleRef.get(thirdParty.target) };
  }

  deleteIntegration(org: string, id: string) {
    return this._thirdPartyService.deleteIntegration(org, id);
  }

  getIntegrationById(org: string, id: string) {
    return this._thirdPartyService.getIntegrationById(org, id);
  }

  getAllThirdPartiesByOrganization(org: string) {
    return this._thirdPartyService.getAllThirdPartiesByOrganization(org);
  }

  saveIntegration(
    org: string,
    identifier: string,
    apiKey: string,
    data: { name: string; username: string; id: string }
  ) {
    return this._thirdPartyService.saveIntegration(
      org,
      identifier,
      apiKey,
      data
    );
  }

  // the saved integrations of an organization with what their provider says
  // about itself, never the api key. A row whose provider no longer exists in
  // the code is skipped
  async getSavedThirdParties(org: string) {
    return (await this.getAllThirdPartiesByOrganization(org)).flatMap(
      (thirdParty) => {
        const provider = this.getThirdPartyByName(thirdParty.identifier);
        if (!provider) {
          return [];
        }
        const { description, fields, position, title } = provider;
        return [
          {
            ...thirdParty,
            title,
            position,
            fields,
            description,
          },
        ];
      }
    );
  }

  // a saved integration of the organization with its provider
  private async loadIntegration(org: string, id: string) {
    const thirdParty = await this.getIntegrationById(org, id);

    if (!thirdParty) {
      throw new HttpException('Integration not found', 404);
    }

    const thirdPartyInstance = this.getThirdPartyByName(thirdParty.identifier);

    if (!thirdPartyInstance) {
      throw new HttpException('Invalid identifier', 400);
    }

    return { thirdParty, thirdPartyInstance };
  }

  async submit(org: string, id: string, data: any) {
    const { thirdParty, thirdPartyInstance } = await this.loadIntegration(
      org,
      id
    );

    const loadedData = await thirdPartyInstance?.instance?.sendData(
      AuthService.fixedDecryption(thirdParty.apiKey),
      data
    );

    const file = await this.storage.uploadSimple(loadedData);
    return this._mediaService.saveFile(org, file.split('/').pop(), file);
  }

  async callFunction(org: string, id: string, functionName: string, data: any) {
    const { thirdParty, thirdPartyInstance } = await this.loadIntegration(
      org,
      id
    );

    const functionToCall = thirdPartyInstance.instance[functionName];
    if (
      typeof functionToCall !== 'function' ||
      this.checkAvailableThirdPartyFunction(functionToCall)
    ) {
      throw new HttpException('Function not found', 400);
    }

    return functionToCall.call(
      thirdPartyInstance.instance,
      AuthService.fixedDecryption(thirdParty.apiKey),
      data
    );
  }

  async importMedia(org: string, id: string, items: ImportMediaItemDto[]) {
    const { thirdParty, thirdPartyInstance } = await this.loadIntegration(
      org,
      id
    );

    const downloadUrls = await thirdPartyInstance?.instance?.['importMedia']?.(
      AuthService.fixedDecryption(thirdParty.apiKey),
      items
    );

    if (!downloadUrls || !Array.isArray(downloadUrls)) {
      throw new HttpException('Import not supported', 400);
    }

    const results = [];
    for (const item of downloadUrls) {
      const file = await this.storage.uploadSimple(item.url);
      const saved = await this._mediaService.saveFile(
        org,
        item.name || file.split('/').pop(),
        file
      );
      results.push(saved);
    }

    return results;
  }

  async connect(org: string, identifier: string, api: string) {
    const thirdParty = this.getThirdPartyByName(identifier);
    if (!thirdParty) {
      throw new HttpException('Invalid identifier', 400);
    }

    const connect = await thirdParty.instance.checkConnection(api);
    if (!connect) {
      throw new HttpException('Invalid API key', 400);
    }

    try {
      const save = await this.saveIntegration(org, identifier, api, {
        name: connect.name,
        username: connect.username,
        id: connect.id,
      });

      return {
        id: save.id,
      };
    } catch (e) {
      this._logger.error(e);
      throw new HttpException('Integration Already Exists', 400);
    }
  }
}
