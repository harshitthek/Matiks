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
  const handleDigitPress = (digit) => {
    if (disabled) return;
    soundFx.playKeyClick();
    onDigit(digit);
  };

  const handleClearPress = () => {
    if (disabled) return;
    soundFx.playKeyClick();
    onClear?.();
  };

  const handleBackspacePress = () => {
    if (disabled) return;
    soundFx.playKeyClick();
    if (onBackspace) {
      onBackspace();
    } else {
      onClear?.();
    }
  };

  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  return (
    <div className={`w-full max-w-sm mx-auto select-none touch-manipulation ${className}`}>
      <div className="grid grid-cols-3 gap-1.5 sm:gap-2.5">
        {/* Digits 1 through 9 */}
        {digits.map((digit) => (
          <button
            key={digit}
            type="button"
            disabled={disabled}
            onClick={() => handleDigitPress(digit)}
            className="numpad-btn py-2 sm:py-2.5 md:py-3 bg-[#0f1411] hover:bg-[#161d18] active:bg-[#2ee58f]/20 border-2 border-[#2ee58f]/30 hover:border-[#2ee58f] active:border-[#2ee58f] text-[#e8ece3] font-display font-bold text-xl sm:text-2xl md:text-2xl shadow-[2px_2px_0_#090c0a] sm:shadow-[3px_3px_0_#090c0a] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0_#090c0a] transition-all duration-75 cursor-pointer touch-manipulation select-none"
          >
            {digit}
          </button>
        ))}

        {/* Row 4: 0, CLR, BACKSPACE (⌫) */}
        <button
          type="button"
          disabled={disabled}
          onClick={() => handleDigitPress('0')}
          className="numpad-btn py-2 sm:py-2.5 md:py-3 bg-[#0f1411] hover:bg-[#161d18] active:bg-[#2ee58f]/20 border-2 border-[#2ee58f]/30 hover:border-[#2ee58f] active:border-[#2ee58f] text-[#e8ece3] font-display font-bold text-xl sm:text-2xl md:text-2xl shadow-[2px_2px_0_#090c0a] sm:shadow-[3px_3px_0_#090c0a] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0_#090c0a] transition-all duration-75 cursor-pointer touch-manipulation select-none"
        >
          0
        </button>

        <button
          type="button"
          disabled={disabled}
          onClick={handleClearPress}
          className="numpad-btn py-2 sm:py-2.5 md:py-3 bg-[#090c0a] hover:bg-[#ff6b5e]/15 active:bg-[#ff6b5e]/25 border-2 border-[#ff6b5e]/60 hover:border-[#ff6b5e] active:border-[#ff6b5e] text-[#ff6b5e] font-mono font-bold text-[11px] sm:text-xs md:text-sm tracking-wider uppercase shadow-[2px_2px_0_#090c0a] sm:shadow-[3px_3px_0_#090c0a] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0_#090c0a] transition-all duration-75 cursor-pointer touch-manipulation select-none"
        >
          CLR
        </button>

        <button
          type="button"
          disabled={disabled}
          onClick={handleBackspacePress}
          aria-label="Backspace"
          className="numpad-btn py-2 sm:py-2.5 md:py-3 bg-[#090c0a] hover:bg-[#ffe36e]/15 active:bg-[#ffe36e]/25 border-2 border-[#ffe36e]/60 hover:border-[#ffe36e] active:border-[#ffe36e] text-[#ffe36e] font-mono font-black text-[11px] sm:text-xs md:text-sm tracking-wider uppercase shadow-[2px_2px_0_#090c0a] sm:shadow-[3px_3px_0_#090c0a] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0_#090c0a] transition-all duration-75 cursor-pointer flex items-center justify-center gap-1 touch-manipulation select-none"
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
            soundFx.playKeyClick();
            onSubmit?.();
          }}
          className="w-full mt-2 sm:mt-3 py-2.5 sm:py-3.5 bg-[#2ee58f] hover:bg-[#25c479] active:bg-[#20af6a] border-2 border-[#090c0a] text-[#090c0a] font-mono font-black text-xs sm:text-sm tracking-wider uppercase shadow-[3px_3px_0_#090c0a] transition-colors duration-75 cursor-pointer touch-manipulation select-none"
        >
          SUBMIT ANSWER ↵
        </button>
      )}
    </div>
  );
}
