const {
  shouldAlertTierEntry, formatTierAlert, sendTierAlert, sendDiscordEmbeds, embedsFromLines, embedText, webhookFor,
} = require('../../lib/services/discord-alerts');

const ENV_KEYS = ['DISCORD_WEBHOOK_URL', 'DISCORD_WEBHOOK_RECEIPTS_URL', 'DISCORD_WEBHOOK_MODEL_URL'];
function clearEnv() { for (const k of ENV_KEYS) delete process.env[k]; }

describe('shouldAlertTierEntry', () => {
  test('fresh publish at Sharp Take or Strong Play alerts', () => {
    expect(shouldAlertTierEntry('Sharp Take', null, null)).toBe(true);
    expect(shouldAlertTierEntry('Strong Play', null, null)).toBe(true);
  });

  test('upward promotions into the alert tiers alert', () => {
    expect(shouldAlertTierEntry('Sharp Take', 'Strong Play',
      [{ tier: 'Strong Play', at: 't1' }])).toBe(true);
    expect(shouldAlertTierEntry('Strong Play', 'Play',
      [{ tier: 'Play', at: 't1' }])).toBe(true);
    expect(shouldAlertTierEntry('Strong Play', 'Lean', null)).toBe(true);
  });

  test('a Sharp Take demoting to Strong Play stays silent', () => {
    expect(shouldAlertTierEntry('Strong Play', 'Sharp Take',
      [{ tier: 'Sharp Take', at: 't1' }])).toBe(false);
  });

  test('demotions and sub-alert tiers never alert', () => {
    expect(shouldAlertTierEntry('Play', 'Strong Play', null)).toBe(false);
    expect(shouldAlertTierEntry('Play', null, null)).toBe(false);
    expect(shouldAlertTierEntry('Lean', null, null)).toBe(false);
  });

  test('a pick never alerts twice at the same tier', () => {
    expect(shouldAlertTierEntry('Sharp Take', 'Strong Play', [
      { tier: 'Sharp Take', at: 't1' },
      { tier: 'Strong Play', at: 't2' },
    ])).toBe(false);
    expect(shouldAlertTierEntry('Sharp Take', 'Sharp Take', null)).toBe(false);
  });
});

describe('formatTierAlert (embed, no link)', () => {
  const base = {
    pick: 'Kansas City Royals ML -112',
    sport: 'MLB',
    homeTeam: 'Kansas City Royals',
    awayTeam: 'Detroit Tigers',
    gameDate: '2026-08-22T23:16:00Z',
    edgePp: 10.8,
  };

  test('promotion embed carries the tier, the pick, the matchup, the edge and the path', () => {
    const e = formatTierAlert({ ...base, tier: 'Sharp Take', previousTier: 'Strong Play' });
    const text = embedText([e]);
    expect(e.title).toContain('Sharp Take');
    expect(e.title).toContain('Kansas City Royals ML -112');
    expect(text).toContain('Detroit Tigers @ Kansas City Royals');
    expect(text).toContain('Edge 10.8pp');
    expect(text).toContain('promoted from Strong Play');
    expect(e.color).toBe(0xf5a623);
  });

  test('the site link is gone from every alert (owner 2026-09-21)', () => {
    const text = embedText([formatTierAlert({ ...base, tier: 'Strong Play', previousTier: null })]);
    expect(text).not.toContain('traphawk.io');
    expect(text).not.toContain('http');
  });

  test('Strong Play fresh publish says so with its own emoji and color', () => {
    const e = formatTierAlert({ ...base, tier: 'Strong Play', edgePp: 8.1, previousTier: null });
    expect(e.title.startsWith('📈 Strong Play')).toBe(true);
    expect(e.description).toContain('published straight to Strong Play');
    expect(e.color).toBe(0x2ecc71);
  });
});

describe('webhookFor', () => {
  afterEach(clearEnv);

  test('no webhook anywhere is a null url', () => {
    clearEnv();
    expect(webhookFor('board').url).toBeNull();
    expect(webhookFor('receipts').url).toBeNull();
  });

  test('a channel without its own webhook falls back to the board one', () => {
    clearEnv();
    process.env.DISCORD_WEBHOOK_URL = 'https://discord.example/board';
    expect(webhookFor('receipts')).toEqual({ url: 'https://discord.example/board', fallback: true });
    expect(webhookFor('model')).toEqual({ url: 'https://discord.example/board', fallback: true });
    expect(webhookFor('board')).toEqual({ url: 'https://discord.example/board', fallback: false });
  });

  test('a channel with its own webhook uses it', () => {
    clearEnv();
    process.env.DISCORD_WEBHOOK_URL = 'https://discord.example/board';
    process.env.DISCORD_WEBHOOK_MODEL_URL = 'https://discord.example/model';
    expect(webhookFor('model')).toEqual({ url: 'https://discord.example/model', fallback: false });
  });
});

