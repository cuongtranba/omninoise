import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import { VideoManager } from '@gitroom/nestjs-libraries/videos/video.manager';
import z from 'zod';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

@Injectable()
export class VideoFunctionTool implements AgentToolInterface {
  constructor(
    private _videoManagerService: VideoManager,
    private _mediaService: MediaService
  ) {}
  name = 'videoFunctionTool';
  mirrors = ['POST /media/video/function'];

  run() {
    return createTool({
      id: 'videoFunctionTool',
      description: `Sometimes when we want to generate videos we might need to get some additional information like voice_id, etc`,
      mcp: {
        annotations: {
          title: 'Video Function Helper',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      inputSchema: z.object({
        identifier: z.string(),
        functionName: z.string(),
        params: z
          .record(z.string(), z.any())
          .optional()
          .describe('Parameters passed to the function, if it takes any'),
      }),
      outputSchema: z.object({}).passthrough(),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const videos = this._videoManagerService.getAllVideos();
        const findVideo = videos.find(
          (p) =>
            p.identifier === inputData.identifier &&
            p.tools.some((p) => p.functionName === inputData.functionName)
        );

        if (!findVideo) {
          throw new Error('Function not found');
        }

        // Same call as the dashboard and the public API
        return this._mediaService.videoFunction(
          inputData.identifier,
          inputData.functionName,
          inputData.params
        );
      },
    });
  }
}
