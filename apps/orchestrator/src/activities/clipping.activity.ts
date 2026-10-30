import { Injectable } from '@nestjs/common';
import { ClippingService } from '@gitroom/nestjs-libraries/database/prisma/clipping/clipping.service';

// An activity on main can never change its parameters, so every one takes a
// single object of ids: the state lives on the clipping records, and a field
// can be added to the object without a new activity
@Injectable()
export class ClippingActivity {
  constructor(private _clippingService: ClippingService) {}

  async submitClippingAnalyse({ clippingId }: { clippingId: string }) {
    return this._clippingService.submitAnalyse(clippingId);
  }

  async checkClippingAnalyse({
    clippingId,
    jobId,
  }: {
    clippingId: string;
    jobId: string;
  }) {
    return this._clippingService.checkAnalyse(clippingId, jobId);
  }

  async transcribeClipping({ clippingId }: { clippingId: string }) {
    return this._clippingService.transcribe(clippingId);
  }

  async pickClippingClips({ clippingId }: { clippingId: string }) {
    return this._clippingService.pickClips(clippingId);
  }

  async submitClipFetch({ clipId }: { clipId: string }) {
    return this._clippingService.submitClipFetch(clipId);
  }

  async checkClipFetch({ clipId, jobId }: { clipId: string; jobId: string }) {
    return this._clippingService.checkClipFetch(clipId, jobId);
  }

  async captionClip({ clipId }: { clipId: string }) {
    return this._clippingService.captionClip(clipId);
  }

  async submitClipRender({ clipId }: { clipId: string }) {
    return this._clippingService.submitClipRender(clipId);
  }

  async checkClipRender({ clipId, jobId }: { clipId: string; jobId: string }) {
    return this._clippingService.checkClipRender(clipId, jobId);
  }

  // "customer" says the error was written for the customer to read
  async failClip({
    clipId,
    error,
    customer,
  }: {
    clipId: string;
    error: string;
    customer?: boolean;
  }) {
    return this._clippingService.failClip(clipId, error, customer);
  }

  async createClippingDrafts({ clippingId }: { clippingId: string }) {
    return this._clippingService.createDrafts(clippingId);
  }

  async finishClipping({ clippingId }: { clippingId: string }) {
    return this._clippingService.finishClipping(clippingId);
  }

  async failClipping({
    clippingId,
    error,
    customer,
  }: {
    clippingId: string;
    error: string;
    customer?: boolean;
  }) {
    return this._clippingService.failClipping(clippingId, error, customer);
  }
}
