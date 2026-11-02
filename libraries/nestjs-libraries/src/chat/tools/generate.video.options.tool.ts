import {
  AgentToolInterface,
} from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import { getValidationSchemas } from '@gitroom/nestjs-libraries/chat/validation.schemas.helper';
import { VideoManager } from '@gitroom/nestjs-libraries/videos/video.manager';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import z from 'zod';
import { Organization } from '@prisma/client';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

@Injectable()
export class GenerateVideoOptionsTool implements AgentToolInterface {
  constructor(
    private _videoManagerService: VideoManager,
    private _mediaService: MediaService
  ) {}
  name = 'generateVideoOptions';
  mirrors = [
    'GET /media/video-options',
    'GET /media/generate-video/:type/allowed',
  ];

  run() {
    return createTool({
      id: 'generateVideoOptions',
      description: `All the options to generate videos, some tools might require another call to generateVideoFunction.
                    Every option says whether this account may use it now: "allowed" is false (with the reason in "notAllowedReason") for the videos that are not available in the trial.`,
      inputSchema: z.object({
        reasoning: z
          .string()
          .optional()
          .describe(
            'Optional short reason for why you are listing the video generation options'
          ),
      }),
      mcp: {
        annotations: {
          title: 'List Video Generation Options',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      outputSchema: z.object({
        video: z.array(
          z.object({
            type: z.string(),
            output: z.string(),
            tools: z.array(
              z.object({
                functionName: z.string(),
                output: z.string(),
              })
            ),
            customParams: z.any(),
            allowed: z.boolean().optional(),
            notAllowedReason: z.string().optional(),
          })
        ),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const org = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        );
        const videos = this._videoManagerService.getAllVideos();
        return {
          video: await Promise.all(
            videos.map(async (p) => ({
              type: p.identifier,
              output: 'vertical|horizontal',
              tools: p.tools,
              customParams: getValidationSchemas()[p.dto.name],
              ...(await this.allowed(org, p.identifier)),
            }))
          ),
        };
      },
    });
  }

  // the same check as GET /media/generate-video/:type/allowed
  private async allowed(org: Organization, type: string) {
    try {
      return {
        allowed: await this._mediaService.generateVideoAllowed(org, type),
      };
    } catch (err) {
      return {
        allowed: false,
        notAllowedReason: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
