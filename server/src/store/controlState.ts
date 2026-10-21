/**
 * MATIKS HACKATHON ENGINE — ORGANIZER CONTROL STATE (controlState.ts)
 *
 * What the organizers have set that is not part of any team: whether the contest window is open and until when, the banner, the walk-in
 * bypass, and the anti-peeking delay on the projector. It has to come back after a restart, or a crash mid-event leaves every team locked out
 * behind a window that has quietly closed.
 */

import type { ContestWindowConfig } from '../types/sse.js';

export interface ControlState {
  window: ContestWindowConfig;
  emergencyWalkIn: boolean;
  streamDelayMs: number;
}

type Listener = () => void;
const listeners = new Set<Listener>();

/** Called by whatever changes a control setting, so the state can be saved. */
export function controlStateChanged(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch (err) {
      console.error('[ControlState] listener failed:', err);
    }
  }
}

export function onControlStateChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
