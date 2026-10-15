import React from 'react';
import { RadarDot } from '../common/RadarDot.jsx';

/**
 * Teammate Live HUD (ADR-02).
 * Displays partners' real-time question progress and scores without covering the arena math.
 */
export function TeammateHud({
  teammates = [],
  currentRoll,
  totalQuestions = 15,
  layout = 'auto', // 'auto' | 'horizontal' | 'panel'
  className = ''
}) {
  if (!teammates || teammates.length === 0) return null;

  // Render vertical panel stack for Desktop Battle Station (layout === 'panel')
  if (layout === 'panel') {
    return (
      <div className={`w-full flex flex-col gap-1.5 ${className}`}>
        <div className="flex items-center justify-between font-mono text-[10px] text-[#aab5ac] uppercase font-bold tracking-widest pb-1 border-b border-[#2ee58f]/20">
          <span>SQUAD TELEMETRY</span>
          <span className="text-[#2ee58f]">{teammates.length} ACTIVE</span>
        </div>
        <div className="flex flex-col gap-1.5">
          {teammates.map((mate) => {
            const isMe = mate.rollNumber === currentRoll;
            const isFinished = (mate.completedQuestions || 0) >= totalQuestions;
            const qCount = Math.min(totalQuestions, (mate.completedQuestions || 0) + (isFinished ? 0 : 1));
            const progressPct = Math.min(100, Math.round(((mate.completedQuestions || 0) / totalQuestions) * 100));

            return (
              <div
                key={mate.rollNumber}
                className={`p-2 border font-mono text-xs transition-all ${
                  isMe
                    ? 'border-[#2ee58f] bg-[#2ee58f]/10 shadow-[2px_2px_0_#090c0a]'
                    : isFinished
                    ? 'border-[#ffe36e] bg-[#ffe36e]/10'
                    : 'border-[#2ee58f]/20 bg-[#0f1411]'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="flex items-center gap-1.5 truncate">
                    <RadarDot status={mate.connected ? (isFinished ? 'butter' : 'online') : 'offline'} />
                    <span className="font-bold truncate text-[#e8ece3]">
                      {mate.name || mate.rollNumber}
                    </span>
                    {isMe && (
                      <span className="text-[9px] bg-[#2ee58f] text-[#090c0a] font-black px-1">
                        YOU
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {mate.streak >= 3 && (
                      <span className="text-[9px] bg-[#f5a623] text-[#090c0a] px-1 font-bold">
                        🔥{mate.streak}
                      </span>
                    )}
                    <span className="text-[#ffe36e] font-extrabold text-[11px]">
                      {(mate.individualScore ?? mate.currentScore ?? 0).toLocaleString()} pts
                    </span>
                  </div>
                </div>

                {/* Progress bar track */}
                <div className="flex items-center gap-2 text-[10px] text-[#aab5ac]">
                  <div className="flex-1 h-1.5 bg-[#090c0a] border border-white/10 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-150 ${
                        isFinished ? 'bg-[#ffe36e]' : 'bg-[#2ee58f]'
                      }`}
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                  <span className={isFinished ? 'text-[#ffe36e] font-bold' : 'text-[#2ee58f]'}>
                    {isFinished ? 'DONE 🏁' : `Q${qCount}/${totalQuestions}`}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Default horizontal ribbon (mobile view)
  return (
    <div className={`w-full flex items-center gap-1.5 overflow-x-auto py-1 px-0.5 scrollbar-none ${className}`}>
      <span className="font-mono text-[9px] text-[#aab5ac] uppercase font-bold tracking-widest shrink-0 mr-1">
        HUD //
      </span>
      {teammates.map((mate) => {
        const isMe = mate.rollNumber === currentRoll;
        const isFinished = (mate.completedQuestions || 0) >= totalQuestions;

        return (
          <div
            key={mate.rollNumber}
            className={`flex items-center gap-1.5 px-2 py-0.5 border font-mono text-[10px] sm:text-xs shrink-0 transition-all ${
              isMe
                ? 'border-[#2ee58f] bg-[#2ee58f]/10 text-[#e8ece3]'
                : isFinished
                ? 'border-[#ffe36e] bg-[#ffe36e]/10 text-[#ffe36e]'
                : 'border-[#2ee58f]/30 bg-[#0f1411] text-[#e8ece3]'
            }`}
          >
            <RadarDot status={mate.connected ? (isFinished ? 'butter' : 'online') : 'offline'} />
            <span className="font-bold truncate max-w-[80px]">
              {mate.name || mate.rollNumber}
              {isMe && <span className="text-[#2ee58f] ml-0.5">(YOU)</span>}
            </span>
            <span className="text-[#aab5ac]">•</span>
            <span className={isFinished ? 'text-[#ffe36e] font-bold' : 'text-[#2ee58f]'}>
              {isFinished ? 'DONE 🏁' : `Q${(mate.completedQuestions || 0) + 1}/${totalQuestions}`}
            </span>
            <span className="text-[#aab5ac]">•</span>
            <span className="text-[#ffe36e] font-bold">
              {(mate.individualScore ?? mate.currentScore ?? 0).toLocaleString()} pts
            </span>
            {mate.streak >= 3 && (
              <span className="text-[9px] bg-[#f5a623] text-[#090c0a] px-1 font-bold">
                🔥{mate.streak}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
