import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { parse } from 'yaml';
import { Api, Media } from './api';
import { resolveAuth } from './config';
import { CliError, Context, printJson } from './context';
import {
  ChannelProfile,
  findProfile,
  Kind,
  KINDS,
  loadProfile,
  Profile,
} from './profile';

type PublishYaml = {
  title: string;
  /** English caption. Not read when `vi_only` is set. */
  caption?: string;
  /** Shorter caption for Threads; default is the channel's caption. */
  caption_threads?: string;
  link?: string;
  /** Label before the link; default "Full write-up". */
  link_label?: string;
  hashtags: Record<string, string[]>;
  /** Vietnamese cut: Vietnamese text, blank line, the same text in English. */
  caption_vi_first?: string;
  title_vi?: string;
  /** No English cut: the Vietnamese cut and caption go to every channel. */
  vi_only?: boolean;
};

type MediaSet = {
  video?: Media;
  videoVi?: Media;
  cover?: Media;
  thumb?: Media;
};

const DATE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:00(\.000)?Z$/;

const asString = (
  v: unknown,
  key: string,
  optional = false
): string | undefined => {
  if (v === undefined && optional) return undefined;
  if (typeof v !== 'string' || !v.trim()) {
    throw new CliError(`publish.yaml: "${key}" must be a non-empty string`);
  }
  return v;
};

const readPublish = async (file: string): Promise<PublishYaml> => {
  const raw = parse(await readFile(file, 'utf8'));
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new CliError(`${file} must be a YAML mapping`);
  }
  const hashtags = raw.hashtags;
  if (
    typeof hashtags !== 'object' ||
    hashtags === null ||
    Array.isArray(hashtags)
  ) {
    throw new CliError(
      'publish.yaml: "hashtags" must be a mapping of channel to list'
    );
  }
  for (const [k, v] of Object.entries(hashtags)) {
    if (!Array.isArray(v) || v.some((t) => typeof t !== 'string')) {
      throw new CliError(
        `publish.yaml: "hashtags.${k}" must be a list of strings`
      );
    }
  }
  return {
    title: asString(raw.title, 'title')!,
    caption: asString(raw.caption, 'caption', true),
    caption_threads: asString(raw.caption_threads, 'caption_threads', true),
    link: asString(raw.link, 'link', true),
    link_label: asString(raw.link_label, 'link_label', true),
    hashtags: hashtags as Record<string, string[]>,
    caption_vi_first: asString(raw.caption_vi_first, 'caption_vi_first', true),
    title_vi: asString(raw.title_vi, 'title_vi', true),
    vi_only: raw.vi_only === true,
  };
};

const tags = (list: string[]) =>
  list.map((t) => `#${t.replace(/^#/, '')}`).join(' ');
const lower = (s: string) => s.toLowerCase();

/** Every rule that needs no media or network: refuse before anything is uploaded. */
const check = (pub: PublishYaml, profile: Profile, kinds: Kind[]) => {
  const dump = lower(JSON.stringify(pub));
  for (const banned of profile.ban) {
    if (dump.includes(lower(banned))) {
      throw new CliError(`publish.yaml contains the banned text "${banned}"`);
    }
  }
  const allTags = Object.values(pub.hashtags)
    .flat()
    .map((t) => lower(t));
  for (const banned of profile.hashtagBan) {
    if (allTags.some((t) => t.includes(lower(banned)))) {
      throw new CliError(`"${banned}" must not be a hashtag`);
    }
  }
  const viOnly = pub.vi_only === true;
  const viCut = pub.caption_vi_first !== undefined;
  const { en, vi } = profile.aiDisclosure;
  if (!viOnly && !en.test(pub.caption ?? '')) {
    throw new CliError(`caption must carry the AI disclosure (${en.source})`);
  }
  if (pub.caption_threads && !en.test(pub.caption_threads)) {
    throw new CliError('caption_threads must carry the AI disclosure too');
  }
  if (viOnly && !viCut) throw new CliError('vi_only needs caption_vi_first');
  if (
    viCut &&
    !(
      vi.test(pub.caption_vi_first!) &&
      en.test(pub.caption_vi_first!) &&
      pub.title_vi
    )
  ) {
    throw new CliError(
      `caption_vi_first needs the AI disclosure in both languages (${vi.source} and ${en.source}), and title_vi must be set`
    );
  }
  for (const kind of kinds) {
    const [lo, hi] = profile.channels[kind]!.hashtags;
    const n = pub.hashtags[kind]?.length ?? 0;
    if (n < lo || n > hi) {
      throw new CliError(`hashtags.${kind}: ${n}, expected ${lo}-${hi}`);
    }
  }
  if (kinds.includes('youtube') && !Array.isArray(pub.hashtags.youtube_tags)) {
    throw new CliError(
      'publish.yaml: "hashtags.youtube_tags" is required for youtube'
    );
  }
};

