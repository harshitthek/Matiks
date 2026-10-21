/**
 * A small in-memory stand-in for the parts of the Upstash Redis client this service uses, so the Redis-backed code can be tested without a
 * network. Values are strings (the service stores strings only), keys expire against an injectable clock, and it can be told to fail or to
 * go slow, to exercise the circuit breaker and the fallbacks.
 */

type Value = { type: 'string'; v: string } | { type: 'list'; v: string[] } | { type: 'set'; v: Set<string> } | { type: 'zset'; v: Map<string, number> };

export class FakeRedis {
  private data = new Map<string, { value: Value; expiresAt: number | null }>();
  /** Every command received, by name, for asserting on how much was asked of Redis. */
  readonly calls: string[] = [];
  /** When set, every command throws this. */
  failWith: Error | null = null;
  now: () => number = Date.now;

  /** How many commands of this name (or all, if none given) have been received. */
  count(name?: string): number {
    return name ? this.calls.filter((c) => c === name).length : this.calls.length;
  }

  private record(name: string): void {
    this.calls.push(name);
    if (this.failWith) throw this.failWith;
  }

  private entry(key: string) {
    const e = this.data.get(key);
    if (!e) return undefined;
    if (e.expiresAt !== null && this.now() >= e.expiresAt) {
      this.data.delete(key);
      return undefined;
    }
    return e;
  }

  keysWithPrefix(prefix: string): string[] {
    return [...this.data.keys()].filter((k) => k.startsWith(prefix) && this.entry(k));
  }

  /* ---- strings ---- */
  async ping() {
    this.record('ping');
    return 'PONG';
  }
  async get<T = string>(key: string): Promise<T | null> {
    this.record('get');
    const e = this.entry(key);
    return e && e.value.type === 'string' ? (e.value.v as unknown as T) : null;
  }
  async set(key: string, value: string, opts?: { ex?: number; px?: number; nx?: boolean }) {
    this.record('set');
    if (opts?.nx && this.entry(key)) return null;
    const ttl = opts?.px ?? (opts?.ex !== undefined ? opts.ex * 1000 : undefined);
    this.data.set(key, { value: { type: 'string', v: String(value) }, expiresAt: ttl !== undefined ? this.now() + ttl : null });
    return 'OK';
  }
  async getdel<T = string>(key: string): Promise<T | null> {
    this.record('getdel');
    const e = this.entry(key);
    this.data.delete(key);
    return e && e.value.type === 'string' ? (e.value.v as unknown as T) : null;
  }
  async del(...keys: string[]) {
    this.record('del');
    let n = 0;
    for (const k of keys) if (this.entry(k)) { this.data.delete(k); n++; }
    return n;
  }
  async mget<T = string>(...keys: string[]): Promise<(T | null)[]> {
    this.record('mget');
    return keys.map((k) => {
      const e = this.entry(k);
      return e && e.value.type === 'string' ? (e.value.v as unknown as T) : null;
    });
  }
  async incr(key: string) {
    this.record('incr');
    const e = this.entry(key);
    const next = (e && e.value.type === 'string' ? Number(e.value.v) : 0) + 1;
    this.data.set(key, { value: { type: 'string', v: String(next) }, expiresAt: e?.expiresAt ?? null });
    return next;
  }
  async pexpire(key: string, ms: number, mode?: 'NX' | 'XX') {
    this.record('pexpire');
    const e = this.entry(key);
    if (!e) return 0;
    if (mode === 'NX' && e.expiresAt !== null) return 0;
    e.expiresAt = this.now() + ms;
    return 1;
  }
  async pttl(key: string) {
    this.record('pttl');
    const e = this.entry(key);
    if (!e) return -2;
    return e.expiresAt === null ? -1 : Math.max(0, e.expiresAt - this.now());
  }

  /* ---- sets ---- */
  private set_(key: string): Set<string> {
    const e = this.entry(key);
    if (e && e.value.type === 'set') return e.value.v;
    const created = new Set<string>();
    this.data.set(key, { value: { type: 'set', v: created }, expiresAt: null });
    return created;
  }
  async sadd(key: string, ...members: string[]) {
    this.record('sadd');
    const s = this.set_(key);
    let n = 0;
    for (const m of members) if (!s.has(m)) { s.add(m); n++; }
    return n;
  }
  async srem(key: string, ...members: string[]) {
    this.record('srem');
    const s = this.set_(key);
    let n = 0;
    for (const m of members) if (s.delete(m)) n++;
    return n;
  }
  async smembers(key: string): Promise<string[]> {
    this.record('smembers');
    const e = this.entry(key);
    return e && e.value.type === 'set' ? [...e.value.v] : [];
  }

