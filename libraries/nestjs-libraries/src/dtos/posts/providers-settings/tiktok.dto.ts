import {
  IsBoolean,
  ValidateIf,
  IsIn,
  IsString,
  MaxLength,
  IsOptional,
  IsDefined,
  IsNumber,
  Min,
  Max,
  ValidateNested,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Type } from 'class-transformer';
import { JSONSchema } from 'class-validator-jsonschema';

export class TikTokMusic {
  @IsDefined()
  @IsString()
  @JSONSchema({
    description:
      'The commercial music library track id, taken from the "id" returned by the musicSearch function.',
  })
  id: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  artist?: string;

  @IsOptional()
  @IsString()
  image?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  audio_volume?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  video_volume?: number;
}

export class TikTokLocation {
  @IsDefined()
  @IsString()
  @JSONSchema({
    description:
      'The location tag id, taken from the "id" returned by the locationSearch function.',
  })
  id: string;

  @IsDefined()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  address?: string;
}

export const TIKTOK_BRANDED_CONTENT_PRIVATE_MESSAGE =
  'Branded content visibility cannot be set to private.';
export const TIKTOK_DISCLOSURE_MISSING_MESSAGE =
  'You need to indicate if your content promotes yourself, a third party, or both.';

// TikTok ignores every setting but the title on an UPLOAD (inbox draft), so the
// rules below never apply to it.
const isDirectPost = (settings: TikTokDto) =>
  settings.content_posting_method !== 'UPLOAD';

// TikTok's Content Sharing Guidelines: branded content cannot be private.
@ValidatorConstraint({ name: 'TikTokBrandedContentNotPrivate', async: false })
export class TikTokBrandedContentNotPrivateConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const settings = args.object as TikTokDto;
    return !(
      isDirectPost(settings) &&
      settings.brand_content_toggle === true &&
      settings.privacy_level === 'SELF_ONLY'
    );
  }

  defaultMessage(): string {
    return TIKTOK_BRANDED_CONTENT_PRIVATE_MESSAGE;
  }
}

// Turning the commercial content disclosure on means saying what it promotes.
@ValidatorConstraint({ name: 'TikTokDisclosureNeedsChoice', async: false })
export class TikTokDisclosureNeedsChoiceConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const settings = args.object as TikTokDto;
    return !(
      isDirectPost(settings) &&
      settings.disclose === true &&
      !settings.brand_organic_toggle &&
      !settings.brand_content_toggle
    );
  }

  defaultMessage(): string {
    return TIKTOK_DISCLOSURE_MISSING_MESSAGE;
  }
}

// A reason that is not empty is the message of the failure.
@ValidatorConstraint({ name: 'TikTokNotBlocked', async: false })
export class TikTokNotBlockedConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return !value;
  }

  defaultMessage(args: ValidationArguments): string {
    return String(args.value);
  }
}

// TikTok only honors most of these settings on a DIRECT_POST. With
// content_posting_method=UPLOAD the media lands in the user's TikTok inbox as a
// draft, and TikTok's inbox/upload endpoints accept nothing but the title /
// description - every other field below is silently discarded.
// video_made_with_ai / duet / stitch are additionally video-only: TikTok's photo
// post_info has no is_aigc, disable_duet or disable_stitch field.
// music / location are TikTok Business only: the legacy TikTok provider ignores
// them (its Content Posting API has no music_sound_info / location fields).
// Fields stay required here (existing clients depend on it); the constraints are
// documented, not enforced.
export class TikTokDto {
  @ValidateIf((p) => p.title)
  @MaxLength(90)
  @JSONSchema({
    description:
      'Used as the title of the post. The only setting TikTok keeps when content_posting_method=UPLOAD.',
  })
  title: string;

  // The dashboard has no default: the creator picks one of the options TikTok
  // returns for them. The provider still falls back to PUBLIC_TO_EVERYONE for a
  // caller that sends none.
  @ValidateIf(isDirectPost)
  @IsIn([
    'PUBLIC_TO_EVERYONE',
    'MUTUAL_FOLLOW_FRIENDS',
    'FOLLOWER_OF_CREATOR',
    'SELF_ONLY',
  ])
  @IsString()
  @Validate(TikTokBrandedContentNotPrivateConstraint)
  @JSONSchema({
    description:
      'Applied only when content_posting_method=DIRECT_POST. Ignored by TikTok on UPLOAD.',
  })
  privacy_level:
    | 'PUBLIC_TO_EVERYONE'
    | 'MUTUAL_FOLLOW_FRIENDS'
    | 'FOLLOWER_OF_CREATOR'
    | 'SELF_ONLY';

