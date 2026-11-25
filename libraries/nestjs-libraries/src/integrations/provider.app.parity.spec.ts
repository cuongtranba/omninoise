import { expect, test } from 'vite-plus/test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  IntegrationManager,
  socialIntegrationList,
} from '@gitroom/nestjs-libraries/integrations/integration.manager';

// Architecture test: a provider call for a channel or a connect must run inside
// ProviderAppService.run, or it signs with the server's app while the
// channel's token belongs to the organization's own app, and the platform
// rejects it. Every place that looks a provider up is classified here.

const root = join(__dirname, '../../../..');

// The methods that call a provider for a channel or a connect. `true`: the
// method wraps the call itself; a list: the methods of the same file it hands
// the provider to, which do.
const CHANNEL: Record<string, true | string[]> = {
  'apps/backend/src/api/routes/no.auth.integrations.controller.ts#connectSocialMedia': true,
  'apps/backend/src/api/routes/no.auth.integrations.controller.ts#extensionRefreshCookies': true,
  'apps/orchestrator/src/activities/post.activity.ts#checkPostStatus': true,
  'apps/orchestrator/src/activities/post.activity.ts#finalizePost': true,
  'apps/orchestrator/src/activities/post.activity.ts#postComment': true,
  'apps/orchestrator/src/activities/post.activity.ts#postSocialBody': true,
  'libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.ts#analyticsChannel':
    ['loadAnalyticsWindow', 'checkAnalyticsDay'],
  'libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.ts#callProviderFunction': true,
  'libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.ts#changeProfile': true,
  'libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.ts#generateConnectUrl': true,
  'libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.ts#processInternalPlug': true,
  'libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.ts#processPlugs': true,
  'libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.ts#refreshTokens': true,
  'libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.ts#saveProviderPage': true,
  'libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts#checkPostAnalytics': true,
  'libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts#getMissingContent': true,
  'libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts#getReleaseURL':
    ['resolveRelease'],
  'libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts#resolveRelease': true,
  'libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts#updateReleaseId': true,
  'libraries/nestjs-libraries/src/integrations/refresh.integration.service.ts#refresh': true,
};

// Lookups that never call the platform, with the reason
const PROVIDER_CALL_ELSEWHERE =
  'checks the method exists, IntegrationService.callProviderFunction runs it';
const REFRESH_WAIT =
  'reads refreshWait, RefreshIntegrationService.refresh runs the refresh with the app';
const ANALYTICS_CAPABILITY =
  'reads which analytics the provider serves, IntegrationService and PostsService read them';
const MIGRATION = 'matches a migrated channel by profile, no platform call';
const METADATA: Record<string, string> = {
  'apps/backend/src/public-api/routes/v1/public.integrations.controller.ts#getIntegrationSettings':
    'reads the rules, limits and tools of the provider',
  'apps/backend/src/public-api/routes/v1/public.integrations.controller.ts#triggerIntegrationTool':
    PROVIDER_CALL_ELSEWHERE,
  'apps/orchestrator/src/activities/post.activity.ts#isCommentable':
    'reads whether the provider can comment',
  'apps/orchestrator/src/activities/post.activity.ts#refreshToken':
    REFRESH_WAIT,
  'apps/orchestrator/src/activities/post.activity.ts#refreshTokenWithCause':
    REFRESH_WAIT,
  'apps/orchestrator/src/jobs/job.seeder.ts#seed':
    'reads which providers refresh on a schedule',
  'libraries/nestjs-libraries/src/chat/tools/integration.trigger.tool.ts#run':
    PROVIDER_CALL_ELSEWHERE,
  'libraries/nestjs-libraries/src/chat/tools/integration.validation.tool.ts#run':
    'validates the settings and media of a post locally',
  'libraries/nestjs-libraries/src/database/prisma/analytics/analytics.history.service.ts#collectChannel':
    ANALYTICS_CAPABILITY,
  'libraries/nestjs-libraries/src/database/prisma/analytics/analytics.history.service.ts#collectableChannels':
    ANALYTICS_CAPABILITY,
  'libraries/nestjs-libraries/src/database/prisma/analytics/analytics.history.service.ts#collectablePosts':
    ANALYTICS_CAPABILITY,
  'libraries/nestjs-libraries/src/database/prisma/analytics/analytics.report.service.ts#build':
    ANALYTICS_CAPABILITY,
  'libraries/nestjs-libraries/src/database/prisma/analytics/analytics.report.service.ts#channelDays':
    ANALYTICS_CAPABILITY,
  'libraries/nestjs-libraries/src/database/prisma/analytics/analytics.report.service.ts#storedMetrics':
    ANALYTICS_CAPABILITY,
  'libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.ts#dashboardFunction':
    PROVIDER_CALL_ELSEWHERE,
  'libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.ts#getIntegrationsListForDisplay':
    'reads the editor and the capabilities of the provider',
  'libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.ts#migrateIntegration':
    MIGRATION,
  'libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.ts#migrateIntegrationOnConnect':
    MIGRATION,
  'libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts#createPost':
    'reads whether the provider strips links',
  'libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts#validatePosts':
    'validates the settings and media of a post locally',
  'libraries/nestjs-libraries/src/jobs/job.queues.ts#<module>':
    'reads the concurrency of each provider queue',
};

