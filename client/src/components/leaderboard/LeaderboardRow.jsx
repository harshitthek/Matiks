import React from 'react';
import { RadarDot } from '../common/RadarDot.jsx';
import { formatLeaderboardScore } from '../../services/leaderboardPresentation.js';

/**
 * Leaderboard Standings Table Row for Ranks 4+.
 * High-density cyber-editorial presentation with Zero Question Leak Guarantee.
 */
export function LeaderboardRow({ entry }) {
  if (!entry) return null;

  const isRacing = entry.status === 'IN_SPRINT';
  const isFinished = entry.status === 'FINISHED';

  return (
    <div
      className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 md:p-4 border transition-all ${
        isRacing
          ? 'border-[#2ee58f]/50 bg-[#2ee58f]/5'
          : isFinished
          ? 'border-white/15 bg-[#0f1411]'
          : 'border-white/10 bg-[#090c0a]'
      }`}
    >
      {/* Left Column: Rank + Team Info */}
      <div className="flex items-center gap-3 md:gap-4 min-w-0">
        <span className="font-mono text-sm md:text-base font-extrabold w-8 text-center text-[#aab5ac] shrink-0">
          {entry.isDisqualified || entry.status === 'WAITING' ? '—' : `#${entry.rank}`}
        </span>

        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-display font-extrabold text-base md:text-lg text-[#e8ece3] truncate">
              {entry.teamName}
            </span>
            <span className="font-mono text-xs text-[#aab5ac] font-bold">
              #{entry.teamCode}
            </span>
            {(entry.targetSize || entry.membersCount) && (
              <span className="font-mono text-[9px] px-1 py-0.5 border border-white/20 bg-white/5 text-[#aab5ac] uppercase font-bold tracking-wider">
                {(entry.targetSize || entry.membersCount) === 1
                  ? 'SOLO'
                  : (entry.targetSize || entry.membersCount) === 2
                  ? 'DUO'
                  : (entry.targetSize || entry.membersCount) === 3
                  ? 'TRIO'
                  : 'SQUAD'}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 mt-0.5">
            <RadarDot status={isRacing ? 'online' : isFinished ? 'butter' : 'offline'} />
            <span className="font-mono text-[10px] text-[#aab5ac] uppercase font-bold tracking-wider">
              {entry.isDisqualified ? 'DISQUALIFIED' : isRacing ? 'RACING ⚡' : isFinished ? 'FINISHED 🏁' : 'WAITING'}
            </span>
            {entry.averageTimeSeconds > 0 && (
              <>
                <span className="text-[#aab5ac] text-xs">•</span>
                <span className="font-mono text-[11px] text-[#aab5ac]">
                  {entry.averageTimeSeconds}s avg
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Right Column: Member Chips & Score */}
      <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0">
        {/* Micro Member Chips */}
        {entry.memberBreakdown && entry.memberBreakdown.length > 0 && (
          <div className="hidden lg:flex items-center gap-1">
            {entry.memberBreakdown.map((m, idx) => (
              <span
                key={idx}
                className={`font-mono text-[10px] px-1.5 py-0.5 border ${
                  m.isExcused
                    ? 'border-[#ff6b5e]/30 text-[#ff6b5e] line-through'
                    : 'border-white/10 bg-[#090c0a] text-[#aab5ac]'
                }`}
                title={`${m.name}: ${m.score} pts`}
              >
                {m.name.split(' ')[0]}: <strong className="text-[#ffe36e]">{m.score || 0}</strong>
              </span>
            ))}
          </div>
        )}

        {/* Score Tile */}
        <div className="text-right shrink-0">
          <span className="font-display font-black text-xl md:text-2xl text-[#2ee58f]">
            {formatLeaderboardScore(entry.teamAverageScore)}
          </span>
          <span className="font-mono text-[10px] font-bold text-[#aab5ac] uppercase block -mt-1">
            PTS AVG
          </span>
        </div>
      </div>
    </div>
  );
}