  @IsBoolean()
  @JSONSchema({
    description:
      'Video posts only, and only when content_posting_method=DIRECT_POST. TikTok has no duet setting for photo posts.',
  })
  duet: boolean;

  @IsBoolean()
  @JSONSchema({
    description:
      'Video posts only, and only when content_posting_method=DIRECT_POST. TikTok has no stitch setting for photo posts.',
  })
  stitch: boolean;

  @IsBoolean()
  @JSONSchema({
    description:
      'Applied only when content_posting_method=DIRECT_POST. Ignored by TikTok on UPLOAD.',
  })
  comment: boolean;

  @IsIn(['yes', 'no'])
  @JSONSchema({
    description:
      'Photo posts only, and only when content_posting_method=DIRECT_POST. Ignored by TikTok on UPLOAD. ' +
      'On TikTok Business, "yes" attaches a random commercial music library track and overrides the music setting; ' +
      'on legacy TikTok, "yes" lets TikTok auto-add its recommended music.',
  })
  autoAddMusic: 'yes' | 'no';

  @IsBoolean()
  @JSONSchema({
    description:
      'Applied only when content_posting_method=DIRECT_POST. Ignored by TikTok on UPLOAD.',
  })
  brand_content_toggle: boolean;

  @IsBoolean()
  @IsOptional()
  @JSONSchema({
    description:
      'Labels the post as AI generated. Video posts only, and only when content_posting_method=DIRECT_POST. TikTok has no AI-generated label for photo posts, and discards it on UPLOAD.',
  })
  video_made_with_ai: boolean;

  @IsBoolean()
  @JSONSchema({
    description:
      'Applied only when content_posting_method=DIRECT_POST. Ignored by TikTok on UPLOAD.',
  })
  brand_organic_toggle: boolean;

  @IsBoolean()
  @IsOptional()
  @Validate(TikTokDisclosureNeedsChoiceConstraint)
  @JSONSchema({
    description:
      'Commercial content disclosure switch of the dashboard. When true, brand_organic_toggle or brand_content_toggle must be true too. API callers can leave it out and set the two toggles directly.',
  })
  disclose?: boolean;

  @IsOptional()
  @Validate(TikTokNotBlockedConstraint)
  @JSONSchema({
    description:
      'Set by the dashboard when TikTok will not take this post (the creator cannot post right now, or the video is longer than allowed). Always leave it out.',
  })
  post_blocked_reason?: string;

  @Type(() => TikTokMusic)
  @ValidateNested()
  @IsOptional()
  @JSONSchema({
    description:
      'TikTok Business only, and only when content_posting_method=DIRECT_POST. Attaches a commercial music library track to the post (use the musicSearch function to find one). audio_volume / video_volume apply to video posts only. For photos, ignored when autoAddMusic is "yes" (a random track is attached instead).',
  })
  music?: TikTokMusic;

  @Type(() => TikTokLocation)
  @ValidateNested()
  @IsOptional()
  @JSONSchema({
    description:
      'TikTok Business only, and only when content_posting_method=DIRECT_POST. Tags the post with a location (use the locationSearch function to find one).',
  })
  location?: TikTokLocation;

  @IsIn(['DIRECT_POST', 'UPLOAD'])
  @IsString()
  @JSONSchema({
    description:
      'Required. Use "DIRECT_POST" to actually publish the post to TikTok. ' +
      '"UPLOAD" does NOT publish: it only sends the media to the user\'s TikTok app inbox, ' +
      'where they must manually finish and publish it within 24 hours or it is discarded, ' +
      'and it makes TikTok ignore every other setting here. ' +
      'Only use "UPLOAD" when the user explicitly asks to review or edit the post inside the TikTok app before publishing.',
  })
  content_posting_method: 'DIRECT_POST' | 'UPLOAD';
}
