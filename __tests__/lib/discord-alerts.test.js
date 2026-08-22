const { shouldAlertTierEntry, formatTierAlert, sendTierAlert } = require('../../lib/services/discord-alerts');

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
    expect(shouldAlertTierEntry('Strong Play', 'Play', [
      { tier: 'Strong Play', at: 't1' },
      { tier: 'Play', at: 't2' },
    ])).toBe(false);
    expect(shouldAlertTierEntry('Sharp Take', 'Sharp Take', null)).toBe(false);
  });

  test('the SP then ST path alerts once at each tier', () => {
    // Publish at Strong Play: alerts.
    expect(shouldAlertTierEntry('Strong Play', null, null)).toBe(true);
    // Later promotion to Sharp Take: alerts again, different tier.
    expect(shouldAlertTierEntry('Sharp Take', 'Strong Play',
      [{ tier: 'Strong Play', at: 't1' }])).toBe(true);
  });
});

describe('formatTierAlert', () => {
  const base = {
    pick: 'Kansas City Royals ML -112',
    sport: 'MLB',
    homeTeam: 'Kansas City Royals',
    awayTeam: 'Detroit Tigers',
    gameDate: '2026-08-22T23:16:00Z',
    edgePp: 10.8,
  };

  test('promotion message carries the tier, the path, and the link', () => {
    const msg = formatTierAlert({ ...base, tier: 'Sharp Take', previousTier: 'Strong Play' });
    expect(msg).toContain('Sharp Take');
    expect(msg).toContain('Kansas City Royals ML -112');
    expect(msg).toContain('Detroit Tigers @ Kansas City Royals');
    expect(msg).toContain('Edge 10.8pp');
    expect(msg).toContain('promoted from Strong Play');
    expect(msg).toContain('traphawk.io');
  });

  test('Strong Play fresh publish says so with its own emoji', () => {
    const msg = formatTierAlert({ ...base, tier: 'Strong Play', edgePp: 8.1, previousTier: null });
    expect(msg).toContain('📈 **Strong Play**');
    expect(msg).toContain('published straight to Strong Play');
  });
});

describe('sendTierAlert', () => {
  test('no webhook configured is a silent no-op', async () => {
    delete process.env.DISCORD_WEBHOOK_URL;
    const r = await sendTierAlert({ tier: 'Sharp Take', pick: 'X ML -110' });
    expect(r.sent).toBe(false);
    expect(r.reason).toContain('no webhook');
  });

  test('posts the formatted content to the webhook', async () => {
    process.env.DISCORD_WEBHOOK_URL = 'https://discord.example/webhook';
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 204 });
    const r = await sendTierAlert({ tier: 'Strong Play', pick: 'X ML -110', sport: 'MLB' });
    expect(r.sent).toBe(true);
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.content).toContain('X ML -110');
    expect(body.content).toContain('Strong Play');
    delete global.fetch;
    delete process.env.DISCORD_WEBHOOK_URL;
  });

  test('a webhook outage resolves instead of throwing', async () => {
    process.env.DISCORD_WEBHOOK_URL = 'https://discord.example/webhook';
    global.fetch = jest.fn().mockRejectedValue(new Error('down'));
    const r = await sendTierAlert({ tier: 'Sharp Take', pick: 'X ML -110' });
    expect(r.sent).toBe(false);
    delete global.fetch;
    delete process.env.DISCORD_WEBHOOK_URL;
  });
});
