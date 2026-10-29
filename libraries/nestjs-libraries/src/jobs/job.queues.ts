import { socialIntegrationList } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import type { QueueConfig } from '@gitroom/nestjs-libraries/jobs/job.worker';

// Resend allows 10 requests per second for the whole team. Each worker claims
// at most this many emails per second from its queue; sends rejected by Resend
// are retried by sendEmailSync, and the rest is left for the auth emails sent
// directly.
export const emailQueues = {
  // Notifications, billing, invites ('top')
  priority: { taskQueue: 'email', perSecond: 3 },
  // Digests and streak emails ('bottom')
  bulk: { taskQueue: 'email-bulk', perSecond: 2 },
};

/** The queue a provider publishes on: its identifier before the first '-'. */
export const providerQueue = (providerIdentifier: string) =>
  providerIdentifier.split('-')[0].toLowerCase();

/**
 * The queues one worker process serves: `main`, one per provider (capped by
 * the provider's `maxConcurrentJob`) and the two rate-limited email queues.
 */
export function workerQueues(): QueueConfig[] {
  // Queues this worker server should NOT run, comma-separated
  // (e.g. EXCLUDE_QUEUE="reddit,x,twitch"). Use it to pin a queue to a single
  // server: exclude it on every server except the one that should own it.
  // Meant for the providers whose concurrency is too low to split (limit 1).
  const excludeQueues = (process.env.EXCLUDE_QUEUE || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // How many worker servers share each (non-excluded) queue. Per-server
  // concurrency is divided by this so the GLOBAL concurrency stays correct.
  // 1 server => 1 (full), 2 servers => 2 (half each), 3 servers => 3, etc.
  const divider = Math.max(
    1,
    Number(process.env.WORKER_CONCURRENCY_DIVIDER) || 1
  );

  const unlimited = 1_000_000;

  return [
    ...[
      { identifier: 'main', maxConcurrentJob: undefined as any },
      ...socialIntegrationList,
    ]
      .filter((f) => f.identifier.indexOf('-') === -1)
      .map((integration) => ({
        integration,
        name: integration.identifier.split('-')[0],
      }))
      .filter(({ name }) => !excludeQueues.includes(name))
      .map(({ integration, name }) => ({
        name,
        // Split the per-provider cap across the servers sharing this queue.
        // Floor (never below 1) so the global total never exceeds the
        // provider's limit. Providers whose limit is smaller than the server
        // count must be pinned via EXCLUDE_QUEUE instead.
        concurrency: integration.maxConcurrentJob
          ? Math.max(1, Math.floor(integration.maxConcurrentJob / divider))
          : unlimited,
      })),
    ...Object.values(emailQueues)
      .filter(({ taskQueue }) => !excludeQueues.includes(taskQueue))
      .map(({ taskQueue, perSecond }) => ({
        name: taskQueue,
        concurrency: 10,
        perSecond,
      })),
  ];
}
