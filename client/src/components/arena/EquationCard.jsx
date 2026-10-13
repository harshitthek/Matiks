import React from 'react';

/**
 * 60fps Reflex Mode Equation Card.
 * Renders large high-contrast addition problems, carry taxonomy chip,
 * input digits, and visual hit feedback.
 */
export function EquationCard({
  question,
  questionNumber = 1,
  totalQuestions = 15,
  currentInput = '',
  flashState = null, // 'correct' | 'incorrect' | null
  lastResult = null,
  isSubmitting = false,
  hasAutoSubmit = true
}) {
  if (!question) return null;

  // Carry & Borrow Taxonomy Badge color
  const bucketColors = {
    B1: { text: 'text-[#ffe36e]', bg: 'bg-[#ffe36e]/15', border: 'border-[#ffe36e]', label: 'B1 // NO CARRY' },
    B2: { text: 'text-[#2ee58f]', bg: 'bg-[#2ee58f]/15', border: 'border-[#2ee58f]', label: 'B2 // ONES CARRY' },
    B3: { text: 'text-[#f5a623]', bg: 'bg-[#f5a623]/15', border: 'border-[#f5a623]', label: 'B3 // CENTURY CARRY' },
    B4: { text: 'text-[#ff6b5e]', bg: 'bg-[#ff6b5e]/15', border: 'border-[#ff6b5e]', label: 'B4 // DOUBLE CARRY' },
    S1: { text: 'text-[#2ee58f]', bg: 'bg-[#2ee58f]/15', border: 'border-[#2ee58f]', label: 'S1 // CLEAN SUB' },
    S2: { text: 'text-[#ff6b5e]', bg: 'bg-[#ff6b5e]/15', border: 'border-[#ff6b5e]', label: 'S2 // REGROUP BORROW' }
  };

  const badge = bucketColors[question.bucket] || bucketColors.B1;

  const cardBorderClass =
    flashState === 'correct'
      ? 'flash-correct'
      : flashState === 'incorrect'
      ? 'flash-incorrect'
      : 'border-[#2ee58f]/30';

  return (
    <div
      className={`cyber-card p-2.5 sm:p-4 md:p-6 text-center relative transition-colors duration-150 flex flex-col justify-between ${cardBorderClass}`}
    >
      {/* Top Question Category & Progress Header */}
      <div className="flex items-center justify-between pb-1 sm:pb-2 mb-1.5 sm:mb-3 border-b border-[#2ee58f]/20 font-mono text-xs">
        <span className={`px-2 py-0.5 border font-bold text-[10px] sm:text-[11px] ${badge.bg} ${badge.border} ${badge.text}`}>
          {badge.label}
        </span>
        <span className="text-[#aab5ac] tracking-widest font-bold text-[10px] sm:text-xs">
          QUESTION <strong className="text-[#e8ece3]">{String(questionNumber).padStart(2, '0')}</strong> / {totalQuestions}
        </span>
      </div>

      {/* Floating Delta Callout Feedback */}
      {lastResult && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-10 sm:-translate-y-14 pointer-events-none z-20">
          {lastResult.isCorrect ? (
            <div className="animate-float-up bg-[#2ee58f] text-[#090c0a] font-mono font-extrabold text-xs sm:text-sm md:text-base px-2.5 py-1 border-2 border-[#090c0a] shadow-[3px_3px_0_#090c0a] flex items-center gap-1.5 whitespace-nowrap">
              <span>+{lastResult.pointsAwarded} PTS</span>
              {lastResult.consecutiveStreak >= 3 && (
                <span className="text-xs bg-[#090c0a] text-[#ffe36e] px-1 py-0.5">
                  🔥 {lastResult.consecutiveStreak}x
                </span>
              )}
            </div>
          ) : (
            <div className="animate-float-up bg-[#ff6b5e] text-[#090c0a] font-mono font-extrabold text-xs sm:text-sm md:text-base px-2.5 py-1 border-2 border-[#090c0a] shadow-[3px_3px_0_#090c0a] whitespace-nowrap">
              {lastResult.pointsAwarded} PTS
            </div>
          )}
        </div>
      )}

      {/* Equation Display */}
      <div className="my-1 sm:my-3 md:my-5">
        <div className="flex flex-wrap sm:flex-nowrap items-center justify-center gap-1.5 xs:gap-2 sm:gap-3 md:gap-5 font-display font-extrabold text-2xl xs:text-3xl sm:text-5xl md:text-6xl text-[#e8ece3] tracking-tight max-w-full">
          <span>{question.a}</span>
          <span className="text-[#2ee58f] font-mono font-normal text-xl xs:text-2xl sm:text-4xl md:text-5xl">
            {question.operation || question.operator || '+'}
          </span>
          <span>{question.b}</span>
          <span className="text-[#aab5ac] font-mono font-normal text-xl xs:text-2xl sm:text-4xl md:text-5xl">=</span>

          {/* User Input Answer Box */}
          <div
            className={`w-[78px] xs:w-[92px] sm:w-[115px] md:w-[145px] h-[44px] xs:h-[48px] sm:h-[60px] md:h-[74px] shrink-0 bg-[#090c0a] border-3 border-[#2ee58f] flex items-center justify-center px-1 sm:px-2 shadow-[2px_2px_0_#2ee58f] sm:shadow-[3px_3px_0_#2ee58f] text-[#2ee58f] font-mono tracking-tight ${
              currentInput.length >= 5
                ? 'text-xs xs:text-sm sm:text-lg md:text-xl'
                : currentInput.length === 4
                ? 'text-sm xs:text-base sm:text-2xl md:text-3xl'
                : 'text-xl xs:text-2xl sm:text-4xl md:text-5xl'
            }`}
          >
            {currentInput ? (
              <span className="truncate">{currentInput}</span>
            ) : (
              <span className="text-[#2ee58f]/40 animate-pulse">_</span>
            )}
          </div>
        </div>
      </div>

      {/* Helper Prompt */}
      <div className="font-mono text-[9px] sm:text-xs text-[#aab5ac] tracking-wider mt-1 sm:mt-2">
        {isSubmitting ? (
          <span className="text-[#ffe36e] animate-pulse">VALIDATING LATENCY...</span>
        ) : hasAutoSubmit ? (
          <span className="text-[#2ee58f]/80">
            ⚡ AUTO-SUBMITS ON FINAL DIGIT <span className="hidden sm:inline text-[#aab5ac]">• <kbd className="px-1 py-0.5 bg-[#090c0a] border border-[#2ee58f]/40 text-[#2ee58f]">⌫</kbd> DEL • <kbd className="px-1 py-0.5 bg-[#090c0a] border border-[#2ee58f]/40 text-[#2ee58f]">ESC</kbd> CLR</span>
          </span>
        ) : (
          <span className="text-[#ffe36e]/90">
            ↵ PRESS ENTER / SUBMIT <span className="hidden sm:inline text-[#aab5ac]">• <kbd className="px-1 py-0.5 bg-[#090c0a] border border-[#2ee58f]/40 text-[#2ee58f]">⌫</kbd> DEL • <kbd className="px-1 py-0.5 bg-[#090c0a] border border-[#2ee58f]/40 text-[#2ee58f]">ESC</kbd> CLR</span>
          </span>
        )}
      </div>
    </div>
  );
}
