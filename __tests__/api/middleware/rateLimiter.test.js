const { RateLimiter } = require('../../../api/middleware/rateLimiter');

describe('Rate Limiter', () => {
  let rateLimiter, req, res, next;

  beforeEach(() => {
    rateLimiter = new RateLimiter({
      windowMs: 1000, // 1 second for testing
      maxRequests: 3
    });

    req = {
      headers: {},
      connection: { remoteAddress: '127.0.0.1' }
    };

    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      setHeader: jest.fn()
    };

    next = jest.fn();
  });

  test('allows requests under the limit', () => {
    const middleware = rateLimiter.middleware();

    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('blocks requests over the limit', () => {
    const middleware = rateLimiter.middleware();

    // Make 3 requests (at limit)
    middleware(req, res, next);
    middleware(req, res, next);
    middleware(req, res, next);

    // 4th request should be blocked
    next.mockClear();
    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.any(String),
        retryAfter: expect.any(Number)
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  test('sets rate limit headers', () => {
    const middleware = rateLimiter.middleware();

    middleware(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 3);
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', expect.any(Number));
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Reset', expect.any(String));
  });

  test('resets after time window', (done) => {
    const middleware = rateLimiter.middleware();

    // Make 3 requests (at limit)
    middleware(req, res, next);
    middleware(req, res, next);
    middleware(req, res, next);

    // Wait for window to expire
    setTimeout(() => {
      next.mockClear();
      res.status.mockClear();

      // Should allow request again
      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
      done();
    }, 1100);
  });

  test('tracks different IPs separately', () => {
    const middleware = rateLimiter.middleware();

    const req1 = { ...req, connection: { remoteAddress: '127.0.0.1' } };
    const req2 = { ...req, connection: { remoteAddress: '192.168.1.1' } };

    // Make 3 requests from IP1
    middleware(req1, res, next);
    middleware(req1, res, next);
    middleware(req1, res, next);

    // IP2 should still be allowed
    next.mockClear();
    middleware(req2, res, next);
    expect(next).toHaveBeenCalled();
  });
});
