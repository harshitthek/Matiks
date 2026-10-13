import React, { useState } from 'react';
import { RansomNote } from '../common/RansomNote.jsx';
import { WashiTape } from '../common/WashiTape.jsx';
import { TactileButton } from '../common/TactileButton.jsx';
import { FlowerSticker } from '../common/FlowerSticker.jsx';

/**
 * Organizer Named Authentication Gate (v2.0).
 * Issues HMAC-SHA256 session tokens with named attribution and progressive tarpit feedback.
 */
export function AdminAuthGate({ onAuthenticate, onReturnToLobby, error, isSubmitting = false }) {
  const [organizerName, setOrganizerName] = useState(() => {
    try {
      return localStorage.getItem('matiks_organizer_name') || 'Lead Organizer';
    } catch {
      return 'Lead Organizer';
    }
  });
  const [secret, setSecret] = useState('');
  const [localError, setLocalError] = useState(null);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!organizerName || organizerName.trim().length === 0) {
      setLocalError('Organizer name or callsign is required for audit attribution.');
      return;
    }
    if (!secret || secret.trim().length === 0) {
      setLocalError('Admin secret key is required.');
      return;
    }
    setLocalError(null);
    try {
      localStorage.setItem('matiks_organizer_name', organizerName.trim());
    } catch {
      // Storage unavailable
    }
    onAuthenticate(secret.trim(), organizerName.trim());
  };

  const handleDevPreset = () => {
    const devName = 'Harshit @ UFC';
    const devSecret = 'hackathon_admin_secret';
    setOrganizerName(devName);
    setSecret(devSecret);
    onAuthenticate(devSecret, devName);
  };

  return (
    <div className="w-full max-w-md mx-auto px-4 py-12">
      <div className="cyber-card cyber-card-ember p-6 md:p-8 relative text-center">
        <WashiTape color="ember" rotation="-2deg" className="-top-3 left-1/3" />
        <FlowerSticker
          id={9}
          size={42}
          rotation={12}
          withTape
          tapeColor="ember"
          className="hidden sm:inline-block absolute -top-4 -right-4 z-10"
        />

        <div className="flex items-center justify-center gap-2 mb-2">
          <div className="w-4 h-4 rounded-xs bg-[#E6F8ED] border border-[#090c0a] p-0.5 flex items-center justify-center shrink-0">
            <img src="/brand/ufc-logo.svg" alt="UFC" className="w-full h-full object-contain" />
          </div>
          <span className="font-mono text-[11px] text-[#ff6b5e] font-bold tracking-widest uppercase">
            UFC // FOSS FORGE 2.0
          </span>
        </div>

        <div className="mb-4">
          <RansomNote text="ORGANIZER LOGIN" size="md" />
        </div>

        <p className="font-mono text-xs text-[#aab5ac] mb-6">
          NAMED ORGANIZER SESSION ATTRIBUTION WITH REAL-TIME AUDIT TRAILS & EMERGENCIES.
        </p>

        {(error || localError) && (
          <div className="border-2 border-[#ff6b5e] bg-[#ff6b5e]/15 p-3 mb-4 text-center font-mono text-xs font-bold text-[#ff6b5e] tracking-wide">
            ⚠️ {error || localError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="font-mono text-[11px] text-[#aab5ac] uppercase tracking-widest block text-left mb-1 font-bold">
              ORGANIZER CALLSIGN / NAME
            </label>
            <input
              type="text"
              value={organizerName}
              onChange={(e) => setOrganizerName(e.target.value)}
              placeholder="e.g. Judge Priya or Harshit"
              disabled={isSubmitting}
              className="w-full bg-[#090c0a] border-2 border-[#2ee58f]/40 focus:border-[#2ee58f] px-4 py-2.5 font-mono text-sm text-[#e8ece3] outline-none"
            />
          </div>

          <div>
            <label className="font-mono text-[11px] text-[#aab5ac] uppercase tracking-widest block text-left mb-1 font-bold">
              ADMIN SECRET TOKEN
            </label>
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="••••••••••••••••"
              disabled={isSubmitting}
              className="w-full bg-[#090c0a] border-2 border-[#2ee58f]/40 focus:border-[#2ee58f] px-4 py-2.5 font-mono text-sm text-[#e8ece3] outline-none"
              autoFocus
            />
          </div>

          <TactileButton
            type="submit"
            variant="signal"
            disabled={isSubmitting}
            className="w-full py-3.5 text-sm font-bold tracking-wider"
          >
            {isSubmitting ? 'VERIFYING CREDENTIALS (TARPIT SAFE)...' : 'START ORGANIZER SESSION ↵'}
          </TactileButton>

          {onReturnToLobby && (
            <TactileButton
              type="button"
              variant="muted"
              onClick={onReturnToLobby}
              disabled={isSubmitting}
              className="w-full py-2.5 text-xs font-bold tracking-wider"
            >
              ← RETURN TO SQUAD LOBBY
            </TactileButton>
          )}

          {/* Development Quick Helper (Dev Only) */}
          {Boolean(import.meta.env?.DEV) && (
            <div className="pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={handleDevPreset}
                disabled={isSubmitting}
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
