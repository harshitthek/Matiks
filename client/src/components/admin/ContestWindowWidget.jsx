import React, { useState } from 'react';
import { TactileButton } from '../common/TactileButton.jsx';

/**
 * Contest Window Controller Widget for Hackathon Organizers.
 * Allows opening/closing the global window and setting announcement tickers.
 */
export function ContestWindowWidget({
  windowStatus,
  onToggleWindow,
  onSimulateTeams,
  onClearSimulatedTeams,
  onExportCsv,
  onExportJson,
  onExportPlayerAuditsCsv,
  streamDelayMs = 0,
  onSetStreamDelay,
  onFlushLeaderboard,
  isLoading
}) {
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [ticker, setTicker] = useState('SPEED SPRINT ROUND 1 IS LIVE!');
  const [showConfig, setShowConfig] = useState(false);

  const isOpen = windowStatus?.isOpen ?? false;

  const handleOpenClick = () => {
    onToggleWindow(true, durationMinutes, ticker.trim() || undefined);
    setShowConfig(false);
  };

  const handleCloseClick = () => {
    onToggleWindow(false);
  };

  return (
    <div className="cyber-card p-5 md:p-6 mb-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-white/10">
        <div>
          <span className="font-mono text-xs text-[#2ee58f] font-bold tracking-widest uppercase block mb-1">
            § 01 // TOURNAMENT WINDOW CONTROLLER
          </span>
          <div className="flex items-center gap-2">
            <span
              className={`w-3 h-3 rounded-full ${
                isOpen ? 'bg-[#2ee58f] shadow-[0_0_8px_#2ee58f]' : 'bg-[#ff6b5e]'
              }`}
            />
            <span className="font-display font-extrabold text-lg md:text-xl text-[#e8ece3]">
              STATUS: {isOpen ? 'CONTEST WINDOW OPEN' : 'CONTEST WINDOW CLOSED'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {onExportCsv && (
            <TactileButton
              variant="muted"
              onClick={onExportCsv}
              disabled={isLoading}
              className="px-3 py-2.5 text-xs font-bold"
              title="Download sorted tournament leaderboard standings as CSV"
            >
              📥 EXPORT CSV
            </TactileButton>
          )}

          {onExportJson && (
            <TactileButton
              variant="muted"
              onClick={onExportJson}
              disabled={isLoading}
              className="px-3 py-2.5 text-xs font-bold"
              title="Download full tournament report (standings, rooms, telemetry, and audit logs) as JSON"
            >
              📦 EXPORT JSON
            </TactileButton>
          )}

          {onExportPlayerAuditsCsv && (
            <TactileButton
              variant="muted"
              onClick={onExportPlayerAuditsCsv}
              disabled={isLoading}
              className="px-3 py-2.5 text-xs font-bold"
              title="Download player-by-player audit telemetry and anomaly records as CSV"
            >
              📋 PLAYER AUDITS CSV
            </TactileButton>
          )}

          {onSimulateTeams && (
            <TactileButton
              variant="butter"
              onClick={onSimulateTeams}
              disabled={isLoading}
              className="px-3.5 py-2.5 text-xs font-bold"
              title="Populates 5 demo teams on the leaderboard to test 4K projector display"
            >
              🎲 SIMULATE 5 TEAMS
            </TactileButton>
          )}

          {onClearSimulatedTeams && (
            <TactileButton
              variant="muted"
              onClick={onClearSimulatedTeams}
              disabled={isLoading}
              className="px-3 py-2.5 text-xs font-bold"
              title="Clears all demo simulated teams"
            >
              🧹 CLEAR DEMO
            </TactileButton>
          )}

          {isOpen ? (
            <TactileButton
              variant="ember"
              onClick={handleCloseClick}
              disabled={isLoading}
              className="px-5 py-2.5 text-xs font-bold"
            >
              ⛔ CLOSE WINDOW NOW
            </TactileButton>
          ) : (
            <TactileButton
              variant="signal"
              onClick={() => setShowConfig(!showConfig)}
              disabled={isLoading}
              className="px-5 py-2.5 text-xs font-bold"
            >
              ⚡ OPEN CONTEST WINDOW
            </TactileButton>
          )}
        </div>
      </div>

      {/* Opening Configuration Panel */}
      {showConfig && !isOpen && (
        <div className="mt-4 p-4 bg-[#090c0a] border border-[#2ee58f]/30 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="font-mono text-[10px] text-[#aab5ac] uppercase font-bold block mb-1">
                WINDOW DURATION (MINUTES)
              </label>
              <input
                type="number"
                min="1"
                max="300"
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Math.max(1, parseInt(e.target.value, 10) || 1))}
                className="w-full bg-[#0f1411] border border-white/20 px-3 py-2 font-mono text-sm text-[#e8ece3] outline-none focus:border-[#2ee58f]"
              />
            </div>

            <div>
              <label className="font-mono text-[10px] text-[#aab5ac] uppercase font-bold block mb-1">
                ANNOUNCEMENT TICKER BANNER (OPTIONAL)
              </label>
              <input
                type="text"
                value={ticker}
                onChange={(e) => setTicker(e.target.value)}
                placeholder="e.g. SPRINT ROUND 1 LIVE"
                className="w-full bg-[#0f1411] border border-white/20 px-3 py-2 font-mono text-sm text-[#e8ece3] outline-none focus:border-[#2ee58f]"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <TactileButton
              variant="muted"
              onClick={() => setShowConfig(false)}
              className="px-4 py-2 text-xs"
            >
              CANCEL
            </TactileButton>
            <TactileButton
              variant="signal"
              onClick={handleOpenClick}
              disabled={isLoading}
              className="px-6 py-2 text-xs font-bold"
            >
              LAUNCH WINDOW ↵
            </TactileButton>
          </div>
        </div>
      )}

      {/* Active Details */}
      {isOpen && windowStatus && (
        <div className="mt-3 flex flex-wrap items-center gap-4 font-mono text-xs text-[#aab5ac]">
          {windowStatus.closesAt > 0 && (
            <span>
              CLOSES AT: <strong className="text-[#ffe36e]">{new Date(windowStatus.closesAt).toLocaleTimeString()}</strong>
            </span>
          )}
          {windowStatus.announcementTicker && (
            <span>
              TICKER: <strong className="text-[#2ee58f]">"{windowStatus.announcementTicker}"</strong>
            </span>
          )}
        </div>
      )}

      {/* Anti-Screen-Peeking Stream Buffer Controls */}
      {onSetStreamDelay && (
        <div className="mt-4 pt-4 border-t border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-[#aab5ac] uppercase font-bold">
              STAGE STREAM DELAY:
            </span>
            <span className="font-mono text-xs text-[#ffe36e] font-bold">
              {streamDelayMs === 0 ? '0s (LIVE STREAM)' : `${(streamDelayMs / 1000).toFixed(0)}s DELAY`}
            </span>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {[0, 5000, 10000, 15000].map((ms) => {
              const label = ms === 0 ? '0s (LIVE)' : `${ms / 1000}s`;
              const isSelected = streamDelayMs === ms;
              return (
                <button
                  key={ms}
                  type="button"
                  disabled={isLoading}
                  onClick={() => onSetStreamDelay(ms)}
                  className={`font-mono text-xs px-2.5 py-1 border transition-all ${
                    isLoading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                  } ${
                    isSelected
                      ? 'border-[#2ee58f] bg-[#2ee58f] text-[#090c0a] font-black shadow-[2px_2px_0_#2ee58f]'
                      : 'border-white/20 bg-[#090c0a] text-[#aab5ac] hover:border-[#2ee58f]/60 hover:text-[#e8ece3]'
                  }`}
                >
                  {label}
                </button>
              );
            })}

            {onFlushLeaderboard && (
              <TactileButton
                variant="signal"
                onClick={onFlushLeaderboard}
                disabled={isLoading}
                className="px-3 py-1 text-xs font-bold ml-1"
                title="Immediately flush pending delayed broadcasts to stage screen"
              >
                ⚡ FLUSH TO STAGE
              </TactileButton>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
