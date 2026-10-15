import React from 'react';
import { RansomNote } from '../common/RansomNote.jsx';

/**
 * Synchronized 3-2-1 Team Countdown Overlay.
 * Drops giant scissor-cut Ransom paper tiles as seconds tick down.
 */
export function CountdownOverlay({ secondsRemaining, message }) {
  const displayDigit = secondsRemaining > 0 ? String(secondsRemaining) : 'START!';

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#090c0a]/90 backdrop-blur-md animate-fade-in p-4 select-none">
      <div className="relative flex flex-col items-center">
        {/* Decorative background badge */}
        <div className="mb-6 font-mono text-sm tracking-widest text-[#2ee58f] uppercase flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-[#2ee58f] animate-ping" />
          SYNCHRONIZED SPRINT LOCK // T-MINUS
        </div>

        {/* Giant Ransom Countdown Display */}
        <div className="my-6 transform transition-transform duration-200 scale-110 md:scale-125">
          <RansomNote
            text={displayDigit}
            size="giant"
            seed={42}
          />
        </div>

        {/* Tactical Sub-Message */}
        <div className="mt-8 px-6 py-2 border-2 border-[#090c0a] bg-[#ffe36e] text-[#090c0a] font-mono font-bold tracking-widest text-base md:text-lg shadow-[4px_4px_0_#090c0a]">
          {message || (secondsRemaining === 3 ? 'GET READY!' : secondsRemaining === 2 ? 'STEADY!' : 'FOCUS!')}
        </div>

        <p className="mt-6 font-mono text-xs text-[#aab5ac] tracking-wide text-center max-w-sm">
          All teammates enter Question 1 on the exact same millisecond. Prepare your fingers!
        </p>
      </div>
    </div>
  );
}
