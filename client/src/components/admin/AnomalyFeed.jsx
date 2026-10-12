import React from 'react';

/**
 * Real-Time Anti-Cheat Anomaly Stream (ADR-10).
 * Displays sub-200ms bot script flags and packet jitter anomalies.
 */
export function AnomalyFeed({ anomalies = [], onInspectSession }) {
  if (!anomalies || anomalies.length === 0) {
    return (
      <div className="cyber-card p-5 mb-6 text-center text-[#aab5ac] font-mono text-xs">
        <span className="text-[#2ee58f] font-bold">✓ ZERO INTEGRITY ANOMALIES DETECTED.</span>
        <br />
        All student answer submissions within normal human latency parameters (≥ 200ms).
      </div>
    );
  }

  return (
    <div className="cyber-card cyber-card-ember p-5 md:p-6 mb-6">
      <div className="flex items-center justify-between pb-3 mb-4 border-b border-[#ff6b5e]/20">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-[#ff6b5e] animate-ping" />
          <h3 className="font-mono text-xs uppercase tracking-widest text-[#ff6b5e] font-bold">
            ⚠️ ANTI-CHEAT INTEGRITY ALERTS ({anomalies.length})
          </h3>
        </div>
      </div>

      <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
        {anomalies.map((flag, idx) => (
          <div
            key={idx}
            className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 bg-[#090c0a] border border-[#ff6b5e]/40 font-mono text-xs"
          >
            <div className="flex items-center gap-3">
              <span className="text-[#ff6b5e] font-bold">
                [{flag.flagReason || 'ANOMALY'}]
              </span>
              <span className="text-[#e8ece3] font-bold">
                {flag.name} ({flag.rollNumber})
              </span>
              <span className="text-[#aab5ac]">#{flag.teamCode}</span>
            </div>

            <div className="flex items-center gap-3 text-[11px]">
              <span className="text-[#ffe36e]">
                Q#{flag.questionIndex + 1} • {flag.clientDeltaMs}ms latency
              </span>
              <span className="text-[#aab5ac]">
                {new Date(flag.timestamp).toLocaleTimeString()}
              </span>
              {flag.sessionId && onInspectSession && (
                <button
                  type="button"
                  onClick={() => onInspectSession(flag.sessionId)}
                  className="px-2 py-0.5 border border-[#ff6b5e] bg-[#ff6b5e]/20 text-[#ff6b5e] hover:bg-[#ff6b5e] hover:text-[#090c0a] font-bold text-[10px] transition-all cursor-pointer"
                  title="Inspect detailed submission chronology"
                >
                  🔍 REPLAY
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
