import React from 'react';
import { soundFx } from '../../services/soundFx.js';

/**
 * Custom UFC On-Screen Tactile Numpad (Zero-Enter Automatic Submit Mode).
 * Suppresses native mobile OS keyboards and provides CLR + single-digit Backspace (⌫).
 */
export function TactileNumpad({
  onDigit,
  onBackspace,
  onClear,
  onSubmit,
  showSubmit = false,
  disabled = false,
  className = ''
}) {
  const triggerHaptic = (ms = 8) => {
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(ms);
      }
    } catch {
      // Ignore vibration errors
    }
  };

  const handleDigitPress = (digit) => {
    if (disabled) return;
    triggerHaptic(8);
    soundFx.playKeyClick();
    onDigit(digit);
  };

  const handleClearPress = () => {
    if (disabled) return;
    triggerHaptic(10);
    soundFx.playKeyClick();
    onClear?.();
  };

  const handleBackspacePress = () => {
    if (disabled) return;
    triggerHaptic(10);
    soundFx.playKeyClick();
    if (onBackspace) {
      onBackspace();
    } else {
      onClear?.();
    }
  };

  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  return (
    <div className={`w-full max-w-sm mx-auto select-none ${className}`}>
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {/* Digits 1 through 9 */}
        {digits.map((digit) => (
          <button
            key={digit}
            type="button"
            disabled={disabled}
            onClick={() => handleDigitPress(digit)}
            className="numpad-btn py-2.5 sm:py-4 bg-[#0f1411] hover:bg-[#161d18] active:translate-y-0.5 border-2 border-[#2ee58f]/40 hover:border-[#2ee58f] text-[#e8ece3] font-display font-bold text-2xl sm:text-3xl shadow-[3px_3px_0_#090c0a] transition-all cursor-pointer"
          >
            {digit}
          </button>
        ))}

        {/* Row 4: CLR, 0, BACKSPACE (⌫) */}
        <button
          type="button"
          disabled={disabled}
          onClick={handleClearPress}
          className="numpad-btn py-2.5 sm:py-4 bg-[#090c0a] hover:bg-[#ff6b5e]/15 active:translate-y-0.5 border-2 border-[#ff6b5e]/60 text-[#ff6b5e] font-mono font-bold text-xs sm:text-base tracking-wider uppercase shadow-[3px_3px_0_#090c0a] transition-all cursor-pointer"
        >
          CLR
        </button>

        <button
          type="button"
          disabled={disabled}
          onClick={() => handleDigitPress('0')}
          className="numpad-btn py-2.5 sm:py-4 bg-[#0f1411] hover:bg-[#161d18] active:translate-y-0.5 border-2 border-[#2ee58f]/40 hover:border-[#2ee58f] text-[#e8ece3] font-display font-bold text-2xl sm:text-3xl shadow-[3px_3px_0_#090c0a] transition-all cursor-pointer"
        >
          0
        </button>

        <button
          type="button"
          disabled={disabled}
          onClick={handleBackspacePress}
          aria-label="Backspace"
          className="numpad-btn py-2.5 sm:py-4 bg-[#090c0a] hover:bg-[#ffe36e]/15 active:translate-y-0.5 border-2 border-[#ffe36e]/60 text-[#ffe36e] font-mono font-extrabold text-xs sm:text-base tracking-wider uppercase shadow-[3px_3px_0_#090c0a] transition-all cursor-pointer flex items-center justify-center gap-1"
        >
          ⌫ DEL
        </button>
      </div>

      {/* Manual Submit Fallback Button (rendered when target digits cannot be precomputed) */}
      {showSubmit && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            if (disabled) return;
            triggerHaptic(12);
            soundFx.playKeyClick();
            onSubmit?.();
          }}
          className="w-full mt-2 sm:mt-3 py-2.5 sm:py-3.5 bg-[#2ee58f] hover:bg-[#25c479] active:translate-y-0.5 border-2 border-[#090c0a] text-[#090c0a] font-mono font-black text-xs sm:text-sm tracking-wider uppercase shadow-[3px_3px_0_#090c0a] transition-all cursor-pointer"
        >
          SUBMIT ANSWER ↵
        </button>
      )}
    </div>
  );
}