  /* ---- lists ---- */
  private list(key: string): string[] {
    const e = this.entry(key);
    if (e && e.value.type === 'list') return e.value.v;
    const created: string[] = [];
    this.data.set(key, { value: { type: 'list', v: created }, expiresAt: null });
    return created;
  }
  async rpush(key: string, ...values: string[]) {
    this.record('rpush');
    const l = this.list(key);
    l.push(...values.map(String));
    return l.length;
  }
  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    this.record('lrange');
    const e = this.entry(key);
    if (!e || e.value.type !== 'list') return [];
    const l = e.value.v;
    const from = start < 0 ? Math.max(0, l.length + start) : start;
    const to = stop < 0 ? l.length + stop : stop;
    return l.slice(from, to + 1);
  }
  async ltrim(key: string, start: number, stop: number) {
    this.record('ltrim');
    const e = this.entry(key);
    if (!e || e.value.type !== 'list') return 'OK';
    const l = e.value.v;
    const from = start < 0 ? Math.max(0, l.length + start) : start;
    const to = stop < 0 ? l.length + stop : stop;
    e.value.v = l.slice(from, to + 1);
    return 'OK';
  }
  async lindex(key: string, index: number): Promise<string | null> {
    this.record('lindex');
    const e = this.entry(key);
    if (!e || e.value.type !== 'list') return null;
    return e.value.v[index < 0 ? e.value.v.length + index : index] ?? null;
  }
  async lpop(key: string): Promise<string | null> {
    this.record('lpop');
    const e = this.entry(key);
    if (!e || e.value.type !== 'list') return null;
    return e.value.v.shift() ?? null;
  }
  async lset(key: string, index: number, value: string) {
    this.record('lset');
    const e = this.entry(key);
    if (!e || e.value.type !== 'list' || index >= e.value.v.length) throw new Error('ERR index out of range');
    e.value.v[index] = value;
    return 'OK';
  }
  async llen(key: string) {
    this.record('llen');
    const e = this.entry(key);
    return e && e.value.type === 'list' ? e.value.v.length : 0;
  }

  /* ---- sorted sets ---- */
  private zset(key: string): Map<string, number> {
    const e = this.entry(key);
    if (e && e.value.type === 'zset') return e.value.v;
    const created = new Map<string, number>();
    this.data.set(key, { value: { type: 'zset', v: created }, expiresAt: null });
    return created;
  }
  async zadd(key: string, ...entries: Array<{ score: number; member: string }>) {
    this.record('zadd');
    const z = this.zset(key);
    let n = 0;
    for (const { score, member } of entries) {
      if (!z.has(member)) n++;
      z.set(member, score);
    }
    return n;
  }
  async zrange(key: string, start: number, stop: number, opts?: { rev?: boolean }): Promise<string[]> {
    this.record('zrange');
    const e = this.entry(key);
    if (!e || e.value.type !== 'zset') return [];
    const sorted = [...e.value.v.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
    if (opts?.rev) sorted.reverse();
    const to = stop < 0 ? sorted.length + stop : stop;
    return sorted.slice(start, to + 1).map(([m]) => m);
  }
  async zrem(key: string, ...members: string[]) {
    this.record('zrem');
    const e = this.entry(key);
    if (!e || e.value.type !== 'zset') return 0;
    let n = 0;
    for (const m of members) if (e.value.v.delete(m)) n++;
    return n;
  }

  /* ---- transactions and pipelines: queue the calls, then run them together ---- */
  multi(): Chain {
    return new Chain(this);
  }
  pipeline(): Chain {
    return new Chain(this);
  }

  asRedis(): never {
    return this as never;
  }
}

type Cmd = (r: FakeRedis) => Promise<unknown>;

class Chain {
  private readonly queue: Cmd[] = [];
  constructor(private readonly redis: FakeRedis) {}
  private add(fn: Cmd): this {
    this.queue.push(fn);
    return this;
  }
  set(...a: Parameters<FakeRedis['set']>) { return this.add((r) => r.set(...a)); }
  del(...a: string[]) { return this.add((r) => r.del(...a)); }
  incr(k: string) { return this.add((r) => r.incr(k)); }
  pexpire(k: string, ms: number, mode?: 'NX' | 'XX') { return this.add((r) => r.pexpire(k, ms, mode)); }
  pttl(k: string) { return this.add((r) => r.pttl(k)); }
  sadd(k: string, ...m: string[]) { return this.add((r) => r.sadd(k, ...m)); }
  srem(k: string, ...m: string[]) { return this.add((r) => r.srem(k, ...m)); }
  rpush(k: string, ...v: string[]) { return this.add((r) => r.rpush(k, ...v)); }
  ltrim(k: string, a: number, b: number) { return this.add((r) => r.ltrim(k, a, b)); }
  zadd(k: string, ...e: Array<{ score: number; member: string }>) { return this.add((r) => r.zadd(k, ...e)); }
  zrem(k: string, ...m: string[]) { return this.add((r) => r.zrem(k, ...m)); }
  async exec<T = unknown[]>(): Promise<T> {
    const results: unknown[] = [];
    for (const cmd of this.queue) results.push(await cmd(this.redis));
    return results as T;
  }
}
