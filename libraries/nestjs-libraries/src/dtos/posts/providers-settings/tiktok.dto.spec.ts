import 'reflect-metadata';
import { expect, test } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  TIKTOK_BRANDED_CONTENT_PRIVATE_MESSAGE,
  TIKTOK_DISCLOSURE_MISSING_MESSAGE,
  TikTokDto,
} from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/tiktok.dto';

// What the settings panel sends for a direct post with nothing ticked
const settings = (overrides: Record<string, unknown> = {}) => ({
  content_posting_method: 'DIRECT_POST',
  privacy_level: 'PUBLIC_TO_EVERYONE',
  comment: false,
  duet: false,
  stitch: false,
  autoAddMusic: 'no',
  brand_content_toggle: false,
  brand_organic_toggle: false,
  video_made_with_ai: false,
  ...overrides,
});

// The messages of every failed rule, the same check the post save runs
const problems = async (overrides: Record<string, unknown> = {}) => {
  const errors = await validate(
    plainToInstance(TikTokDto, settings(overrides)) as object
  );
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
};

test('a direct post with no visibility picked is refused', async () => {
  expect(await problems({ privacy_level: '' })).not.toEqual([]);
});

test('an upload to the TikTok inbox does not need a visibility', async () => {
  expect(
    await problems({ content_posting_method: 'UPLOAD', privacy_level: '' })
  ).toEqual([]);
});

test('branded content cannot be private', async () => {
  expect(
    await problems({ brand_content_toggle: true, privacy_level: 'SELF_ONLY' })
  ).toEqual([TIKTOK_BRANDED_CONTENT_PRIVATE_MESSAGE]);
});

test('the commercial content disclosure needs one of the two choices', async () => {
  expect(await problems({ disclose: true })).toEqual([
    TIKTOK_DISCLOSURE_MISSING_MESSAGE,
  ]);
  expect(
    await problems({ disclose: true, brand_organic_toggle: true })
  ).toEqual([]);
});

test('a post the settings panel blocked is refused with its reason', async () => {
  expect(
    await problems({ post_blocked_reason: 'Please try again later.' })
  ).toEqual(['Please try again later.']);
});
