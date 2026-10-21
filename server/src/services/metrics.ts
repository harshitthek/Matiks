/**
 * MATIKS HACKATHON ENGINE — LOW-CARDINALITY PROMETHEUS METRICS (metrics.ts)
 * 
 * High-performance, zero-dependency Prometheus exposition text generator.
 * Enforces strict low-cardinality label sanitation to prevent metric explosion
 * during high-concurrency hackathon tournaments.
 */

import type { Request, Response, NextFunction } from 'express';
import { sseHub } from './sseHub.js';
import { roomManager } from './roomManager.js';
import { windowManager } from './windowManager.js';

const KNOWN_HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD']);

export function normalizeMethod(rawMethod?: string): string {
  if (!rawMethod) return 'OTHER';
  const upper = rawMethod.trim().toUpperCase();
  return KNOWN_HTTP_METHODS.has(upper) ? upper : 'OTHER';
}

export function normalizeRoute(rawPath: string): string {
  const path = (rawPath || '/').split('?')[0].replace(/\/+$/, '') || '/';

  // Exact static routes
  if (
    path === '/api/health' ||
    path === '/api/auth/config' ||
    path === '/api/auth/login' ||
    path === '/api/auth/admin-login' ||
    path === '/api/auth/me' ||
    path === '/api/auth/oidc/exchange' ||
    path === '/api/auth/callback/fossclub' ||
    path === '/api/sse/leaderboard' ||
    path === '/api/sse/admin' ||
    path === '/api/team/create' ||
    path === '/api/team/join' ||
    path === '/api/team/ready' ||
    path === '/api/team/leave' ||
    path === '/api/team/reset' ||
    path === '/api/sprint/submit' ||
    path === '/api/sprint/sync' ||
    path === '/api/admin/window/toggle' ||
    path === '/api/admin/audit-logs' ||
    path === '/api/admin/telemetry' ||
    path === '/api/admin/rooms' ||
    path === '/api/admin/stream-ticket' ||
    path === '/api/admin/simulate-teams' ||
    path === '/api/admin/clear-simulated-teams' ||
    path === '/api/admin/export/csv' ||
    path === '/api/admin/export/json' ||
    path === '/api/admin/stream-delay' ||
    path === '/api/admin/flush-leaderboard' ||
    path === '/api/admin/replays' ||
    path === '/api/admin/export/player-audits-csv' ||
    path === '/api/admin/login' ||
    path === '/api/admin/emergency/pause-all' ||
    path === '/api/admin/emergency/resume-all' ||
    path === '/api/admin/broadcast' ||
    path === '/api/admin/round-mode' ||
    path === '/metrics'
  ) {
    return path;
  }

  // Parameterized dynamic routes
  if (/^\/api\/auth\/verify-membership\/[^/]+$/.test(path)) {
    return '/api/auth/verify-membership/:identifier';
  }
  if (/^\/api\/sse\/team\/[^/]+$/.test(path)) {
    return '/api/sse/team/:teamCode';
  }
  if (/^\/api\/admin\/teams\/[^/]+\/excuse-member$/.test(path)) {
    return '/api/admin/teams/:teamCode/excuse-member';
  }
  if (/^\/api\/admin\/teams\/[^/]+\/pause$/.test(path)) {
    return '/api/admin/teams/:teamCode/pause';
  }
  if (/^\/api\/admin\/teams\/[^/]+\/resume$/.test(path)) {
    return '/api/admin/teams/:teamCode/resume';
  }
  if (/^\/api\/admin\/teams\/[^/]+\/kick-member$/.test(path)) {
    return '/api/admin/teams/:teamCode/kick-member';
  }
  if (/^\/api\/admin\/teams\/[^/]+\/dissolve$/.test(path)) {
    return '/api/admin/teams/:teamCode/dissolve';
  }
  if (/^\/api\/admin\/teams\/[^/]+\/disqualify$/.test(path)) {
    return '/api/admin/teams/:teamCode/disqualify';
  }
  if (/^\/api\/admin\/teams\/[^/]+\/reinstate$/.test(path)) {
    return '/api/admin/teams/:teamCode/reinstate';
  }
  if (/^\/api\/admin\/teams\/[^/]+\/adjust-score$/.test(path)) {
    return '/api/admin/teams/:teamCode/adjust-score';
  }
  if (/^\/api\/admin\/replay\/[^/]+$/.test(path)) {
    return '/api/admin/replay/:sessionId';
  }
  if (/^\/api\/team\/[^/]+$/.test(path)) {
    return '/api/team/:teamCode';
  }

  // Fallback for unmatched routes to prevent cardinality explosion
  return 'unknown';
}