describe('sendTierAlert and sendDiscordEmbeds', () => {
  afterEach(() => { clearEnv(); delete global.fetch; });

  test('no webhook configured is a silent no-op', async () => {
    clearEnv();
    const r = await sendTierAlert({ tier: 'Sharp Take', pick: 'X ML -110' });
    expect(r.sent).toBe(false);
    expect(r.reason).toContain('no webhook');
  });

  test('posts the embed to the board webhook', async () => {
    process.env.DISCORD_WEBHOOK_URL = 'https://discord.example/webhook';
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 204 });
    const r = await sendTierAlert({ tier: 'Strong Play', pick: 'X ML -110', sport: 'MLB' });
    expect(r.sent).toBe(true);
    expect(global.fetch.mock.calls[0][0]).toBe('https://discord.example/webhook');
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.content).toBeUndefined();
    expect(body.embeds).toHaveLength(1);
    expect(body.embeds[0].title).toContain('X ML -110');
    expect(body.embeds[0].title).toContain('Strong Play');
  });

  test('receipts go to their own webhook when set, ten embeds per message', async () => {
    process.env.DISCORD_WEBHOOK_URL = 'https://discord.example/board';
    process.env.DISCORD_WEBHOOK_RECEIPTS_URL = 'https://discord.example/receipts';
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 204 });
    const embeds = Array.from({ length: 12 }, (_, i) => ({ title: `card ${i}`, description: 'x' }));
    const r = await sendDiscordEmbeds(embeds, 'receipts');
    expect(r.sent).toBe(true);
    expect(r.messages).toBe(2);
    expect(r.fallback).toBe(false);
    expect(global.fetch.mock.calls.every(c => c[0] === 'https://discord.example/receipts')).toBe(true);
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).embeds).toHaveLength(10);
  });

  test('embeds are clipped to the Discord limits before posting', async () => {
    process.env.DISCORD_WEBHOOK_URL = 'https://discord.example/board';
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 204 });
    await sendDiscordEmbeds([{ title: 'x'.repeat(400), description: 'y'.repeat(5000), fields: [{ name: 'n', value: 'v'.repeat(2000) }] }], 'board');
    const e = JSON.parse(global.fetch.mock.calls[0][1].body).embeds[0];
    expect(e.title.length).toBeLessThanOrEqual(256);
    expect(e.description.length).toBeLessThanOrEqual(4096);
    expect(e.fields[0].value.length).toBeLessThanOrEqual(1024);
  });

  test('a webhook outage resolves instead of throwing', async () => {
    process.env.DISCORD_WEBHOOK_URL = 'https://discord.example/webhook';
    global.fetch = jest.fn().mockRejectedValue(new Error('down'));
    const r = await sendTierAlert({ tier: 'Sharp Take', pick: 'X ML -110' });
    expect(r.sent).toBe(false);
  });
});

describe('embedsFromLines', () => {
  test('short sections are one embed with the title and footer', () => {
    const e = embedsFromLines('Plays', ['• a', '• b'], { footer: 'f' });
    expect(e).toHaveLength(1);
    expect(e[0].title).toBe('Plays');
    expect(e[0].description).toBe('• a\n• b');
    expect(e[0].footer.text).toBe('f');
  });

  test('long sections split on line boundaries, footer on the last', () => {
    const lines = Array.from({ length: 150 }, (_, i) => `• pick number ${i} with some padding text to fill`);
    const e = embedsFromLines('Leans', lines, { footer: 'end' });
    expect(e.length).toBeGreaterThan(1);
    expect(e[0].footer).toBeUndefined();
    expect(e[e.length - 1].footer.text).toBe('end');
    expect(e[1].title).toContain('continued');
    expect(e.map(x => x.description).join('\n')).toBe(lines.join('\n'));
  });
});

// 2026-10-03: the 70 row morning board went out as one message and Discord
// refused it (ten embeds can pass the per embed clips and still exceed the
// 6000 character per message cap). The poster chunks by characters too and
// a refused message is reported with the status and body.
describe('chunkEmbeds and a refused post (2026-10-03)', () => {
  const { chunkEmbeds, embedChars } = require('../../lib/services/discord-alerts');
  afterEach(() => { delete process.env.DISCORD_WEBHOOK_URL; delete global.fetch; });

  test('ten short embeds share a message, long ones split by characters', () => {
    const short = Array.from({ length: 12 }, (_, i) => ({ title: `card ${i}`, description: 'x' }));
    expect(chunkEmbeds(short).map(c => c.length)).toEqual([10, 2]);
    const long = Array.from({ length: 4 }, (_, i) => ({ title: `tier ${i}`, description: 'p'.repeat(2500) }));
    expect(embedChars(long[0])).toBe(2506);
    expect(chunkEmbeds(long).map(c => c.length)).toEqual([2, 2]);
    expect(chunkEmbeds([])).toEqual([]);
  });

  test('a big board goes out in several messages and a refusal is failed with the reason', async () => {
    process.env.DISCORD_WEBHOOK_URL = 'https://discord.example/board';
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 204 });
    const board = Array.from({ length: 7 }, (_, i) => ({ title: `Leans ${i}`, description: 'line\n'.repeat(700) }));
    const r = await sendDiscordEmbeds(board, 'board');
    expect(r.sent).toBe(true);
    expect(r.messages).toBeGreaterThan(1);
    for (const call of global.fetch.mock.calls) {
      const body = JSON.parse(call[1].body);
      expect(body.embeds.reduce((n, e) => n + embedChars(e), 0)).toBeLessThanOrEqual(6000);
    }
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 400, text: async () => '{"embeds": ["Embed size exceeds maximum size of 6000"]}' });
    const bad = await sendDiscordEmbeds([{ title: 'x', description: 'y' }], 'board');
    expect(bad.sent).toBe(false);
    expect(bad.status).toBe(400);
    expect(bad.reason).toContain('discord 400');
    expect(bad.reason).toContain('6000');
  });
});
