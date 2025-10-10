/**
 * Rate Limiting Middleware
 * Prevents API abuse and manages request quotas
 */

const { logger } = require('../../shared/logger');

/**
 * Simple in-memory rate limiter
 * For production, consider using Redis-backed rate limiting
 */
class RateLimiter {
  constructor(options = {}) {
    this.windowMs = options.windowMs || 15 * 60 * 1000; // 15 minutes default
    this.maxRequests = options.maxRequests || 10;
    this.message = options.message || 'Too many requests, please try again later';
    this.requests = new Map(); // IP -> [timestamps]
    
    // Clean up old entries every minute
    setInterval(() => this.cleanup(), 60 * 1000);
  }

  middleware() {
    return (req, res, next) => {
      const ip = this.getClientIp(req);
      const now = Date.now();
      
      // Get request history for this IP
      if (!this.requests.has(ip)) {
        this.requests.set(ip, []);
      }
      
      const requestTimes = this.requests.get(ip);
      
      // Remove requests outside the time window
      const validRequests = requestTimes.filter(time => now - time < this.windowMs);
      
      // Check if limit exceeded
      if (validRequests.length >= this.maxRequests) {
        const oldestRequest = Math.min(...validRequests);
        const resetTime = new Date(oldestRequest + this.windowMs);
        
        logger.warn('Rate limit exceeded', {
          ip,
          requestCount: validRequests.length,
          maxRequests: this.maxRequests,
          resetTime: resetTime.toISOString()
        });
        
        return res.status(429).json({
          error: this.message,
          retryAfter: Math.ceil((oldestRequest + this.windowMs - now) / 1000),
          resetTime: resetTime.toISOString()
        });
      }
      
      // Add current request
      validRequests.push(now);
      this.requests.set(ip, validRequests);
      
      // Add rate limit headers
      res.setHeader('X-RateLimit-Limit', this.maxRequests);
      res.setHeader('X-RateLimit-Remaining', this.maxRequests - validRequests.length);
      res.setHeader('X-RateLimit-Reset', new Date(now + this.windowMs).toISOString());
      
      next();
    };
  }

  getClientIp(req) {
    return req.headers['x-forwarded-for']?.split(',')[0].trim() ||
           req.headers['x-real-ip'] ||
           req.connection.remoteAddress ||
           req.socket.remoteAddress ||
           'unknown';
  }

  cleanup() {
    const now = Date.now();
    for (const [ip, times] of this.requests.entries()) {
      const validTimes = times.filter(time => now - time < this.windowMs);
      if (validTimes.length === 0) {
        this.requests.delete(ip);
      } else {
        this.requests.set(ip, validTimes);
      }
    }
  }

  reset(ip) {
    this.requests.delete(ip);
  }
}

// Create rate limiter instances for different endpoints
const parlayRateLimiter = new RateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 10,
  message: 'Too many parlay generation requests. Please wait before trying again.'
});

const generalRateLimiter = new RateLimiter({
  windowMs: 1 * 60 * 1000, // 1 minute
  maxRequests: 60,
  message: 'Too many requests. Please slow down.'
});

module.exports = {
  RateLimiter,
  parlayRateLimiter,
  generalRateLimiter
};
