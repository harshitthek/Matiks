import React from 'react';
import { RadarDot } from '../common/RadarDot.jsx';

/**
 * Teammate Live HUD (ADR-02).
 * Displays partners' real-time question progress and scores without covering the arena math.
 */
export function TeammateHud({ teammates = [], currentRoll, totalQuestions = 15 }) {
  if (!teammates || teammates.length === 0) return null;

  return (
    <div className="w-full flex items-center gap-1.5 sm:gap-2 overflow-x-auto py-0.5 sm:py-1 px-0.5 sm:px-1 scrollbar-none">
      <span className="font-mono text-[9px] sm:text-[10px] text-[#aab5ac] uppercase font-bold tracking-widest shrink-0 mr-0.5 sm:mr-1">
        HUD // SQUAD:
      </span>
      {teammates.map((mate) => {
        const isMe = mate.rollNumber === currentRoll;
        const isFinished = (mate.completedQuestions || 0) >= totalQuestions;

        return (
          <div
            key={mate.rollNumber}
            className={`flex items-center gap-1.5 sm:gap-2 px-2 sm:px-2.5 py-0.5 sm:py-1 border font-mono text-[10px] sm:text-xs shrink-0 transition-all ${
              isMe
                ? 'border-[#2ee58f] bg-[#2ee58f]/10 text-[#e8ece3]'
                : isFinished
                ? 'border-[#ffe36e] bg-[#ffe36e]/10 text-[#ffe36e]'
                : 'border-[#2ee58f]/30 bg-[#0f1411] text-[#e8ece3]'
            }`}
          >
            <RadarDot status={mate.connected ? (isFinished ? 'butter' : 'online') : 'offline'} />
            <span className="font-bold truncate max-w-[85px] sm:max-w-[100px]">
              {mate.name || mate.rollNumber}
              {isMe && <span className="text-[#2ee58f] ml-1">(YOU)</span>}
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
              <span className="text-[9px] sm:text-[10px] bg-[#f5a623] text-[#090c0a] px-1 font-bold">
                🔥{mate.streak}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
