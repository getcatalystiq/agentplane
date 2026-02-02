/**
 * Structured logging for AgentPlane
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  [key: string]: unknown;
}

function emit(level: LogLevel, message: string, context?: LogContext): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context,
  };

  // Use appropriate console method based on level
  switch (level) {
    case 'error':
      console.error(JSON.stringify(entry));
      break;
    case 'warn':
      console.warn(JSON.stringify(entry));
      break;
    case 'debug':
      console.debug(JSON.stringify(entry));
      break;
    default:
      console.log(JSON.stringify(entry));
  }
}

export const log = {
  debug: (msg: string, ctx?: LogContext): void => emit('debug', msg, ctx),
  info: (msg: string, ctx?: LogContext): void => emit('info', msg, ctx),
  warn: (msg: string, ctx?: LogContext): void => emit('warn', msg, ctx),
  error: (msg: string, ctx?: LogContext): void => emit('error', msg, ctx),
};
