const { shouldAlertSharpTake, formatSharpTakeAlert, sendSharpTakeAlert } = require('../../lib/services/discord-alerts');

describe('shouldAlertSharpTake', () => {
  test('fresh publish at Sharp Take alerts', () => {
    expect(shouldAlertSharpTake('Sharp Take', null, null)).toBe(true);
  });

  test('promotion into Sharp Take alerts', () => {
    expect(shouldAlertSharpTake('Sharp Take', 'Strong Play',
      [{ tier: 'Strong Play', at: 't1' }])).toBe(true);
  });

  test('demotions and non-ST tiers never alert', () => {
    expect(shouldAlertSharpTake('Strong Play', 'Sharp Take', null)).toBe(false);
    expect(shouldAlertSharpTake('Play', null, null)).toBe(false);
  });

  test('a pick that was already Sharp Take once never alerts again', () => {
    expect(shouldAlertSharpTake('Sharp Take', 'Strong Play', [
      { tier: 'Sharp Take', at: 't1' },
      { tier: 'Strong Play', at: 't2' },
    ])).toBe(false);
    expect(shouldAlertSharpTake('Sharp Take', 'Sharp Take', null)).toBe(false);
  });
});

describe('formatSharpTakeAlert', () => {
  const base = {
    pick: 'Kansas City Royals ML -112',
    sport: 'MLB',
    homeTeam: 'Kansas City Royals',
    awayTeam: 'Detroit Tigers',
    gameDate: '2026-08-22T23:16:00Z',
    edgePp: 10.8,
  };

  test('promotion message carries the path and the link', () => {
    const msg = formatSharpTakeAlert({ ...base, previousTier: 'Strong Play' });
    expect(msg).toContain('Sharp Take');
    expect(msg).toContain('Kansas City Royals ML -112');
    expect(msg).toContain('Detroit Tigers @ Kansas City Royals');
    expect(msg).toContain('Edge 10.8pp');
    expect(msg).toContain('promoted from Strong Play');
    expect(msg).toContain('traphawk.io');
  });

  test('fresh publish says so', () => {
    const msg = formatSharpTakeAlert({ ...base, previousTier: null });
    expect(msg).toContain('published straight to Sharp Take');
  });
});

describe('sendSharpTakeAlert', () => {
  test('no webhook configured is a silent no-op', async () => {
    delete process.env.DISCORD_WEBHOOK_URL;
    const r = await sendSharpTakeAlert({ pick: 'X ML -110' });
    expect(r.sent).toBe(false);
    expect(r.reason).toContain('no webhook');
  });

  test('posts the formatted content to the webhook', async () => {
    process.env.DISCORD_WEBHOOK_URL = 'https://discord.example/webhook';
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 204 });
    const r = await sendSharpTakeAlert({ pick: 'X ML -110', sport: 'MLB' });
    expect(r.sent).toBe(true);
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.content).toContain('X ML -110');
    delete global.fetch;
    delete process.env.DISCORD_WEBHOOK_URL;
  });

  test('a webhook outage resolves instead of throwing', async () => {
    process.env.DISCORD_WEBHOOK_URL = 'https://discord.example/webhook';
    global.fetch = jest.fn().mockRejectedValue(new Error('down'));
    const r = await sendSharpTakeAlert({ pick: 'X ML -110' });
    expect(r.sent).toBe(false);
    delete global.fetch;
    delete process.env.DISCORD_WEBHOOK_URL;
  });
});
