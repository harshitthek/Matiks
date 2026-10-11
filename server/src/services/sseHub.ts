/**
 * MATIKS HACKATHON ENGINE — SERVER-SENT EVENTS HUB (sseHub.ts)
 * 
 * Manages active HTTP event-stream connections across team, leaderboard, and admin channels.
 * Emits keepalive heartbeats every 15s and enforces proxy buffering suppression.
 */

import type { Response } from 'express';

export class SseHub {
  private channels = new Map<string, Set<Response>>();
  private keepaliveTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.startKeepalive();
  }

  /**
   * Initializes SSE headers on an Express HTTP response and registers it to a channel.
   * Returns a cleanup function to detach the client upon disconnection.
   */
  public registerClient(channel: string, res: Response): () => void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    // Send immediate stream open handshake
    res.write(':connected\n\n');

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
   */
  public broadcast(channel: string, event: string, data: unknown): void {
    const clientSet = this.channels.get(channel);
    if (!clientSet || clientSet.size === 0) return;

    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

    for (const client of clientSet) {
      try {
        client.write(message);
      } catch {
        clientSet.delete(client);
      }
    }
  }

  /**
   * Sends an immediate direct event to a single client connection.
   */
  public sendDirect(res: Response, event: string, data: unknown): void {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      // Stream write error
    }
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
   * Cleans up all connections and timers on server shutdown.
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
  }
}

// Singleton SSE Hub
export const sseHub = new SseHub();
