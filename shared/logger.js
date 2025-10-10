/**
 * Structured Logging Utility
 * Provides consistent logging across the application
 */

const LOG_LEVELS = {
  ERROR: 'ERROR',
  WARN: 'WARN',
  INFO: 'INFO',
  DEBUG: 'DEBUG'
};

class Logger {
  constructor(context = 'App') {
    this.context = context;
    this.isDevelopment = process.env.NODE_ENV !== 'production';
  }

  _formatMessage(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      context: this.context,
      message,
      ...meta
    };

    return this.isDevelopment 
      ? this._formatForConsole(logEntry)
      : JSON.stringify(logEntry);
  }

  _formatForConsole(logEntry) {
    const { timestamp, level, context, message, ...meta } = logEntry;
    const time = new Date(timestamp).toLocaleTimeString();
    const emoji = this._getEmoji(level);
    
    let output = `${emoji} [${time}] [${context}] ${message}`;
    
    if (Object.keys(meta).length > 0) {
      output += '\n' + JSON.stringify(meta, null, 2);
    }
    
    return output;
  }

  _getEmoji(level) {
    switch (level) {
      case LOG_LEVELS.ERROR: return '❌';
      case LOG_LEVELS.WARN: return '⚠️';
      case LOG_LEVELS.INFO: return 'ℹ️';
      case LOG_LEVELS.DEBUG: return '🔍';
      default: return '📝';
    }
  }

  error(message, meta = {}) {
    const formatted = this._formatMessage(LOG_LEVELS.ERROR, message, meta);
    console.error(formatted);
  }

  warn(message, meta = {}) {
    const formatted = this._formatMessage(LOG_LEVELS.WARN, message, meta);
    console.warn(formatted);
  }

  info(message, meta = {}) {
    const formatted = this._formatMessage(LOG_LEVELS.INFO, message, meta);
    console.log(formatted);
  }

  debug(message, meta = {}) {
    if (this.isDevelopment) {
      const formatted = this._formatMessage(LOG_LEVELS.DEBUG, message, meta);
      console.log(formatted);
    }
  }

  // Specialized logging methods
  apiCall(method, url, meta = {}) {
    this.info(`API ${method} ${url}`, meta);
  }

  apiError(method, url, error, meta = {}) {
    this.error(`API ${method} ${url} failed`, {
      error: error.message,
      stack: error.stack,
      ...meta
    });
  }

  agentStart(agentName, meta = {}) {
    this.info(`🤖 ${agentName} started`, meta);
  }

  agentComplete(agentName, duration, meta = {}) {
    this.info(`✅ ${agentName} completed`, { duration, ...meta });
  }

  agentError(agentName, error, meta = {}) {
    this.error(`❌ ${agentName} failed`, {
      error: error.message,
      stack: error.stack,
      ...meta
    });
  }
}

// Create default logger instance
const logger = new Logger('CrayCray');

// Export factory function for context-specific loggers
function createLogger(context) {
  return new Logger(context);
}

module.exports = {
  logger,
  createLogger,
  LOG_LEVELS
};
