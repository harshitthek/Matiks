import React from 'react';
import { soundFx } from '../../services/soundFx.js';

/**
 * Custom UFC On-Screen Tactile Numpad (Universal Explicit Submit).
 * Suppresses native mobile OS keyboards and provides an oversized Thumb-Enter.
 */
export function TactileNumpad({
  onDigit,
  onClear,
  onSubmit,
  disabled = false,
  className = ''
}) {
  const handleDigitPress = (digit) => {
    if (disabled) return;
    soundFx.playKeyClick();
    onDigit(digit);
  };

  const handleClearPress = () => {
    if (disabled) return;
    soundFx.playKeyClick();
    onClear();
  };

  const handleSubmitPress = () => {
    if (disabled) return;
    soundFx.playKeyClick();
    onSubmit();
  };

  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  return (
    <div className={`w-full max-w-sm mx-auto select-none ${className}`}>
      <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
        {/* Digits 1 through 9 */}
        {digits.map((digit) => (
          <button
            key={digit}
            type="button"
            disabled={disabled}
            onClick={() => handleDigitPress(digit)}
            className="numpad-btn py-3.5 sm:py-4 bg-[#0f1411] hover:bg-[#161d18] active:translate-y-0.5 border-2 border-[#2ee58f]/40 hover:border-[#2ee58f] text-[#e8ece3] font-display font-bold text-2xl sm:text-3xl shadow-[3px_3px_0_#090c0a] transition-all cursor-pointer"
          >
            {digit}
          </button>
        ))}

        {/* Row 4: CLEAR, 0, ENTER */}
        <button
          type="button"
          disabled={disabled}
          onClick={handleClearPress}
          className="numpad-btn py-3.5 sm:py-4 bg-[#090c0a] hover:bg-[#ff6b5e]/15 active:translate-y-0.5 border-2 border-[#ff6b5e]/60 text-[#ff6b5e] font-mono font-bold text-sm sm:text-base tracking-wider uppercase shadow-[3px_3px_0_#090c0a] transition-all cursor-pointer"
        >
          ⌫ CLEAR
        </button>

        <button
          type="button"
          disabled={disabled}
          onClick={() => handleDigitPress('0')}
          className="numpad-btn py-3.5 sm:py-4 bg-[#0f1411] hover:bg-[#161d18] active:translate-y-0.5 border-2 border-[#2ee58f]/40 hover:border-[#2ee58f] text-[#e8ece3] font-display font-bold text-2xl sm:text-3xl shadow-[3px_3px_0_#090c0a] transition-all cursor-pointer"
        >
          0
        </button>

        {/* Oversized Green Thumb-Enter */}
        <button
          type="button"
          disabled={disabled}
          onClick={handleSubmitPress}
          className="numpad-btn py-3.5 sm:py-4 bg-[#2ee58f] hover:bg-[#34f098] active:translate-y-1 border-2 border-[#090c0a] text-[#090c0a] font-mono font-extrabold text-sm sm:text-base tracking-wider uppercase shadow-[4px_4px_0_#090c0a] transition-all cursor-pointer flex items-center justify-center gap-1.5"
        >
          ENTER ↵
        </button>
      </div>
    </div>
  );
}
