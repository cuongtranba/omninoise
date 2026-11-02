import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parse } from 'yaml';
import { validUrl } from './config';
import { CliError } from './context';

export const PROFILE_FILE = 'omninoise.profile.yaml';
export const KINDS = [
  'youtube',
  'instagram',
  'tiktok',
  'facebook',
  'threads',
] as const;
export type Kind = (typeof KINDS)[number];

export type ChannelProfile = {
  integration: string;
  language: 'en' | 'vi-first';
  footer: string;
  hashtags: [number, number];
  posting_method: 'UPLOAD' | 'DIRECT_POST';
  max_chars?: number;
};

export type Profile = {
  file: string;
  instanceUrl?: string;
  brand: { name: string; hub: string; logo?: string };
  ban: string[];
  hashtagBan: string[];
  aiDisclosure: { en: RegExp; vi: RegExp };
  channels: Partial<Record<Kind, ChannelProfile>>;
};

/** `--profile`, else walk up from the project directory and then from cwd. */
export const findProfile = (explicit: string | undefined, dirs: string[]) => {
  if (explicit) {
    if (!existsSync(explicit))
      throw new CliError(`Profile ${explicit} does not exist`);
    return resolve(explicit);
  }
  for (const start of dirs) {
    for (let dir = resolve(start); ; dir = dirname(dir)) {
      const candidate = join(dir, PROFILE_FILE);
      if (existsSync(candidate)) return candidate;
      if (dirname(dir) === dir) break;
    }
  }
  throw new CliError(
    `No ${PROFILE_FILE} found above ${dirs.join(' or ')}; pass --profile <file>`
  );
};

const isObject = (v: unknown): v is Record<string, any> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const text = (value: unknown, key: string, optional = false): string => {
  if (typeof value === 'string' && value.trim()) return value;
  if (optional && value === undefined) return undefined as any;
  throw new CliError(`Profile key "${key}" must be a non-empty string`);
};

const stringList = (value: unknown, key: string): string[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !v)) {
    throw new CliError(
      `Profile key "${key}" must be a list of non-empty strings`
    );
  }
  return value;
};

const pattern = (value: unknown, key: string) => {
  try {
    return new RegExp(text(value, key));
  } catch (e: any) {
    if (e instanceof CliError) throw e;
    throw new CliError(
      `Profile key "${key}" is not a valid regular expression: ${e.message}`
    );
  }
};

export const loadProfile = async (file: string): Promise<Profile> => {
  let raw: unknown;
  try {
    raw = parse(await readFile(file, 'utf8'));
  } catch (e: any) {
    throw new CliError(`Cannot read profile ${file}: ${e.message}`);
  }
  if (!isObject(raw))
    throw new CliError(`Profile ${file} must be a YAML mapping`);

  if (!isObject(raw.brand))
    throw new CliError('Profile key "brand" must be a mapping');
  if (!isObject(raw.ai_disclosure)) {
    throw new CliError(
      'Profile key "ai_disclosure" must be a mapping with "en" and "vi"'
    );
  }
  if (!isObject(raw.channels) || Object.keys(raw.channels).length === 0) {
    throw new CliError('Profile key "channels" must list at least one channel');
  }
  if (raw.instance !== undefined && !isObject(raw.instance)) {
    throw new CliError('Profile key "instance" must be a mapping with "url"');
  }

  const channels: Profile['channels'] = {};
  for (const [kind, value] of Object.entries(raw.channels)) {
    const key = `channels.${kind}`;
    if (!(KINDS as readonly string[]).includes(kind)) {
      throw new CliError(
        `Profile key "${key}" is not supported; use one of ${KINDS.join(', ')}`
      );
    }
    if (!isObject(value))
      throw new CliError(`Profile key "${key}" must be a mapping`);
    if (value.language !== 'en' && value.language !== 'vi-first') {
      throw new CliError(
        `Profile key "${key}.language" must be "en" or "vi-first"`
      );
    }
    const range = value.hashtags;
    if (
      !Array.isArray(range) ||
      range.length !== 2 ||
      !range.every((n) => Number.isInteger(n) && n >= 0) ||
      range[0] > range[1]
    ) {
      throw new CliError(
        `Profile key "${key}.hashtags" must be [min, max] with 0 <= min <= max`
      );
    }
    const method = value.posting_method ?? 'UPLOAD';
    if (method !== 'UPLOAD' && method !== 'DIRECT_POST') {
      throw new CliError(
        `Profile key "${key}.posting_method" must be UPLOAD or DIRECT_POST`
      );
    }
    if (
      value.max_chars !== undefined &&
      !(Number.isInteger(value.max_chars) && value.max_chars > 0)
    ) {
      throw new CliError(
        `Profile key "${key}.max_chars" must be a positive integer`
      );
    }
    channels[kind as Kind] = {
      integration: text(value.integration, `${key}.integration`),
      language: value.language,
      footer: text(value.footer, `${key}.footer`),
      hashtags: [range[0], range[1]],
      posting_method: method,
      max_chars: value.max_chars,
    };
  }

  return {
    file,
    instanceUrl: raw.instance
      ? validUrl(text(raw.instance.url, 'instance.url'))
      : undefined,
    brand: {
      name: text(raw.brand.name, 'brand.name'),
      hub: text(raw.brand.hub, 'brand.hub'),
      logo: text(raw.brand.logo, 'brand.logo', true),
    },
    ban: stringList(raw.ban, 'ban'),
    hashtagBan: stringList(raw.hashtag_ban, 'hashtag_ban'),
    aiDisclosure: {
      en: pattern(raw.ai_disclosure.en, 'ai_disclosure.en'),
      vi: pattern(raw.ai_disclosure.vi, 'ai_disclosure.vi'),
    },
    channels,
  };
};
