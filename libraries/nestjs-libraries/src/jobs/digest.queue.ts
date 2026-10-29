import { getPgPool } from '@gitroom/nestjs-libraries/pg/pg.pool';
import {
  ensureJobsSchema,
  JobQueueService,
} from '@gitroom/nestjs-libraries/jobs/job.queue';

export type DigestItem = {
  message: string;
  title?: string;
  type: 'success' | 'fail' | 'info';
};

const HOUR = 60 * 60 * 1000;

/**
 * Parks a notification for the organization's next digest email. The first
 * item arms the digest an hour ahead; later items ride along (`keep`).
 */
export async function addDigestItem(
  queue: JobQueueService,
  organizationId: string,
  item: DigestItem
) {
  await ensureJobsSchema();
  await getPgPool().query(
    'INSERT INTO pgonly.digest_items (organization_id, payload) VALUES ($1, $2)',
    [organizationId, JSON.stringify(item)]
  );
  await queue.enqueue(
    'digest',
    { organizationId },
    {
      dedupeKey: `digest:${organizationId}`,
      mode: 'keep',
      organizationId,
      runAt: new Date(Date.now() + HOUR),
    }
  );
}

export async function readDigestItems(organizationId: string) {
  const res = await getPgPool().query(
    `SELECT id, payload FROM pgonly.digest_items
     WHERE organization_id = $1 ORDER BY id`,
    [organizationId]
  );
  return res.rows.map((r) => ({
    id: Number(r.id),
    item: r.payload as DigestItem,
  }));
}

/** Removes the sent items and reports whether newer ones are waiting. */
export async function deleteDigestItems(organizationId: string, ids: number[]) {
  await getPgPool().query(
    'DELETE FROM pgonly.digest_items WHERE id = ANY($1::bigint[])',
    [ids]
  );
  const left = await getPgPool().query(
    'SELECT 1 FROM pgonly.digest_items WHERE organization_id = $1 LIMIT 1',
    [organizationId]
  );
  return (left.rowCount ?? 0) > 0;
}
