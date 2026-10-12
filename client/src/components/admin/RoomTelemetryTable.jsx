import React from 'react';
import { RadarDot } from '../common/RadarDot.jsx';
import { TactileButton } from '../common/TactileButton.jsx';

/**
 * Organizer Room Telemetry & Emergency Controls Table.
 * Allows monitoring room statuses and dispatching pause, resume, and excuse actions.
 */
export function RoomTelemetryTable({
  rooms = [],
  onPauseRoom,
  onResumeRoom,
  onOpenExcuseModal,
  onInspectSession,
  actionLoading
}) {
  if (!rooms || rooms.length === 0) {
    return (
      <div className="cyber-card p-8 text-center text-[#aab5ac] font-mono text-xs">
        NO ACTIVE SQUAD ROOMS REGISTERED YET.
      </div>
    );
  }

  return (
    <div className="cyber-card p-5 md:p-6 mb-6">
      <div className="flex items-center justify-between pb-3 mb-4 border-b border-white/10">
        <h3 className="font-mono text-xs uppercase tracking-widest text-[#e8ece3] font-bold">
          LIVE SQUAD TELEMETRY & CONTROLS ({rooms.length} SQUADS)
        </h3>
      </div>

      <div className="space-y-4">
        {rooms.map((room) => {
          const isPaused = room.isPaused ?? false;
          const isInSprint = room.status === 'IN_SPRINT';
          const isFinished = room.status === 'FINISHED';
          const isActionBusy = actionLoading === room.teamCode;

          return (
            <div
              key={room.teamCode}
              className={`p-4 border transition-all ${
                isPaused
                  ? 'border-[#f5a623] bg-[#f5a623]/10'
                  : isInSprint
                  ? 'border-[#2ee58f]/40 bg-[#2ee58f]/5'
                  : isFinished
                  ? 'border-white/20 bg-[#0f1411]'
                  : 'border-white/10 bg-[#090c0a]'
              }`}
            >
              {/* Header: Team name + code + status */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs font-bold bg-[#ffe36e] text-[#090c0a] px-2 py-0.5 border border-[#090c0a]">
                    #{room.teamCode}
                  </span>
                  <span className="font-display font-extrabold text-base md:text-lg text-[#e8ece3]">
                    {room.teamName}
                  </span>
                  <span
                    className={`font-mono text-[10px] px-2 py-0.5 border font-bold uppercase ${
                      isPaused
                        ? 'border-[#f5a623] text-[#f5a623] bg-[#f5a623]/20 animate-pulse'
                        : isInSprint
                        ? 'border-[#2ee58f] text-[#2ee58f] bg-[#2ee58f]/10'
                        : isFinished
                        ? 'border-[#ffe36e] text-[#ffe36e] bg-[#ffe36e]/10'
                        : 'border-white/20 text-[#aab5ac]'
                    }`}
                  >
                    {isPaused ? 'PAUSED ⚠️' : room.status}
                  </span>
                </div>

                {/* Organizer Room Action Buttons */}
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Pause / Resume Button (Only during sprint) */}
                  {isInSprint && (
                    <TactileButton
                      variant={isPaused ? 'signal' : 'amber'}
                      onClick={() =>
                        isPaused ? onResumeRoom(room.teamCode) : onPauseRoom(room.teamCode)
                      }
                      disabled={isActionBusy}
                      className="px-3 py-1.5 text-xs font-bold"
                    >
                      {isPaused ? '▶ RESUME SPRINT' : '⏸ PAUSE SPRINT'}
                    </TactileButton>
                  )}

                  {/* Excuse Member Button */}
                  <TactileButton
                    variant="ember"
                    onClick={() => onOpenExcuseModal(room)}
                    disabled={isActionBusy}
                    className="px-3 py-1.5 text-xs font-bold"
                  >
                    [EXCUSE MEMBER]
                  </TactileButton>
                </div>
              </div>

              {/* Members Roster Chips */}
              <div className="border-t border-white/10 pt-3">
                <span className="font-mono text-[10px] text-[#aab5ac] uppercase font-bold tracking-wider block mb-2">
                  ROSTER ({room.members?.length || 0}/{room.targetSize}):
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                  {room.members?.map((m) => (
                    <div
                      key={m.rollNumber}
                      className={`flex items-center justify-between p-2 border font-mono text-xs ${
                        m.isExcused
                          ? 'border-[#ff6b5e]/40 bg-[#ff6b5e]/10 text-[#ff6b5e]'
                          : m.connected
                          ? 'border-white/10 bg-[#090c0a] text-[#e8ece3]'
                          : 'border-white/5 bg-[#090c0a] text-[#aab5ac]'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <RadarDot
                          status={m.connected ? (m.isExcused ? 'ember' : 'online') : 'offline'}
                        />
                        <div className="min-w-0 truncate">
                          <span className={`font-bold block truncate ${m.isExcused ? 'line-through' : ''}`}>
                            {m.name}
                          </span>
                          <span className="text-[10px] text-[#aab5ac]">
                            {m.rollNumber} {m.isCaptain && '⭐'}
                          </span>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <span className="font-bold text-[#ffe36e] block">
                          {m.individualScore || 0} pts
                        </span>
                        <span className="text-[10px] text-[#aab5ac]">
                          {m.isExcused ? 'EXCUSED' : m.isReady ? 'READY 🟢' : 'NOT READY ⚪'}
                        </span>
                        {m.activeSessionId && onInspectSession && (
                          <button
                            type="button"
                            onClick={() => onInspectSession(m.activeSessionId)}
                            className="mt-1 px-1.5 py-0.5 border border-[#2ee58f]/40 bg-[#2ee58f]/10 text-[#2ee58f] hover:bg-[#2ee58f] hover:text-[#090c0a] font-bold text-[9px] transition-all cursor-pointer block ml-auto"
                            title="Inspect sprint chronology"
                          >
                            🔍 REPLAY
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
