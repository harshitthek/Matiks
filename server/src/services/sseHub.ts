/**
 * MATIKS HACKATHON ENGINE — SERVER-SENT EVENTS HUB (sseHub.ts)
 * 
 * Manages active HTTP event-stream connections across team, leaderboard, and admin channels.
 * Features:
 * 1. Monotonic event IDs formatted with process epoch on broadcasts (`id: 1728770000:104\n`)
 * 2. In-memory circular buffer of last 100 events per channel
 * 3. Automatic missed-event replay on reconnection via Last-Event-ID / ?lastEventId=
 * 4. Process epoch mismatch detection to cleanly resync clients across server restarts
 * 5. 15-second keepalive heartbeats (`:keepalive\n\n`) to prevent proxy timeout disconnects
 * 6. Proxy buffering suppression (`X-Accel-Buffering: no`, `Cache-Control: no-cache, no-transform`)
 */

import type { Response } from 'express';

export interface BufferedSseEvent {
  id: number;
  event: string;
  data: unknown;
  serializedData: string;
  timestamp: number;
}

export interface SseCursor {
  epoch?: number;
  seq: number;
}

export class SseHub {
  public static readonly MAX_BUFFER_SIZE = 100;
  public readonly epoch = Math.floor(Date.now() / 1000);

  private channels = new Map<string, Set<Response>>();
  private channelEventIds = new Map<string, number>();
  private eventBuffers = new Map<string, BufferedSseEvent[]>();
  private keepaliveTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.startKeepalive();
  }

  /**
   * Initializes SSE headers on an Express HTTP response and registers it to a channel.
   * If a valid lastCursor is provided, replays any missed events from the circular buffer
   * or emits stream_resync if the cursor has an epoch mismatch, is ahead, or predates the buffer.
   * Returns a cleanup function to detach the client upon disconnection.
   */
  public registerClient(channel: string, res: Response, lastCursor?: number | SseCursor): () => void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    // Send immediate stream open handshake
    res.write(':connected\n\n');

    const cursor: SseCursor | undefined =
      typeof lastCursor === 'number'
        ? { seq: lastCursor }
        : lastCursor;

    // Replay missed buffered events if cursor is specified
    if (cursor && typeof cursor.seq === 'number' && !Number.isNaN(cursor.seq) && cursor.seq >= 0) {
      const currentId = this.getLastEventId(channel);
      const currentCursorStr = `${this.epoch}:${currentId}`;

      // 1. Process epoch mismatch -> forced resynchronization
      if (cursor.epoch !== undefined && cursor.epoch !== this.epoch) {
        try {
          res.write(`id: ${currentCursorStr}\nevent: stream_resync\ndata: ${JSON.stringify({
            reason: 'EPOCH_MISMATCH',
            serverEpoch: this.epoch,
            clientEpoch: cursor.epoch,
            latestAvailableId: currentId,
            requestedLastEventId: cursor.seq
          })}\n\n`);
        } catch {
          // Socket write failed
        }
      } else if (cursor.seq > currentId) {
        // 2. Cursor ahead of server sequence -> forced resynchronization
        try {
          res.write(`id: ${currentCursorStr}\nevent: stream_resync\ndata: ${JSON.stringify({
            reason: 'CURSOR_AHEAD',
            latestAvailableId: currentId,
            requestedLastEventId: cursor.seq
          })}\n\n`);
        } catch {
          // Socket write failed
        }
      } else {
        const buffer = this.eventBuffers.get(channel);
        if (!buffer || buffer.length === 0) {
          // 3. Buffer empty (e.g. cleared channel), but client cursor is behind currentId
          if (cursor.seq < currentId) {
            try {
              res.write(`id: ${currentCursorStr}\nevent: stream_resync\ndata: ${JSON.stringify({
                reason: 'BUFFER_OVERFLOW',
                latestAvailableId: currentId,
                requestedLastEventId: cursor.seq
              })}\n\n`);
            } catch {
              // Socket write failed
            }
          }
        } else {
          const oldest = buffer[0];
          // 4. Cursor predates oldest retained event -> buffer overflow gap
          if (oldest && cursor.seq < oldest.id - 1) {
            try {
              res.write(`id: ${currentCursorStr}\nevent: stream_resync\ndata: ${JSON.stringify({
                reason: 'BUFFER_OVERFLOW',
                oldestAvailableId: oldest.id,
                latestAvailableId: currentId,
                requestedLastEventId: cursor.seq
              })}\n\n`);
            } catch {
              // Socket write failed
            }
          } else {
            // 5. Contiguous replay
            const missed = buffer.filter(item => item.id > cursor.seq);
            for (const item of missed) {
              try {
                res.write(`id: ${this.epoch}:${item.id}\nevent: ${item.event}\ndata: ${item.serializedData}\n\n`);
              } catch {
                // Socket write failed
                break;
              }
            }
          }
        }
      }
    }

    if (!this.channels.has(channel)) {
      this.channels.set(channel, new Set());
    }
    const clientSet = this.channels.get(channel)!;
    clientSet.add(res);

    const cleanup = () => {
      clientSet.delete(res);
      if (clientSet.size === 0) {
        this.channels.delete(channel);
      }
    };

    res.on('close', cleanup);
    res.on('error', cleanup);

    return cleanup;
  }

  /**
   * Broadcasts a named event with a JSON payload to all active clients on a channel.
   * Assigns a monotonic sequence ID with process epoch and records the event in the circular replay buffer.
   */
  public broadcast(channel: string, event: string, data: unknown): number {
    const id = (this.channelEventIds.get(channel) || 0) + 1;
    this.channelEventIds.set(channel, id);
    const serializedData = JSON.stringify(data);

    let buffer = this.eventBuffers.get(channel);
    if (!buffer) {
      buffer = [];
      this.eventBuffers.set(channel, buffer);
    }
    buffer.push({
      id,
      event,
      data,
      serializedData,
      timestamp: Date.now()
    });

    if (buffer.length > SseHub.MAX_BUFFER_SIZE) {
      buffer.splice(0, buffer.length - SseHub.MAX_BUFFER_SIZE);
    }

    const clientSet = this.channels.get(channel);
    if (clientSet && clientSet.size > 0) {
      const message = `id: ${this.epoch}:${id}\nevent: ${event}\ndata: ${serializedData}\n\n`;
      for (const client of clientSet) {
        try {
          client.write(message);
        } catch {
          clientSet.delete(client);
        }
      }
    }

    return id;
  }

  /**
   * Sends an immediate direct event to a single client connection.
   */
  public sendDirect(res: Response, event: string, data: unknown, eventId?: number | string): void {
    try {
      const idPrefix = eventId !== undefined ? `id: ${eventId}\n` : '';
      res.write(`${idPrefix}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      // Stream write error
    }
  }

  /**
   * Returns a copy of the circular replay buffer for a channel.
   */
  public getEventBuffer(channel: string): BufferedSseEvent[] {
    return [...(this.eventBuffers.get(channel) || [])];
  }

  /**
   * Returns the most recent monotonic event ID for a channel.
   */
  public getLastEventId(channel: string): number {
    return this.channelEventIds.get(channel) || 0;
  }

  /**
   * Clears the event buffer for a specific channel, preserving monotonic event sequence.
   */
  public clearChannelBuffer(channel: string): void {
    this.eventBuffers.delete(channel);
  }

  /**
   * Clears all event buffers and resets channel event counters.
   */
  public clearAllBuffers(): void {
    this.eventBuffers.clear();
    this.channelEventIds.clear();
  }

  /**
   * Counts active listeners on a specific channel, or across the whole server.
   */
  public getClientCount(channel?: string): number {
    if (channel) {
      return this.channels.get(channel)?.size ?? 0;
    }
    let total = 0;
    for (const set of this.channels.values()) {
      total += set.size;
    }
    return total;
  }

  /**
   * Emits a keepalive comment ping (:keepalive [timestamp]) every 15 seconds
   * across all active channels to prevent proxy timeouts and stateful NAT teardowns.
   */
  private startKeepalive(): void {
    this.keepaliveTimer = setInterval(() => {
      const ping = `:keepalive ${Date.now()}\n\n`;
      for (const [channel, set] of this.channels.entries()) {
        for (const client of set) {
          try {
            client.write(ping);
          } catch {
            set.delete(client);
          }
        }
        if (set.size === 0) {
          this.channels.delete(channel);
        }
      }
    }, 15000);

    // Prevent keepalive interval from blocking Node event loop on graceful exit
    if (this.keepaliveTimer.unref) {
      this.keepaliveTimer.unref();
    }
  }

  /**
   * Cleans up all connections, buffers, and timers on server shutdown.
   */
  public destroy(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
    for (const set of this.channels.values()) {
      for (const client of set) {
        try {
          client.end();
        } catch {
          // Ignore
        }
      }
    }
    this.channels.clear();
    this.eventBuffers.clear();
    this.channelEventIds.clear();
  }
}

// Singleton SSE Hub
export const sseHub = new SseHub();
