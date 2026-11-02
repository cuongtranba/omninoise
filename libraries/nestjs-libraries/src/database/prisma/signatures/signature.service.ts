import { Injectable, NotFoundException } from '@nestjs/common';
import { SignatureRepository } from '@gitroom/nestjs-libraries/database/prisma/signatures/signature.repository';
import { SignatureDto } from '@gitroom/nestjs-libraries/dtos/signature/signature.dto';

@Injectable()
export class SignatureService {
  constructor(private _signatureRepository: SignatureRepository) {}

  getSignaturesByOrgId(orgId: string) {
    return this._signatureRepository.getSignaturesByOrgId(orgId);
  }

  getDefaultSignature(orgId: string) {
    return this._signatureRepository.getDefaultSignature(orgId);
  }

  async createOrUpdateSignature(
    orgId: string,
    signature: SignatureDto,
    id?: string
  ) {
    // an update only changes a signature of this organization, it never saves
    // a new one for an id it does not know
    if (
      id &&
      !(await this.getSignaturesByOrgId(orgId)).some((s) => s.id === id)
    ) {
      throw new NotFoundException('The signature was not found');
    }

    return this._signatureRepository.createOrUpdateSignature(
      orgId,
      signature,
      id
    );
  }

  deleteSignature(orgId: string, id: string) {
    return this._signatureRepository.deleteSignature(orgId, id);
  }
}