const useVi = (pub: PublishYaml, channel: ChannelProfile) =>
  pub.vi_only === true ||
  (pub.caption_vi_first !== undefined && channel.language === 'vi-first');

export const buildBody = (
  pub: PublishYaml,
  profile: Profile,
  kinds: Kind[],
  date: string,
  media: MediaSet
) => {
  const label = pub.link_label ?? 'Full write-up';
  const withLink = (s: string) =>
    pub.link ? `${s}\n\n${label}: ${pub.link}` : s;
  // Instagram and TikTok captions cannot link. A link to the hub is already in the footer, so only another
  // site is named, in plain text.
  const hubHost = new URL(profile.brand.hub).host;
  const bareLink = pub.link?.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const plainLink =
    !pub.link || pub.link.includes(hubHost) ? '' : `\n${label}: ${bareLink}`;

  const posts = kinds.map((kind) => {
    const channel = profile.channels[kind]!;
    const vi = useVi(pub, channel);
    const caption = (vi ? pub.caption_vi_first! : pub.caption!).trim();
    const titleVi =
      pub.caption_vi_first !== undefined && channel.language === 'vi-first';
    const title = (titleVi ? pub.title_vi! : pub.title).trim();
    const video = vi ? media.videoVi! : media.video!;
    const files = (thumbnail?: string) => [
      { id: video.id, path: video.path, ...(thumbnail ? { thumbnail } : {}) },
    ];
    const hashtags = tags(pub.hashtags[kind]);
    const integration = { id: channel.integration };

    switch (kind) {
      case 'youtube':
        return {
          integration,
          value: [
            {
              content: `${withLink(`${caption}\n${hashtags}`)}\n${
                channel.footer
              }\n#Shorts`,
              image: files(media.thumb!.path),
            },
          ],
          settings: {
            __type: 'youtube',
            title: `${title} #Shorts`,
            type: 'public',
            selfDeclaredMadeForKids: 'no',
            tags: pub.hashtags.youtube_tags.map((t) => ({
              value: t,
              label: t,
            })),
          },
        };
      case 'instagram':
        return {
          integration,
          value: [
            {
              content: `${caption}${plainLink}\n${channel.footer}\n\n${hashtags}`,
              image: files(media.cover!.path),
            },
          ],
          settings: { __type: 'instagram-standalone', post_type: 'post' },
        };
      case 'tiktok':
        return {
          integration,
          value: [
            {
              content: `${caption}${plainLink}\n${channel.footer}\n${hashtags}`,
              image: files(),
            },
          ],
          settings: {
            __type: 'tiktok',
            title: title.slice(0, 90),
            content_posting_method: channel.posting_method,
            privacy_level: 'PUBLIC_TO_EVERYONE',
            duet: true,
            stitch: true,
            comment: true,
            autoAddMusic: 'no',
            brand_content_toggle: false,
            brand_organic_toggle: false,
            video_made_with_ai: true,
          },
        };
      case 'facebook':
        return {
          integration,
          value: [
            {
              content: `${withLink(`${caption}\n${hashtags}`)}\n${
                channel.footer
              }`,
              image: files(),
            },
          ],
          settings: { __type: 'facebook', post_type: 'post', title },
        };
      case 'threads': {
        const text = [
          (pub.caption_threads ?? caption).trim(),
          pub.link ?? '',
          channel.footer,
          hashtags,
        ]
          .filter(Boolean)
          .join('\n');
        if (channel.max_chars && text.length > channel.max_chars) {
          throw new CliError(
            `Threads text is ${text.length} chars, the limit is ${channel.max_chars}`
          );
        }
        return {
          integration,
          value: [{ content: text, image: files() }],
          settings: { __type: 'threads' },
        };
      }
    }
  });

  // Every post points to the hub: refuse to send one that lost its footer.
  posts.forEach((post, i) => {
    const kind = kinds[i];
    if (!post.value[0].content.includes(profile.channels[kind]!.footer)) {
      throw new CliError(`${kind} post is missing the hub footer`);
    }
  });
  const youtube = posts[kinds.indexOf('youtube')];
  if (
    youtube &&
    /[<>]/.test(youtube.value[0].content + (youtube.settings as any).title)
  ) {
    throw new CliError('YouTube title or caption contains < or >');
  }
  const youtubeTitle = (youtube?.settings as any)?.title as string | undefined;
  if (youtubeTitle && youtubeTitle.length > 100) {
    throw new CliError(`YouTube title is ${youtubeTitle.length} chars`);
  }

  return {
    type: 'schedule',
    date,
    shortLink: false,
    tags: [] as string[],
    creationMethod: 'CLI',
    posts,
  };
};

