import React, { useState, useEffect } from 'react';
import { TactileButton } from '../common/TactileButton.jsx';
import { WashiTape } from '../common/WashiTape.jsx';
import { adminGetSessionReplay } from '../../services/api.js';

/**
 * Dispute Replay Inspector Modal.
 * Renders millisecond-by-millisecond question submission chronology,
 * timing telemetry, carry/borrow taxonomy, and anti-cheat anomaly flags.
 */
export function ReplayInspectorModal({ sessionId, onClose, adminToken }) {
  const [replay, setReplay] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!sessionId) return;
    let isCancelled = false;

    async function loadReplay() {
      setIsLoading(true);
      setError(null);
      try {
        const res = await adminGetSessionReplay(sessionId, adminToken);
        if (!isCancelled) {
          if (res?.replay) {
            setReplay(res.replay);
          } else {
            setError('Replay not found.');
          }
        }
      } catch (err) {
        if (!isCancelled) {
          setError(err?.message || 'Failed to load session replay.');
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    }

    loadReplay();
    return () => {
      isCancelled = true;
    };
  }, [sessionId, adminToken]);

  const handleExportReplayJson = () => {
    if (!replay) return;
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(replay, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `replay-${replay.sessionId}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-md animate-fade-in overflow-y-auto">
      <div className="cyber-card w-full max-w-4xl p-5 sm:p-7 relative max-h-[92vh] flex flex-col justify-between my-auto">
        <WashiTape color="signal" rotation="-1.5deg" className="-top-3 right-10" />

        {/* Modal Header */}
        <div className="flex items-start justify-between pb-3 mb-4 border-b border-white/10 shrink-0">
          <div>
            <span className="font-mono text-xs text-[#2ee58f] font-bold tracking-widest uppercase block mb-1">
              § DISPUTE REPLAY INSPECTOR (ADR-10)
            </span>
            <h3 className="font-display font-black text-lg sm:text-2xl text-[#e8ece3] tracking-tight">
              SESSION CHRONOLOGY: <span className="font-mono text-[#ffe36e]">{sessionId}</span>
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-[#aab5ac] hover:text-[#e8ece3] font-mono text-2xl p-1 leading-none"
            title="Close Inspector"
          >
            ✕
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto pr-1 space-y-4">
          {isLoading && (
            <div className="py-16 text-center font-mono text-xs text-[#aab5ac] animate-pulse">
              RETRIEVING DISK-BACKED AUDIT CHRONOLOGY...
            </div>
          )}

          {error && (
            <div className="border border-[#ff6b5e] bg-[#ff6b5e]/10 p-4 font-mono text-xs text-[#ff6b5e]">
              ⚠️ {error}
            </div>
          )}

          {!isLoading && !error && replay && (
            <>
              {/* Meta Summary Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono text-xs">
                <div className="bg-[#090c0a] border border-white/10 p-3">
                  <span className="text-[#aab5ac] text-[10px] uppercase block mb-0.5">SQUAD / PLAYER</span>
                  <span className="text-[#ffe36e] font-bold block truncate">
                    #{replay.teamCode} {replay.memberName}
                  </span>
                  <span className="text-[10px] text-[#aab5ac]">{replay.rollNumber}</span>
                </div>

                <div className="bg-[#090c0a] border border-white/10 p-3">
                  <span className="text-[#aab5ac] text-[10px] uppercase block mb-0.5">FINAL SCORE</span>
                  <span className="text-[#2ee58f] font-black text-base block">
                    {replay.finalScore?.toLocaleString()} pts
                  </span>
                  <span className="text-[10px] text-[#aab5ac]">
                    {replay.completedQuestions}/15 solved in {replay.totalTimeSeconds}s
                  </span>
                </div>

                <div className="bg-[#090c0a] border border-white/10 p-3">
                  <span className="text-[#aab5ac] text-[10px] uppercase block mb-0.5">MODE & STREAK</span>
                  <span className="text-[#e8ece3] font-bold uppercase block">
                    {replay.operatorMode || 'ADD'} MODE
                  </span>
                  <span className="text-[10px] text-[#ffe36e]">
                    Max Streak: {Math.max(0, ...(replay.submissions || []).map((s) => s.streakAfter ?? 0), replay.consecutiveStreak ?? 0)}
                  </span>
                </div>

                <div className="bg-[#090c0a] border border-white/10 p-3">
                  <span className="text-[#aab5ac] text-[10px] uppercase block mb-0.5">INTEGRITY STATUS</span>
                  {replay.anomalyCount > 0 ? (
                    <span className="text-[#ff6b5e] font-black block">
                      ⚠️ {replay.anomalyCount} FLAG{replay.anomalyCount > 1 ? 'S' : ''}
                    </span>
                  ) : (
                    <span className="text-[#2ee58f] font-bold block">
                      ✓ CLEAN RUN
                    </span>
                  )}
                  <span className="text-[10px] text-[#aab5ac]">
                    {replay.anomalyCount > 0 ? 'Latency anomaly noted' : 'All Δt ≥ 200ms'}
                  </span>
                </div>
              </div>

              {/* Submissions Timeline */}
              <div className="border border-white/10 bg-[#090c0a] p-3.5 sm:p-4">
                <div className="flex items-center justify-between pb-2 mb-3 border-b border-white/10 font-mono text-xs">
                  <span className="font-bold text-[#e8ece3] uppercase">
                    QUESTION SUBMISSION SEQUENCE ({replay.submissions?.length || 0}/15)
                  </span>
                  <span className="text-[11px] text-[#aab5ac]">
                    Started: {new Date(replay.startedAt).toLocaleTimeString()}
                  </span>
                </div>

                {(!replay.submissions || replay.submissions.length === 0) ? (
                  <div className="py-8 text-center font-mono text-xs text-[#aab5ac]">
                    NO SUBMISSIONS RECORDED FOR THIS SPRINT.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {replay.submissions.map((sub, idx) => {
                      const isCorrect = sub.isCorrect;
                      const hasAnomaly = sub.isAnomaly;

                      return (
                        <div
                          key={idx}
                          className={`p-3 border font-mono text-xs transition-all ${
                            hasAnomaly
                              ? 'border-[#ff6b5e] bg-[#ff6b5e]/10'
                              : !isCorrect
                              ? 'border-[#ff6b5e]/40 bg-[#0f1411]'
                              : 'border-white/10 bg-[#0f1411] hover:border-[#2ee58f]/40'
                          }`}
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                            {/* Question and Equation */}
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="px-1.5 py-0.5 bg-white/10 text-[#aab5ac] font-bold text-[10px]">
                                Q#{sub.questionIndex + 1}
                              </span>
                              {sub.bucket && (
                                <span className="px-1.5 py-0.5 border border-white/20 text-[#ffe36e] font-bold text-[10px]">
                                  [{sub.bucket}] {sub.carryType || ''}
                                </span>
                              )}
                              <span className="font-display font-black text-base text-[#e8ece3]">
                                {sub.a ?? '?'} {sub.operator ?? '+'} {sub.b ?? '?'} =
                              </span>
                              <span
                                className={`font-display font-black text-base px-2 py-0.5 border ${
                                  isCorrect
                                    ? 'border-[#2ee58f] bg-[#2ee58f]/20 text-[#2ee58f]'
                                    : 'border-[#ff6b5e] bg-[#ff6b5e]/20 text-[#ff6b5e] line-through'
                                }`}
                              >
                                {sub.submittedAnswer}
                              </span>
                              {!isCorrect && sub.actualAnswer !== undefined && (
                                <span className="text-[#ffe36e] font-bold text-xs">
                                  [KEY: {sub.actualAnswer}]
                                </span>
                              )}
                            </div>

                            {/* Score and Points */}
                            <div className="flex items-center gap-2 text-right">
                              <span
                                className={`font-bold ${
                                  sub.pointsAwarded > 0
                                    ? 'text-[#2ee58f]'
                                    : sub.pointsAwarded < 0
                                    ? 'text-[#ff6b5e]'
                                    : 'text-[#aab5ac]'
                                }`}
                              >
                                {sub.pointsAwarded > 0 ? `+${sub.pointsAwarded}` : sub.pointsAwarded} pts
                              </span>
                              {sub.streakAfter !== undefined && (
                                <span className="text-[#ffe36e] text-[11px]">
                                  🔥 {sub.streakAfter}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Telemetry Row */}
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[#aab5ac] pt-1.5 border-t border-white/5">
                            <span>
                              Client Δt: <strong className="text-[#ffe36e]">{sub.latencyMs}ms</strong>
                            </span>
                            {sub.serverDeltaMs !== undefined && (
                              <span>
                                Server Δt: <strong className="text-[#e8ece3]">{sub.serverDeltaMs}ms</strong>
                              </span>
                            )}
                            {sub.packetJitterMs !== undefined && (
                              <span>
                                Packet Jitter: <strong className="text-[#aab5ac]">±{sub.packetJitterMs}ms</strong>
                              </span>
                            )}
                            {sub.targetLatencyMs !== undefined && (
                              <span>
                                Calibration: <strong className="text-[#aab5ac]">{sub.targetLatencyMs}ms</strong>
                              </span>
                            )}
                            {sub.scoreAfter !== undefined && (
                              <span>
                                Running Score: <strong className="text-[#2ee58f]">{sub.scoreAfter} pts</strong>
                              </span>
                            )}
                          </div>

                          {/* Anomaly Badge */}
                          {hasAnomaly && (
                            <div className="mt-2 text-[#ff6b5e] font-mono text-[11px] font-bold bg-[#ff6b5e]/15 border border-[#ff6b5e]/40 px-2 py-1 flex items-center gap-1.5">
                              <span>⚠️ INTEGRITY FLAG:</span>
                              <span className="text-[#e8ece3]">{sub.anomalyReason || 'LATENCY_ANOMALY'}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div className="flex items-center justify-between pt-4 mt-4 border-t border-white/10 shrink-0">
          <TactileButton
            variant="muted"
            onClick={handleExportReplayJson}
            disabled={!replay}
            className="px-4 py-2 text-xs font-bold"
            title="Download full JSON chronology of this sprint session"
          >
            💾 EXPORT AUDIT JSON
          </TactileButton>

          <TactileButton
            variant="signal"
            onClick={onClose}
            className="px-6 py-2 text-xs font-bold"
          >
            CLOSE INSPECTOR ✕
          </TactileButton>
        </div>
      </div>
    </div>
  );
}
