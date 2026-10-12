import React from 'react';
import { RansomNote } from '../common/RansomNote.jsx';
import { WashiTape } from '../common/WashiTape.jsx';
import { TactileButton } from '../common/TactileButton.jsx';

/**
 * Post-Sprint Results & Performance Summary Screen.
 */
export function SprintSummary({
  finalScore = 0,
  maxStreak = 0,
  submissions = [],
  totalQuestions = 15,
  teammates = [],
  currentRoll,
  teamName = 'Squad',
  isTimeOut = false,
  onReturnToLobby,
  onPlayAgain,
  onViewLeaderboard
}) {
  const correctCount = submissions.filter((s) => s.isCorrect).length;
  const answeredCount = submissions.length;
  const accuracy = answeredCount > 0 ? Math.round((correctCount / answeredCount) * 100) : 0;

  const totalLatencyMs = submissions.reduce((acc, s) => acc + (s.latencyMs || 0), 0);
  const avgLatencySec =
    answeredCount > 0 ? (totalLatencyMs / (answeredCount * 1000)).toFixed(1) : '0.0';

  // Compute live team average score ensuring current player's finalScore is merged
  const squadScores = (() => {
    if (!teammates || teammates.length === 0) {
      return [finalScore];
    }
    const hasCurrentRoll = currentRoll && teammates.some((m) => m.rollNumber === currentRoll);
    if (hasCurrentRoll) {
      return teammates.map((m) =>
        m.rollNumber === currentRoll ? finalScore : (m.individualScore ?? m.currentScore ?? 0)
      );
    }
    return [...teammates.map((m) => m.individualScore ?? m.currentScore ?? 0), finalScore];
  })();

  const teamAverage = Math.round(
    squadScores.reduce((a, b) => a + b, 0) / (squadScores.length || 1)
  );

  // Cognitive Latency Diagnostics
  const categoryDiagnostics = (() => {
    if (!submissions || submissions.length === 0) return null;

    const categories = [
      { id: 'clean', label: 'CLEAN // NO CARRY', buckets: ['B1', 'S1'], targetMs: 3600, color: '#2ee58f' },
      { id: 'ones', label: 'ONES CARRY // OVERLOAD', buckets: ['B2'], targetMs: 5500, color: '#ffe36e' },
      { id: 'century', label: 'CENTURY // 100+ BREAKER', buckets: ['B3'], targetMs: 6000, color: '#f5a623' },
      { id: 'double', label: 'DOUBLE / REGROUP BORROW', buckets: ['B4', 'S2'], targetMs: 7200, color: '#ff6b5e' }
    ];

    const data = categories
      .map((cat) => {
        const items = submissions.filter((s) => cat.buckets.includes(s.bucket));
        if (items.length === 0) return null;
        const totalLat = items.reduce((acc, s) => acc + (s.latencyMs || 0), 0);
        const avgLatMs = Math.round(totalLat / items.length);
        const correct = items.filter((s) => s.isCorrect).length;
        const acc = Math.round((correct / items.length) * 100);
        const ratio = avgLatMs / cat.targetMs;
        return {
          ...cat,
          count: items.length,
          correct,
          avgLatSec: (avgLatMs / 1000).toFixed(1),
          avgLatMs,
          accuracy: acc,
          ratio
        };
      })
      .filter(Boolean);

    if (data.length === 0) return null;

    const bottleneck = [...data].sort((a, b) => b.ratio - a.ratio)[0];

    return { data, bottleneck };
  })();

  return (
    <div className="w-full max-w-3xl mx-auto px-4 py-8">
      {/* Title Card */}
      <div className="cyber-card cyber-card-signal p-6 md:p-8 text-center relative mb-6">
        <WashiTape color="signal" rotation="-2deg" className="-top-3 -right-4" />

        <div className="font-mono text-xs text-[#2ee58f] font-bold tracking-widest uppercase mb-3">
          § 03 // SPRINT COMPLETED • AUDIT LOG VERIFIED
        </div>

        <div className="mb-4">
          <RansomNote text={isTimeOut ? "TIME'S UP!" : "SPRINT COMPLETE!"} size="lg" />
        </div>

        <p className="font-mono text-sm text-[#ffe36e] mb-6">
          SQUAD: <strong>{teamName}</strong> • INDIVIDUAL RUN FINISHED
        </p>

        {/* Hero Score Tile */}
        <div className="bg-[#090c0a] border-2 border-[#2ee58f] p-6 mb-6 shadow-[4px_4px_0_#2ee58f]">
          <span className="font-mono text-xs text-[#aab5ac] tracking-widest uppercase block mb-1">
            FINAL INDIVIDUAL SCORE
          </span>
          <span className="font-display font-extrabold text-5xl md:text-7xl text-[#2ee58f] tracking-tight">
            {finalScore.toLocaleString()}
          </span>
          <span className="font-mono text-xs text-[#ffe36e] block mt-1 font-bold">
            POINTS CONTRIBUTED TO SQUAD AVERAGE
          </span>
        </div>

        {/* 4 Stat Highlights Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="p-3 bg-[#090c0a] border border-[#2ee58f]/30">
            <span className="font-mono text-[10px] text-[#aab5ac] uppercase block">ACCURACY</span>
            <span className="font-mono text-lg font-bold text-[#e8ece3]">
              {correctCount} / {answeredCount} ({accuracy}%)
            </span>
          </div>

          <div className="p-3 bg-[#090c0a] border border-[#2ee58f]/30">
            <span className="font-mono text-[10px] text-[#aab5ac] uppercase block">PEAK STREAK</span>
            <span className="font-mono text-lg font-bold text-[#f5a623]">
              🔥 {maxStreak}x
            </span>
          </div>

          <div className="p-3 bg-[#090c0a] border border-[#2ee58f]/30">
            <span className="font-mono text-[10px] text-[#aab5ac] uppercase block">AVG SPEED</span>
            <span className="font-mono text-lg font-bold text-[#2ee58f]">
              {avgLatencySec}s / Q
            </span>
          </div>

          <div className="p-3 bg-[#090c0a] border border-[#2ee58f]/30">
            <span className="font-mono text-[10px] text-[#aab5ac] uppercase block">SQUAD AVERAGE</span>
            <span className="font-mono text-lg font-bold text-[#ffe36e]">
              {teamAverage.toLocaleString()} pts
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row flex-wrap gap-3 justify-center">
          <TactileButton
            variant="signal"
            onClick={onReturnToLobby}
            className="w-full sm:w-auto px-6 py-3.5 text-sm"
          >
            ← RETURN TO SQUAD LOBBY
          </TactileButton>

          {onPlayAgain && (
            <TactileButton
              variant="ghost"
              onClick={onPlayAgain}
              className="w-full sm:w-auto px-6 py-3.5 text-sm"
            >
              🔄 PLAY AGAIN WITH SQUAD
            </TactileButton>
          )}

          {onViewLeaderboard && (
            <TactileButton
              variant="butter"
              onClick={onViewLeaderboard}
              className="w-full sm:w-auto px-6 py-3.5 text-sm"
            >
              🏆 VIEW LIVE LEADERBOARD
            </TactileButton>
          )}
        </div>
      </div>

      {/* Cognitive Latency Diagnostics */}
      {categoryDiagnostics && (
        <div className="cyber-card p-5 sm:p-6 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 mb-4 border-b border-[#2ee58f]/20">
            <div>
              <span className="font-mono text-[10px] text-[#2ee58f] font-bold tracking-widest uppercase block">
                COGNITIVE LATENCY DIAGNOSTICS
              </span>
              <h3 className="font-display font-bold text-base sm:text-lg text-[#e8ece3]">
                SPEED & TAXONOMY BOTTLENECK ANALYSIS
              </h3>
            </div>
            {categoryDiagnostics.bottleneck && (
              <div className="px-2.5 py-1 bg-[#ff6b5e]/15 border border-[#ff6b5e] font-mono text-[11px] text-[#ff6b5e] font-bold shrink-0">
                BOTTLENECK: {categoryDiagnostics.bottleneck.label.split(' // ')[0]} ({categoryDiagnostics.bottleneck.avgLatSec}s)
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {categoryDiagnostics.data.map((cat) => (
              <div key={cat.id} className="p-3 bg-[#090c0a] border border-[#2ee58f]/20 flex flex-col justify-between">
                <div className="flex items-center justify-between text-xs font-mono mb-2">
                  <span className="font-bold text-[#e8ece3] truncate">{cat.label}</span>
                  <span className="text-[#aab5ac] shrink-0 font-bold">
                    {cat.count} attempted ({cat.correct} correct)
                  </span>
                </div>
                <div className="w-full bg-[#161d18] h-2.5 mb-2 border border-[#090c0a] overflow-hidden">
                  <div
                    className="h-full transition-all"
                    style={{
                      width: `${Math.min(100, Math.round((cat.avgLatMs / 8000) * 100))}%`,
                      backgroundColor: cat.color
                    }}
                  />
                </div>
                <div className="flex items-center justify-between font-mono text-[11px] text-[#aab5ac]">
                  <span>AVG: <strong className="text-[#e8ece3]">{cat.avgLatSec}s</strong> (target {(cat.targetMs / 1000).toFixed(1)}s)</span>
                  <span>ACCURACY: <strong className={cat.accuracy >= 80 ? 'text-[#2ee58f]' : 'text-[#ff6b5e]'}>{cat.accuracy}%</strong></span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Question by Question Audit Log */}
      {submissions.length > 0 && (
        <div className="cyber-card p-6">
          <h3 className="font-mono text-xs uppercase tracking-widest text-[#e8ece3] font-bold pb-3 mb-4 border-b border-[#2ee58f]/20">
            PROBLEM AUDIT BREAKDOWN ({submissions.length}/{totalQuestions})
          </h3>
          <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
            {submissions.map((sub, idx) => (
              <div
                key={idx}
                className={`flex items-center justify-between p-2.5 border font-mono text-xs ${
                  sub.isCorrect
                    ? 'border-[#2ee58f]/30 bg-[#2ee58f]/5 text-[#e8ece3]'
                    : 'border-[#ff6b5e]/30 bg-[#ff6b5e]/5 text-[#ff6b5e]'
                }`}
              >
                <div className="flex items-center gap-2 sm:gap-3">
                  <span className="text-[#aab5ac]">#{idx + 1}</span>
                  {sub.bucket && (
                    <span className="text-[10px] px-1 py-0.5 border border-[#2ee58f]/30 text-[#2ee58f] font-mono font-bold">
                      {sub.bucket}
                    </span>
                  )}
                  <span className="font-bold">
                    {sub.a} {sub.operator || '+'} {sub.b} = {sub.answer}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[#aab5ac]">
                    {((sub.latencyMs || 0) / 1000).toFixed(1)}s
                  </span>
                  <span
                    className={`font-bold ${
                      sub.isCorrect ? 'text-[#2ee58f]' : 'text-[#ff6b5e]'
                    }`}
                  >
                    {sub.isCorrect ? `+${sub.pointsAwarded} pts` : `${sub.pointsAwarded} pts`}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
