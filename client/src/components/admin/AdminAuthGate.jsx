import React, { useState } from 'react';
import { RansomNote } from '../common/RansomNote.jsx';
import { WashiTape } from '../common/WashiTape.jsx';
import { TactileButton } from '../common/TactileButton.jsx';

/**
 * Organizer Passcode Authentication Gate.
 * Enforces admin secret verification for tournament management.
 */
export function AdminAuthGate({ onAuthenticate, error }) {
  const [secret, setSecret] = useState('');
  const [localError, setLocalError] = useState(null);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!secret || secret.trim().length === 0) {
      setLocalError('Admin secret is required.');
      return;
    }
    setLocalError(null);
    onAuthenticate(secret.trim());
  };

  const handleDevPreset = () => {
    setSecret('hackathon_admin_secret');
    onAuthenticate('hackathon_admin_secret');
  };

  return (
    <div className="w-full max-w-md mx-auto px-4 py-12">
      <div className="cyber-card cyber-card-ember p-6 md:p-8 relative text-center">
        <WashiTape color="ember" rotation="-2deg" className="-top-3 left-1/3" />

        <div className="font-mono text-xs text-[#ff6b5e] font-bold tracking-widest uppercase mb-2">
          § RESTRICTED ACCESS // LEVEL 04
        </div>

        <div className="mb-4">
          <RansomNote text="ADMIN CONSOLE" size="md" />
        </div>

        <p className="font-mono text-xs text-[#aab5ac] mb-6">
          ENTER ORGANIZER MASTER KEY TO ACCESS ROOM TELEMETRY, WINDOW TIMERS & EXCUSE CONTROLS.
        </p>

        {(error || localError) && (
          <div className="border-2 border-[#ff6b5e] bg-[#ff6b5e]/15 p-3 mb-4 text-center font-mono text-xs font-bold text-[#ff6b5e] tracking-wide">
            ⚠️ {error || localError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="font-mono text-[11px] text-[#aab5ac] uppercase tracking-widest block text-left mb-1 font-bold">
              ADMIN SECRET TOKEN
            </label>
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="••••••••••••••••"
              className="w-full bg-[#090c0a] border-2 border-[#2ee58f]/40 focus:border-[#2ee58f] px-4 py-3 font-mono text-sm text-[#e8ece3] outline-none"
              autoFocus
            />
          </div>

          <TactileButton
            type="submit"
            variant="signal"
            className="w-full py-3.5 text-sm font-bold tracking-wider"
          >
            UNLOCK COMMAND CENTER ↵
          </TactileButton>

          {/* Development Quick Helper (Dev Only) */}
          {Boolean(import.meta.env?.DEV) && (
            <div className="pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={handleDevPreset}
                className="font-mono text-[11px] text-[#ffe36e] hover:underline"
              >
                [ DEV PRESET: USE DEFAULT SECRET ]
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
