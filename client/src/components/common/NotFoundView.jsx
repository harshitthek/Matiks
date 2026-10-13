import React from 'react';
import { RansomNote } from './RansomNote.jsx';
import { WashiTape } from './WashiTape.jsx';
import { TactileButton } from './TactileButton.jsx';
import { FlowerSticker } from './FlowerSticker.jsx';

/**
 * 404 / Sector Access Denied View.
 * Displayed when an unprivileged participant or anonymous visitor attempts
 * to access administrative sectors or non-existent routes.
 */
export function NotFoundView({ onReturnToLobby }) {
  return (
    <div className="w-full max-w-md mx-auto px-4 py-16 text-center">
      <div className="cyber-card cyber-card-ember p-8 relative">
        <WashiTape color="ember" rotation="-2deg" className="-top-3 left-1/3" />
        <FlowerSticker
          id={12}
          size={42}
          rotation={-15}
          withTape
          tapeColor="amber"
          className="hidden sm:inline-block absolute -top-4 -right-4 z-10"
        />

        <div className="flex items-center justify-center gap-2 mb-3">
          <span className="font-mono text-[11px] text-[#ff6b5e] font-bold tracking-widest uppercase">
            // SECTOR 404 — ACCESS DENIED
          </span>
        </div>

        <div className="mb-4">
          <RansomNote text="SECTOR NOT FOUND" size="md" />
        </div>

        <p className="font-mono text-xs text-[#aab5ac] mb-6 leading-relaxed">
          The requested path does not exist or requires verified administrator credentials.
        </p>

        <TactileButton
          type="button"
          variant="signal"
          onClick={onReturnToLobby}
          className="w-full py-3 text-sm font-bold tracking-wider"
        >
          ← RETURN TO SQUAD LOBBY
        </TactileButton>
      </div>
    </div>
  );
}
