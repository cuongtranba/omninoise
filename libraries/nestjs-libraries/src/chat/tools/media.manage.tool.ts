import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

const mediaSchema = z.object({
  id: z.string(),
  name: z.string(),
  originalName: z.string().nullable(),
  path: z.string(),
  alt: z.string().nullable(),
  thumbnail: z.string().nullable(),
  thumbnailTimestamp: z.number().nullable(),
});

@Injectable()
export class MediaManageTool implements AgentToolInterface {
  constructor(private _mediaService: MediaService) {}
  name = 'mediaManageTool';
  mirrors = ['DELETE /media/:id', 'POST /media/information'];
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'mediaManageTool',
      mcp: {
        annotations: {
          title: 'Manage Media',
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      description: `
Use this to manage a media (image or video) of the media library. Find it first with mediaListTool and pass its "id".
action "update": saves the alt text, the thumbnail (the url of an image) and the thumbnail time (the video frame to use as the cover, in milliseconds) of the media. Only the values you pass are changed.
action "delete": removes the media from the media library. It cannot be undone and the media can no longer be attached to new posts, so show the user which media will be deleted and get their confirmation first.
If something fails, the result contains output.errors.
`,
      inputSchema: z.object({
        action: z.enum(['update', 'delete']),
        id: z.string().describe('The "id" of the media'),
        alt: z.string().optional().describe('For "update": the alt text'),
        thumbnail: z
          .string()
          .url()
          .refine((url) => /^https?:\/\//i.test(url), {
            message: 'The thumbnail must be an http(s) url',
          })
          .optional()
          .describe('For "update": the url of the thumbnail image'),
        thumbnailTimestamp: z
          .number()
          .min(0)
          .optional()
          .describe(
            'For "update": the video frame of the cover, in milliseconds'
          ),
      }),
      outputSchema: z.object({
        output: z
          .object({ media: mediaSchema })
          .or(z.object({ deleted: z.object({ id: z.string() }) }))
          .or(z.object({ errors: z.string() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;

        try {
          // the media of this organization only, a missing one is a clear error
          await this._mediaService.getMediaStatus(organizationId, inputData.id);

          if (inputData.action === 'delete') {
            await this._mediaService.deleteMedia(organizationId, inputData.id);
            return { output: { deleted: { id: inputData.id } } };
          }

          // values that are not passed stay undefined and are left unchanged
          const media = await this._mediaService.saveMediaInformation(
            organizationId,
            {
              id: inputData.id,
              alt: inputData.alt!,
              thumbnail: inputData.thumbnail!,
              thumbnailTimestamp: inputData.thumbnailTimestamp!,
            }
          );
          return { output: { media } };
        } catch (err: any) {
          return {
            output: { errors: err?.message || 'Failed to manage the media' },
          };
        }
      },
    });
  }
}