function escapeLabelValue(val: unknown): string {
  return String(val)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

function formatLabels(labels?: Record<string, string>): string {
  if (!labels) return '';
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return '';
  const pairs = keys.map(k => `${k}="${escapeLabelValue(labels[k])}"`);
  return `{${pairs.join(',')}}`;
}

function serializeLabelKey(labels?: Record<string, string>): string {
  if (!labels) return '';
  return Object.keys(labels)
    .sort()
    .map(k => `${k}=${labels[k]}`)
    .join('|');
}

export class Counter {
  public readonly name: string;
  public readonly help: string;
  public readonly labelNames: string[];
  private values = new Map<string, { labels: Record<string, string>; value: number }>();

  constructor(name: string, help: string, labelNames: string[] = []) {
    this.name = name;
    this.help = help;
    this.labelNames = labelNames;
  }

  public inc(labels?: Record<string, string>, amount = 1): void {
    if (amount < 0) {
      throw new Error(`Counter ${this.name} cannot be decremented.`);
    }
    const key = serializeLabelKey(labels);
    const existing = this.values.get(key);
    if (existing) {
      existing.value += amount;
    } else {
      this.values.set(key, { labels: { ...(labels || {}) }, value: amount });
    }
  }

  public get(labels?: Record<string, string>): number {
    const key = serializeLabelKey(labels);
    return this.values.get(key)?.value ?? 0;
  }

  public reset(): void {
    this.values.clear();
  }

  public serialize(): string[] {
    const lines: string[] = [];
    lines.push(`# HELP ${this.name} ${this.help}`);
    lines.push(`# TYPE ${this.name} counter`);

    if (this.values.size === 0) {
      if (this.labelNames.length === 0) {
        lines.push(`${this.name} 0`);
      }
    } else {
      const sortedKeys = Array.from(this.values.keys()).sort();
      for (const k of sortedKeys) {
        const item = this.values.get(k)!;
        lines.push(`${this.name}${formatLabels(item.labels)} ${item.value}`);
      }
    }

    return lines;
  }
}

export class Gauge {
  public readonly name: string;
  public readonly help: string;
  public readonly labelNames: string[];
  private values = new Map<string, { labels: Record<string, string>; value: number }>();

  constructor(name: string, help: string, labelNames: string[] = []) {
    this.name = name;
    this.help = help;
    this.labelNames = labelNames;
  }

  public set(value: number, labels?: Record<string, string>): void {
    const key = serializeLabelKey(labels);
    const existing = this.values.get(key);
    if (existing) {
      existing.value = value;
    } else {
      this.values.set(key, { labels: { ...(labels || {}) }, value });
    }
  }

  public inc(labels?: Record<string, string>, amount = 1): void {
    const key = serializeLabelKey(labels);
    const existing = this.values.get(key);
    if (existing) {
      existing.value += amount;
    } else {
      this.values.set(key, { labels: { ...(labels || {}) }, value: amount });
    }
  }

  public dec(labels?: Record<string, string>, amount = 1): void {
    this.inc(labels, -amount);
  }

  public get(labels?: Record<string, string>): number {
    const key = serializeLabelKey(labels);
    return this.values.get(key)?.value ?? 0;
  }

  public reset(): void {
    this.values.clear();
  }

  public serialize(): string[] {
    const lines: string[] = [];
    lines.push(`# HELP ${this.name} ${this.help}`);
    lines.push(`# TYPE ${this.name} gauge`);

    if (this.values.size === 0) {
      if (this.labelNames.length === 0) {
        lines.push(`${this.name} 0`);
      }
    } else {
      const sortedKeys = Array.from(this.values.keys()).sort();
      for (const k of sortedKeys) {
        const item = this.values.get(k)!;
        lines.push(`${this.name}${formatLabels(item.labels)} ${item.value}`);
      }
    }

    return lines;
  }
}

interface HistogramEntry {
  labels: Record<string, string>;
  counts: number[];
  infCount: number;
  sum: number;
  count: number;
}

export class Histogram {
  public readonly name: string;
  public readonly help: string;
  public readonly buckets: number[];
  public readonly labelNames: string[];
  private values = new Map<string, HistogramEntry>();

  constructor(name: string, help: string, buckets: number[], labelNames: string[] = []) {
    this.name = name;
    this.help = help;
    this.buckets = [...buckets].sort((a, b) => a - b);
    this.labelNames = labelNames;
  }

  public observe(val: number, labels?: Record<string, string>): void {
    const key = serializeLabelKey(labels);
    let entry = this.values.get(key);
    if (!entry) {
      entry = {
        labels: { ...(labels || {}) },
        counts: new Array(this.buckets.length).fill(0),
        infCount: 0,
        sum: 0,
        count: 0
      };
      this.values.set(key, entry);
    }

    entry.sum += val;
    entry.count += 1;
    entry.infCount += 1;

    for (let i = 0; i < this.buckets.length; i++) {
      if (val <= this.buckets[i]) {
        entry.counts[i] += 1;
      }
    }
  }

  public get(labels?: Record<string, string>): { buckets: Record<number, number>; count: number; sum: number } {
    const key = serializeLabelKey(labels);
    const entry = this.values.get(key);
    if (!entry) {
      const emptyBuckets: Record<number, number> = {};
      this.buckets.forEach(b => (emptyBuckets[b] = 0));
      return { buckets: emptyBuckets, count: 0, sum: 0 };
    }
    const bucketMap: Record<number, number> = {};
    this.buckets.forEach((b, idx) => {
      bucketMap[b] = entry.counts[idx];
    });
    return {
      buckets: bucketMap,
      count: entry.count,
      sum: entry.sum
    };
  }

  public reset(): void {
    this.values.clear();
  }

  public serialize(): string[] {
    const lines: string[] = [];
    lines.push(`# HELP ${this.name} ${this.help}`);
    lines.push(`# TYPE ${this.name} histogram`);

    if (this.values.size === 0) {
      return lines;
    }

    const sortedKeys = Array.from(this.values.keys()).sort();
    for (const k of sortedKeys) {
      const entry = this.values.get(k)!;
      for (let i = 0; i < this.buckets.length; i++) {
        const bucketLabels = { ...entry.labels, le: String(this.buckets[i]) };
        lines.push(`${this.name}_bucket${formatLabels(bucketLabels)} ${entry.counts[i]}`);
      }
      const infLabels = { ...entry.labels, le: '+Inf' };
      lines.push(`${this.name}_bucket${formatLabels(infLabels)} ${entry.infCount}`);
      lines.push(`${this.name}_sum${formatLabels(entry.labels)} ${Math.round(entry.sum * 10000) / 10000}`);
      lines.push(`${this.name}_count${formatLabels(entry.labels)} ${entry.count}`);
    }

    return lines;
  }
}

export class MetricsRegistry {
  public readonly httpRequestsTotal: Counter;
  public readonly httpRequestDurationSeconds: Histogram;
  public readonly activeRooms: Gauge;
  public readonly connectedSseClients: Gauge;
  public readonly sprintSubmissionsTotal: Counter;
  public readonly sprintSubmissionReplaysTotal: Counter;
  public readonly rateLimitedTotal: Counter;
  public readonly redisCommandsTotal: Counter;
  public readonly redisErrorsTotal: Counter;
  public readonly stateBackendInfo: Gauge;
  public readonly redisHealthy: Gauge;
  public readonly stateFlushDurationSeconds: Histogram;
  public readonly outboxEventsTotal: Counter;
  public readonly outboxDepth: Gauge;
  public readonly submissionLatencySeconds: Histogram;
  public readonly contestWindowOpen: Gauge;
  public readonly processMemoryRssBytes: Gauge;
  public readonly processMemoryHeapUsedBytes: Gauge;
  public readonly processMemoryHeapTotalBytes: Gauge;
  public readonly processUptimeSeconds: Gauge;

  constructor() {
    this.httpRequestsTotal = new Counter(
      'http_requests_total',
      'Total count of HTTP requests processed by Matiks Engine',
      ['method', 'route', 'status']
    );

    this.httpRequestDurationSeconds = new Histogram(
      'http_request_duration_seconds',
      'Duration of HTTP requests in seconds',
      [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0],
      ['method', 'route', 'status']
    );

    this.activeRooms = new Gauge(
      'active_rooms',
      'Current count of active team rooms by lifecycle status',
      ['status']
    );

    this.connectedSseClients = new Gauge(
      'connected_sse_clients',
      'Number of active Server-Sent Event stream connections by channel',
      ['channel']
    );

    this.sprintSubmissionsTotal = new Counter(
      'sprint_submissions_total',
      'Total number of sprint math answers evaluated',
      ['operator', 'bucket', 'result']
    );

    this.sprintSubmissionReplaysTotal = new Counter(
      'sprint_submission_replays_total',
      'Answers submitted again for a question already answered, which were answered from the recorded result'
    );

    this.rateLimitedTotal = new Counter(
      'rate_limited_total',
      'Requests refused with 429 by a rate limiter',
      ['limiter']
    );

    this.redisCommandsTotal = new Counter(
      'redis_commands_total',
      'Redis commands issued, by logical operation (a pipeline counts each command in it)',
      ['op']
    );

    this.redisErrorsTotal = new Counter(
      'redis_errors_total',
      'Redis operations that failed or were skipped because the circuit was open',
      ['op']
    );

    this.stateBackendInfo = new Gauge(
      'state_backend_info',
      'Which state backend this process is using (the label value is the backend, the gauge is always 1)',
      ['backend']
    );

    this.redisHealthy = new Gauge(
      'redis_healthy',
      'Whether the Redis circuit is closed and Redis is configured (1) or not (0)'
    );

    this.stateFlushDurationSeconds = new Histogram(
      'state_flush_duration_seconds',
      'Time to write changed game state to Redis',
      [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0]
    );

    this.outboxEventsTotal = new Counter(
      'outbox_events_total',
      'Database writes that failed and were queued for retry, by kind and outcome (queued, retried_ok, dead)',
      ['kind', 'outcome']
    );

    this.outboxDepth = new Gauge(
      'outbox_depth',
      'Database writes waiting in the retry queue (state is waiting or dead)',
      ['state']
    );

    this.submissionLatencySeconds = new Histogram(
      'submission_latency_seconds',
      'Observed player submission latency in seconds',
      [0.2, 0.5, 1.0, 1.5, 2.0, 3.0, 5.0, 8.0, 12.0],
      ['operator', 'bucket']
    );

    this.contestWindowOpen = new Gauge(
      'contest_window_open',
      'Current contest window state (1 for open, 0 for closed)'
    );

    this.processMemoryRssBytes = new Gauge(
      'process_memory_rss_bytes',
      'Resident Set Size memory in bytes'
    );

    this.processMemoryHeapUsedBytes = new Gauge(
      'process_memory_heap_used_bytes',
      'Node.js V8 heap used in bytes'
    );

    this.processMemoryHeapTotalBytes = new Gauge(
      'process_memory_heap_total_bytes',
      'Node.js V8 heap total in bytes'
    );

    this.processUptimeSeconds = new Gauge(
      'process_uptime_seconds',
      'Process uptime in seconds'
    );
  }

  public recordSubmission(params: {
    operator?: string;
    bucket?: string;
    isCorrect: boolean;
    isAnomaly?: boolean;
    latencySeconds: number;
  }): void {
    const rawOp = (params.operator || '').toLowerCase().trim();
    const operator =
      rawOp === 'add' || rawOp === '+'
        ? 'add'
        : rawOp === 'sub' || rawOp === '-'
          ? 'sub'
          : 'other';

    const BUCKET_LABELS: Record<string, string> = {
      B1: 'no_carry',
      B2: 'ones_carry',
      B3: 'tens_carry',
      B4: 'double_carry',
      S1: 'no_borrow',
      S2: 'ones_borrow'
    };
    const normalizedBucket =
      BUCKET_LABELS[(params.bucket || '').toUpperCase()] ??
      (params.bucket || 'other').toLowerCase().replace(/\s+/g, '_');
    const bucket = [
      'no_carry',
      'ones_carry',
      'tens_carry',
      'double_carry',
      'no_borrow',
      'ones_borrow'
    ].includes(normalizedBucket)
      ? normalizedBucket
      : 'other';

    const result = params.isAnomaly ? 'anomaly' : params.isCorrect ? 'correct' : 'incorrect';

    this.sprintSubmissionsTotal.inc({ operator, bucket, result });
    this.submissionLatencySeconds.observe(Math.max(0, params.latencySeconds), { operator, bucket });
  }

  public reset(): void {
    this.httpRequestsTotal.reset();
    this.httpRequestDurationSeconds.reset();
    this.activeRooms.reset();
    this.connectedSseClients.reset();
    this.sprintSubmissionsTotal.reset();
    this.sprintSubmissionReplaysTotal.reset();
    this.rateLimitedTotal.reset();
    this.redisCommandsTotal.reset();
    this.redisErrorsTotal.reset();
    this.stateBackendInfo.reset();
    this.redisHealthy.reset();
    this.stateFlushDurationSeconds.reset();
    this.outboxEventsTotal.reset();
    this.outboxDepth.reset();
    this.submissionLatencySeconds.reset();
    this.contestWindowOpen.reset();
    this.processMemoryRssBytes.reset();
    this.processMemoryHeapUsedBytes.reset();
    this.processMemoryHeapTotalBytes.reset();
    this.processUptimeSeconds.reset();
  }

  /**
   * Refreshes dynamic runtime gauges and returns the standard Prometheus exposition output.
   */
  public getMetricsSnapshot(): string {
    // 1. Process memory & uptime
    const mem = process.memoryUsage();
    this.processMemoryRssBytes.set(mem.rss);
    this.processMemoryHeapUsedBytes.set(mem.heapUsed);
    this.processMemoryHeapTotalBytes.set(mem.heapTotal);
    this.processUptimeSeconds.set(Math.round(process.uptime() * 10) / 10);

    // 2. Contest window
    this.contestWindowOpen.set(windowManager.isOpen() ? 1 : 0);

    // 3. Active rooms by lifecycle status
    const roomCounts = roomManager.getRoomsCountByStatus();
    this.activeRooms.set(roomCounts.LOBBY, { status: 'lobby' });
    this.activeRooms.set(roomCounts.AWAITING_READY, { status: 'awaiting_ready' });
    this.activeRooms.set(roomCounts.COUNTDOWN, { status: 'countdown' });
    this.activeRooms.set(roomCounts.IN_SPRINT, { status: 'in_sprint' });
    this.activeRooms.set(roomCounts.PAUSED, { status: 'paused' });
    this.activeRooms.set(roomCounts.FINISHED, { status: 'finished' });

    // 4. Connected SSE stream clients
    const clientCounts = sseHub.getClientCounts();
    this.connectedSseClients.set(clientCounts.team, { channel: 'team' });
    this.connectedSseClients.set(clientCounts.leaderboard, { channel: 'leaderboard' });
    this.connectedSseClients.set(clientCounts.admin, { channel: 'admin' });

    const allLines: string[] = [
      ...this.httpRequestsTotal.serialize(),
      ...this.httpRequestDurationSeconds.serialize(),
      ...this.activeRooms.serialize(),
      ...this.connectedSseClients.serialize(),
      ...this.sprintSubmissionsTotal.serialize(),
      ...this.sprintSubmissionReplaysTotal.serialize(),
      ...this.rateLimitedTotal.serialize(),
      ...this.redisCommandsTotal.serialize(),
      ...this.redisErrorsTotal.serialize(),
      ...this.stateBackendInfo.serialize(),
      ...this.redisHealthy.serialize(),
      ...this.stateFlushDurationSeconds.serialize(),
      ...this.outboxEventsTotal.serialize(),
      ...this.outboxDepth.serialize(),
      ...this.submissionLatencySeconds.serialize(),
      ...this.contestWindowOpen.serialize(),
      ...this.processMemoryRssBytes.serialize(),
      ...this.processMemoryHeapUsedBytes.serialize(),
      ...this.processMemoryHeapTotalBytes.serialize(),
      ...this.processUptimeSeconds.serialize()
    ];

    return allLines.join('\n') + '\n';
  }
}

export const metrics = new MetricsRegistry();

/**
 * Express middleware that records request count and duration histograms
 * mapped to strictly normalized, low-cardinality route labels.
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startTime = process.hrtime.bigint();
  let recorded = false;

  const recordMetrics = () => {
    if (recorded) return;
    recorded = true;

    const elapsedNs = process.hrtime.bigint() - startTime;
    const durationSeconds = Number(elapsedNs) / 1e9;

    const method = normalizeMethod(req.method);
    const route = normalizeRoute(req.originalUrl || req.url);
    const status = String(res.statusCode);

    metrics.httpRequestsTotal.inc({ method, route, status });

    // Exclude long-lived SSE streams from HTTP request duration percentiles
    if (!route.startsWith('/api/sse/')) {
      metrics.httpRequestDurationSeconds.observe(durationSeconds, { method, route, status });
    }
  };

  res.on('finish', recordMetrics);
  res.on('close', recordMetrics);

  next();
}
