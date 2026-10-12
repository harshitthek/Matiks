/**
 * MATIKS HACKATHON ENGINE — STRUCTURED NDJSON LOGGER (logger.ts)
 * 
 * Provides high-performance structured NDJSON logging with request correlation IDs,
 * log-level filtering, and clean Error object serialization without external dependencies.
 */

import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LOG_LEVEL_SEVERITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 99
};

function getActiveLogLevel(): LogLevel {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase() as LogLevel | undefined;
  if (envLevel && envLevel in LOG_LEVEL_SEVERITY) {
    return envLevel;
  }
  if (process.env.NODE_ENV === 'test') {
    return 'silent';
  }
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

export class Logger {
  private level: LogLevel;
  private minSeverity: number;
  private pid = process.pid;
  private writeStream: ((line: string, level: LogLevel) => void) | null = null;

  constructor(level?: LogLevel) {
    this.level = level || getActiveLogLevel();
    this.minSeverity = LOG_LEVEL_SEVERITY[this.level];
  }

  public setLevel(level: LogLevel): void {
    this.level = level;
    this.minSeverity = LOG_LEVEL_SEVERITY[level];
  }

  public getLevel(): LogLevel {
    return this.level;
  }

  public isLevelEnabled(level: LogLevel): boolean {
    return LOG_LEVEL_SEVERITY[level] >= this.minSeverity;
  }

  /**
   * Allows unit tests to capture raw NDJSON lines in-memory without polluting process stdio.
   */
  public setOutputInterceptor(interceptor: ((line: string, level: LogLevel) => void) | null): void {
    this.writeStream = interceptor;
  }

  public formatEntry(
    level: Exclude<LogLevel, 'silent'>,
    message: string,
    meta?: Record<string, unknown>,
    err?: unknown
  ): Record<string, unknown> {
    const entry: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      pid: this.pid,
      msg: message
    };

    if (meta && typeof meta === 'object') {
      for (const [k, v] of Object.entries(meta)) {
        if (k !== 'msg' && k !== 'level' && k !== 'timestamp') {
          entry[k] = v;
        }
      }
    }

    if (err) {
      if (err instanceof Error) {
        entry.err = {
          name: err.name,
          message: err.message,
          stack: err.stack
        };
      } else {
        entry.err = String(err);
      }
    }

    return entry;
  }

  private write(level: Exclude<LogLevel, 'silent'>, message: string, meta?: Record<string, unknown>, err?: unknown): void {
    if (LOG_LEVEL_SEVERITY[level] < this.minSeverity) {
      return;
    }

    const entry = this.formatEntry(level, message, meta, err);
    const serialized = JSON.stringify(entry) + '\n';

    if (this.writeStream) {
      this.writeStream(serialized, level);
      return;
    }

    if (level === 'error') {
      process.stderr.write(serialized);
    } else {
      process.stdout.write(serialized);
    }
  }

  public debug(message: string, meta?: Record<string, unknown>): void {
    this.write('debug', message, meta);
  }

  public info(message: string, meta?: Record<string, unknown>): void {
    this.write('info', message, meta);
  }

  public warn(message: string, meta?: Record<string, unknown>, err?: unknown): void {
    this.write('warn', message, meta, err);
  }

  public error(message: string, meta?: Record<string, unknown>, err?: unknown): void {
    this.write('error', message, meta, err);
  }
}

export const logger = new Logger();

declare global {
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

const SAFE_REQ_ID_REGEX = /^[a-zA-Z0-9_\-.]{1,64}$/;

function sanitizeCorrelationId(candidate: unknown): string | null {
  if (typeof candidate !== 'string') return null;
  const trimmed = candidate.trim();
  return SAFE_REQ_ID_REGEX.test(trimmed) ? trimmed : null;
}

function anonymizeIp(rawIp?: string): string {
  if (!rawIp) return 'unknown';
  if (process.env.LOG_FULL_IP === 'true') return rawIp;
  if (rawIp.includes('.')) {
    const parts = rawIp.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.xxx.xxx.${parts[3]}`;
    }
  }
  if (rawIp.includes(':')) {
    const parts = rawIp.split(':');
    return `${parts.slice(0, 2).join(':')}::xxx`;
  }
  return 'masked';
}

let reqCounter = 0;
function generateRequestId(): string {
  reqCounter = (reqCounter + 1) | 0;
  return `req_${Date.now().toString(36)}_${Math.abs(reqCounter).toString(36)}`;
}

/**
 * Express middleware that binds a correlation ID to every incoming HTTP request,
 * echoes it via X-Request-Id header, and logs completion telemetry.
 */
export function requestLoggingMiddleware(req: Request, res: Response, next: NextFunction): void {
  const reqId =
    sanitizeCorrelationId(req.headers['x-request-id']) ||
    sanitizeCorrelationId(req.headers['x-correlation-id']) ||
    generateRequestId();

  req.id = reqId;
  res.setHeader('X-Request-Id', reqId);

  const startTime = process.hrtime.bigint();
  let logged = false;

  const logCompletion = () => {
    if (logged) return;
    logged = true;

    const rawPath = (req.originalUrl || req.url || '').split('?')[0] || '/';
    const isQuietPoll = rawPath === '/api/health' || rawPath === '/metrics';
    const level: LogLevel = isQuietPoll ? 'debug' : 'info';

    if (!logger.isLevelEnabled(level)) {
      return;
    }

    const elapsedNs = process.hrtime.bigint() - startTime;
    const durationMs = Number(elapsedNs) / 1e6;
    const logMethod = isQuietPoll ? logger.debug.bind(logger) : logger.info.bind(logger);

    logMethod('HTTP request completed', {
      reqId,
      method: req.method,
      url: rawPath,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
      ip: anonymizeIp(req.ip || req.socket.remoteAddress)
    });
  };

  res.on('finish', logCompletion);
  res.on('close', logCompletion);

  next();
}