// The registry itself
const SKIPPED_FILES = [
  'libraries/nestjs-libraries/src/integrations/integration.manager.ts',
];

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'node_modules' || name === 'dist') {
      return [];
    }
    if (statSync(path).isDirectory()) {
      return sourceFiles(path);
    }
    return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
  });

// A class member signature, at the indentation of the class body
const member =
  /^ {2}(?:(?:public|private|protected|override|static|async|get)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\(/;

const methodBody = (lines: string[], name: string) => {
  const start = lines.findIndex((line) => line.match(member)?.[1] === name);
  if (start === -1) {
    return '';
  }
  const end = lines.findIndex((line, i) => i > start && member.test(line));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
};

const sites = [join(root, 'apps'), join(root, 'libraries')]
  .flatMap(sourceFiles)
  .filter((file) => !SKIPPED_FILES.includes(relative(root, file)))
  .flatMap((file) => {
    const lines = readFileSync(file, 'utf8').split('\n');
    return lines.flatMap((line, i) => {
      if (
        !/getSocialIntegration\(|socialIntegrationList/.test(line) ||
        /^import\b|^\s+socialIntegrationList,$/.test(line)
      ) {
        return [];
      }
      const method =
        lines
          .slice(0, i + 1)
          .reverse()
          .map((l) => l.match(member)?.[1])
          .find(Boolean) || '<module>';
      return [{ key: `${relative(root, file)}#${method}`, method, lines }];
    });
  });

test('G1: every provider lookup is classified and channel calls run with the channel app', () => {
  const unclassified = sites
    .map((s) => s.key)
    .filter((key) => !CHANNEL[key] && !METADATA[key]);
  expect(
    [...new Set(unclassified)],
    'Classify each new provider lookup: in CHANNEL when it calls the platform for a channel or a connect (wrap the call in ProviderAppService.run), in METADATA with the reason otherwise'
  ).toEqual([]);

  const unwrapped = sites.flatMap(({ key, method, lines }) => {
    const entry = CHANNEL[key];
    if (!entry) {
      return [];
    }
    return (entry === true ? [method] : entry)
      .filter((m) => !methodBody(lines, m).includes('_providerAppService.run('))
      .map((m) => `${key} -> ${m}`);
  });
  expect(unwrapped, 'Not run inside ProviderAppService.run').toEqual([]);

  const known = new Set(sites.map((s) => s.key));
  const stale = [...Object.keys(CHANNEL), ...Object.keys(METADATA)].filter(
    (key) => !known.has(key)
  );
  expect(stale, 'Classified lookups that no longer exist').toEqual([]);
});

test('G2: no provider with its own app reads its env pair directly', () => {
  const socialDir = join(
    root,
    'libraries/nestjs-libraries/src/integrations/social'
  );
  const offenders = socialIntegrationList
    .filter((p) => p.ownApp)
    .flatMap((p) => {
      const file = readdirSync(socialDir)
        .map((name) => join(socialDir, name))
        .find((path) =>
          readFileSync(path, 'utf8').includes(`identifier = '${p.identifier}'`)
        )!;
      const source = readFileSync(file, 'utf8');
      return [p.ownApp!.clientIdEnv, p.ownApp!.clientSecretEnv]
        .filter((name) => source.includes(`process.env.${name}`))
        .map((name) => `${p.identifier}: process.env.${name}`);
    });

  expect(offenders, 'Read the app through this.appCredentials()').toEqual([]);
});

test('G3: the providers an organization can bring its own app for', () => {
  const families = Object.fromEntries(
    new IntegrationManager()
      .getProviderAppFamilies()
      .map((f) => [f.family, f.providers.map((p) => p.identifier).sort()])
  );

  expect(families).toEqual({
    facebook: ['facebook', 'instagram'],
    'instagram-standalone': ['instagram-standalone'],
    threads: ['threads'],
    youtube: ['youtube'],
    tiktok: ['tiktok'],
    'tiktok-business': ['tiktok-business'],
    linkedin: ['linkedin', 'linkedin-page'],
    x: ['x'],
  });
});
