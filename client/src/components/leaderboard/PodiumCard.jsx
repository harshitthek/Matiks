import React from 'react';
import { WashiTape } from '../common/WashiTape.jsx';
import { RadarDot } from '../common/RadarDot.jsx';

/**
 * 4K Auditorium Stage Podium Card for Top 3 Ranks.
 * Distinct cyber-editorial styling with metallic accents:
 * 1st: Gold/Butter (#ffe36e)
 * 2nd: Silver/Signal (#2ee58f)
 * 3rd: Bronze/Amber (#f5a623)
 */
export function PodiumCard({ entry, position = 1, isRevealed = true }) {
  if (!entry) return null;

  const isFirst = position === 1;
  const isSecond = position === 2;

  const theme = isFirst
    ? {
        border: 'border-[#ffe36e]',
        shadow: 'shadow-[6px_6px_0_#ffe36e]',
        badgeBg: 'bg-[#ffe36e]',
        badgeText: 'text-[#090c0a]',
        medal: '👑 1ST PLACE',
        tapeColor: 'butter',
        scoreColor: 'text-[#ffe36e]',
        glow: 'shadow-[0_0_25px_rgba(255,227,110,0.25)]'
      }
    : isSecond
    ? {
        border: 'border-[#2ee58f]',
        shadow: 'shadow-[5px_5px_0_#2ee58f]',
        badgeBg: 'bg-[#2ee58f]',
        badgeText: 'text-[#090c0a]',
        medal: '🥈 2ND PLACE',
        tapeColor: 'signal',
        scoreColor: 'text-[#2ee58f]',
        glow: 'shadow-[0_0_20px_rgba(46,229,143,0.15)]'
      }
    : {
        border: 'border-[#f5a623]',
        shadow: 'shadow-[5px_5px_0_#f5a623]',
        badgeBg: 'bg-[#f5a623]',
        badgeText: 'text-[#090c0a]',
        medal: '🥉 3RD PLACE',
        tapeColor: 'ember',
        scoreColor: 'text-[#f5a623]',
        glow: 'shadow-[0_0_20px_rgba(245,166,35,0.15)]'
      };

  if (!isRevealed) {
    return (
      <div
        className={`relative bg-[#090c0a]/80 border-2 border-dashed border-white/20 p-6 md:p-8 text-center flex flex-col items-center justify-center min-h-[240px] transition-all duration-500 animate-pulse ${
          isFirst ? 'md:-translate-y-4 z-10' : 'z-0'
        }`}
      >
        <span className="font-mono text-3xl mb-2">🔒</span>
        <span className="font-mono text-xs font-black tracking-widest text-[#aab5ac] uppercase">
          {theme.medal}
        </span>
        <span className="font-mono text-[10px] text-[#ffe36e] mt-1 font-bold">
          [ AWAITING REVEAL... ]
        </span>
      </div>
    );
  }

  return (
    <div
      className={`relative bg-[#090c0a] border-2 ${theme.border} p-5 md:p-6 transition-all duration-700 ease-out transform ${theme.shadow} ${theme.glow} flex flex-col justify-between ${
        isFirst ? 'md:-translate-y-4 z-10' : 'z-0'
      }`}
    >
      <WashiTape
        color={theme.tapeColor}
        rotation={isFirst ? '-2deg' : isSecond ? '2deg' : '-3deg'}
        className="-top-3.5 right-6"
      />

      <div>
        {/* Top Rank Badge */}
        <div className="flex items-center justify-between gap-2 mb-3">
          <span
            className={`font-mono text-xs font-black tracking-widest px-2.5 py-1 uppercase border border-[#090c0a] ${theme.badgeBg} ${theme.badgeText}`}
          >
            {theme.medal}
          </span>
          <span className="font-mono text-xs text-[#aab5ac] font-bold">
            #{entry.teamCode}
          </span>
        </div>

        {/* Squad Name */}
        <h3 className="font-display font-black text-xl md:text-2xl text-[#e8ece3] tracking-tight mb-1 truncate">
          {entry.teamName}
        </h3>

        {/* Status Pill */}
        <div className="flex items-center gap-2 mb-4">
          <RadarDot
            status={
              entry.status === 'IN_SPRINT'
                ? 'online'
                : entry.status === 'FINISHED'
                ? 'butter'
                : 'offline'
            }
          />
          <span className="font-mono text-[11px] text-[#aab5ac] uppercase font-bold tracking-wider">
            {entry.status === 'IN_SPRINT'
              ? 'RACING NOW ⚡'
              : entry.status === 'FINISHED'
              ? 'RUN FINISHED 🏁'
              : 'WAITING IN LOBBY'}
          </span>
        </div>
      </div>

      {/* Hero Score Display */}
      <div className="bg-[#0f1411] border border-white/10 p-4 mb-4 text-center">
        <span className="font-mono text-[10px] text-[#aab5ac] tracking-widest uppercase block mb-0.5">
          TEAM AVERAGE SCORE
        </span>
        <div className={`font-display font-black text-4xl md:text-5xl ${theme.scoreColor} tracking-tight`}>
          {Math.round(entry.teamAverageScore || 0).toLocaleString()}
          <span className="font-mono text-xs font-bold text-[#aab5ac] ml-1">pts</span>
        </div>
        {entry.averageTimeSeconds > 0 && (
          <span className="font-mono text-[11px] text-[#aab5ac] block mt-1">
            ⏱ Avg Time: <strong className="text-[#e8ece3]">{entry.averageTimeSeconds}s</strong>
          </span>
        )}
      </div>

      {/* Member Roster Breakdown (Zero Question Leak) */}
      {entry.memberBreakdown && entry.memberBreakdown.length > 0 && (
        <div className="border-t border-white/10 pt-3">
          <span className="font-mono text-[10px] text-[#aab5ac] uppercase tracking-widest font-bold block mb-2">
            SQUAD ROSTER ({entry.activeMembersCount || entry.membersCount}):
          </span>
          <div className="flex flex-wrap gap-1.5">
            {entry.memberBreakdown.map((m, idx) => (
              <span
                key={idx}
                className={`font-mono text-[11px] px-2 py-0.5 border ${
                  m.isExcused
                    ? 'border-[#ff6b5e]/40 bg-[#ff6b5e]/10 text-[#ff6b5e] line-through'
                    : 'border-white/10 bg-[#090c0a] text-[#e8ece3]'
                }`}
              >
                {m.name}: <strong className="text-[#ffe36e]">{m.score || 0}</strong>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
