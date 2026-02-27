import { Client } from '@upstash/qstash';

let qstashClient: Client | null = null;

export function getQStashClient(): Client {
  if (!qstashClient) {
    qstashClient = new Client({ token: process.env.QSTASH_TOKEN! });
  }
  return qstashClient;
}

/**
 * Schedules the campaign processor to run after a delay.
 */
export async function scheduleActionProcessing(
  baseUrl: string,
  delaySeconds: number = 0
): Promise<void> {
  const client = getQStashClient();
  
  await client.publishJSON({
    url: `${baseUrl}/api/actions/process`,
    delay: delaySeconds,
    body: { trigger: 'scheduler', timestamp: new Date().toISOString() },
    retries: 3,
  });
}

/**
 * Schedules a specific action for a lead.
 */
export async function scheduleLeadAction(
  baseUrl: string,
  actionQueueId: string,
  delaySeconds: number = 0
): Promise<void> {
  const client = getQStashClient();
  
  await client.publishJSON({
    url: `${baseUrl}/api/actions/execute`,
    delay: delaySeconds,
    body: { action_queue_id: actionQueueId },
    retries: 3,
  });
}