export type PublishOptions = {
  dir: string;
  at: string;
  dryRun: boolean;
  profile?: string;
  url?: string;
};

export const publish = async (ctx: Context, opts: PublishOptions) => {
  if (!DATE.test(opts.at)) {
    throw new CliError('--at must look like 2026-11-05T12:00:00Z');
  }
  const dir = resolve(ctx.cwd, opts.dir);
  const slug = basename(dir);
  const publishFile = join(dir, 'publish.yaml');
  if (!existsSync(publishFile)) throw new CliError(`No publish.yaml in ${dir}`);

  const profileFile = findProfile(
    opts.profile ? resolve(ctx.cwd, opts.profile) : undefined,
    [dir, ctx.cwd]
  );
  const profile = await loadProfile(profileFile);
  const pub = await readPublish(publishFile);
  const kinds = KINDS.filter((k) => profile.channels[k]);
  check(pub, profile, kinds);

  // Which files this project needs: a cut per language in use, the cover for Instagram, the thumbnail for YouTube.
  const viCut = pub.caption_vi_first !== undefined;
  const cuts = new Set(
    kinds.map((k) => (useVi(pub, profile.channels[k]!) ? 'vi' : 'en'))
  );
  const out = join(dir, 'out');
  const wanted: Record<keyof MediaSet, string | undefined> = {
    video: cuts.has('en') ? join(out, `${slug}-1080x1920.mp4`) : undefined,
    videoVi:
      cuts.has('vi') && viCut
        ? join(out, `${slug}-vi-1080x1920.mp4`)
        : undefined,
    cover: kinds.includes('instagram')
      ? join(out, 'cover-1080x1920.jpg')
      : undefined,
    thumb: kinds.includes('youtube')
      ? join(out, 'thumb-1280x720.jpg')
      : undefined,
  };
  for (const file of Object.values(wanted)) {
    if (file && !existsSync(file)) throw new CliError(`missing ${file}`);
  }

  // Build once with placeholders so every content rule fails before the first upload.
  const instanceUrl = opts.url || ctx.env.OMNINOISE_URL || profile.instanceUrl;
  const placeholderOrigin = new URL(instanceUrl ?? 'https://omninoise.example')
    .origin;
  const placeholders: MediaSet = {};
  for (const [key, file] of Object.entries(wanted)) {
    if (file) {
      placeholders[key as keyof MediaSet] = {
        id: 'dry',
        path: `${placeholderOrigin}/uploads/dry/${basename(file)}`,
      };
    }
  }
  const dry = buildBody(pub, profile, kinds, opts.at, placeholders);
  if (opts.dryRun) {
    printJson(ctx, dry);
    return;
  }

  const auth = await resolveAuth(ctx, instanceUrl);
  const api = new Api(auth.url, auth.secret);
  const uploaded: MediaSet = {};
  for (const [key, file] of Object.entries(wanted)) {
    if (file) uploaded[key as keyof MediaSet] = await api.upload(file);
  }
  const body = buildBody(pub, profile, kinds, opts.at, uploaded);
  ctx.stderr.write(
    `Publishing ${slug} to ${kinds.join(', ')} at ${opts.at} on ${
      new URL(auth.url).origin
    }\n`
  );
  const result = await api.createPosts(body);
  printJson(ctx, {
    slug,
    date: opts.at,
    video: uploaded.video?.path,
    videoVi: uploaded.videoVi?.path,
    cover: uploaded.cover?.path,
    thumb: uploaded.thumb?.path,
    result,
  });
};
