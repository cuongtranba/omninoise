import { z } from 'zod';
import { AutopostDto } from '@gitroom/nestjs-libraries/dtos/autopost/autopost.dto';

// The fields shared by the tools that create and change webhooks and autoposts

export const webhookFields = {
  name: z.string().min(1).describe('The name of the webhook'),
  url: z
    .string()
    .describe(
      'The public https address that receives the posts, it cannot point to an internal network'
    ),
  channels: z
    .array(z.string())
    .describe(
      'The ids of the channels (integrationListTool) whose posts it receives, an empty list means all of them'
    ),
};

export const autopostFields = {
  title: z.string().min(1).describe('The name of the autopost'),
  url: z
    .string()
    .describe('The public https address of the RSS feed to follow'),
  active: z
    .boolean()
    .describe('true to start following the feed, false to keep it paused'),
  channels: z
    .array(z.string())
    .describe(
      'The ids of the channels (integrationListTool) it posts to, an empty list means all of them'
    ),
  generateContent: z
    .boolean()
    .describe(
      'true to let the AI write the text of the post out of the new item, false to use "content"'
    ),
  content: z
    .string()
    .optional()
    .describe('The text of the post when generateContent is false'),
  addPicture: z
    .boolean()
    .describe('true to let the AI draw a picture for the post'),
  syncLast: z
    .boolean()
    .describe(
      'true to also post the latest item of the feed right away, false to only post the items that come after "lastUrl"'
    ),
  onSlot: z
    .boolean()
    .describe('true to post at the next posting time of the channel'),
  lastUrl: z
    .string()
    .optional()
    .describe(
      'When syncLast is false: the link of the latest item now (from the "test" action), the items after it are posted. Leave it out when syncLast is true.'
    ),
};

export const toAutopostDto = (inputData: {
  title: string;
  url: string;
  active: boolean;
  channels: string[];
  generateContent: boolean;
  content?: string;
  addPicture: boolean;
  syncLast: boolean;
  onSlot: boolean;
  lastUrl?: string;
}) =>
  ({
    title: inputData.title,
    url: inputData.url,
    active: inputData.active,
    integrations: inputData.channels.map((id) => ({ id })),
    generateContent: inputData.generateContent,
    content: inputData.content,
    addPicture: inputData.addPicture,
    syncLast: inputData.syncLast,
    onSlot: inputData.onSlot,
    // the app saves it empty when it posts the latest item as well
    lastUrl: inputData.syncLast ? '' : inputData.lastUrl || '',
  } as AutopostDto);
