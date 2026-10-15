process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy';

const { ownerRows, config, snowflakeTime } = require('../../api/cron/discord-inbox');

const OWNER = '111';
const now = Date.parse('2026-10-14T18:00:00Z');
const msg = (id, author, content, ts, extra = {}) => ({ id, author: { id: author, bot: false }, content, timestamp: ts, attachments: [], ...extra });

describe('ownerRows', () => {
  test('keeps only the owner, drops bots, webhooks, others and empty messages, oldest first', () => {
    const rows = ownerRows([
      msg('300', OWNER, 'second', '2026-10-14T17:00:00Z'),
      msg('200', OWNER, 'first', '2026-10-14T16:00:00Z'),
      msg('250', '999', 'not the owner', '2026-10-14T16:30:00Z'),
      { ...msg('260', OWNER, 'a bot posing', '2026-10-14T16:31:00Z'), author: { id: OWNER, bot: true } },
      msg('270', OWNER, 'webhook echo', '2026-10-14T16:32:00Z', { webhook_id: 'w' }),
      msg('280', OWNER, '   ', '2026-10-14T16:33:00Z'),
    ], { ownerId: OWNER, channelId: 'c1', cursor: '100', now });
    expect(rows.map(r => r.body)).toEqual(['first', 'second']);
    expect(rows[0]).toMatchObject({ discord_message_id: '200', channel_id: 'c1', author_id: OWNER, reply_to: null });
  });

  test('a first run with no cursor skips anything older than a day', () => {
    const rows = ownerRows([
      msg('200', OWNER, 'old', '2026-10-12T16:00:00Z'),
      msg('300', OWNER, 'fresh', '2026-10-14T16:00:00Z'),
    ], { ownerId: OWNER, channelId: 'c1', cursor: null, now });
    expect(rows.map(r => r.body)).toEqual(['fresh']);
  });

  test('keeps the replied-to message id so an answer can be tied to the call', () => {
    const rows = ownerRows([msg('300', OWNER, 'yes', '2026-10-14T16:00:00Z', { message_reference: { message_id: '42' } })],
      { ownerId: OWNER, channelId: 'c1', cursor: '1', now });
    expect(rows[0].reply_to).toBe('42');
  });
});

describe('config', () => {
  test('needs all three variables', () => {
    expect(config({ DISCORD_BOT_TOKEN: 't', DISCORD_INBOX_CHANNEL_ID: 'c' })).toBeNull();
    expect(config({ DISCORD_BOT_TOKEN: 't', DISCORD_INBOX_CHANNEL_ID: 'c', DISCORD_OWNER_USER_ID: 'o' })).toEqual({ token: 't', channelId: 'c', ownerId: 'o' });
  });
});

test('snowflakeTime decodes the Discord epoch', () => {
  expect(snowflakeTime('175928847299117063').toISOString()).toBe('2016-04-30T11:18:25.796Z');
});
