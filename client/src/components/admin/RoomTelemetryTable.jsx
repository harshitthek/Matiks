import React, { useState } from 'react';
import { RadarDot } from '../common/RadarDot.jsx';
import { TactileButton } from '../common/TactileButton.jsx';

/**
 * Organizer Room Telemetry & Governance Controls Table.
 * Allows monitoring room statuses and dispatching pause, resume, excuse, kick,
 * dissolve, disqualify, reinstate, and score adjustment actions.
 */
export function RoomTelemetryTable({
  rooms = [],
  onPauseRoom,
  onResumeRoom,
  onOpenExcuseModal,
  onInspectSession,
  onKickMember,
  onDissolveRoom,
  onDisqualifyTeam,
  onReinstateTeam,
  onAdjustScore,
  actionLoading
}) {
  const [adjustingTeamCode, setAdjustingTeamCode] = useState(null);
  const [scoreDelta, setScoreDelta] = useState('');
  const [scoreReason, setScoreReason] = useState('');

  if (!rooms || rooms.length === 0) {
    return (
      <div className="cyber-card p-8 text-center text-[#aab5ac] font-mono text-xs">
        NO ACTIVE SQUAD ROOMS REGISTERED YET.
      </div>
    );
  }

  const handleScoreSubmit = (e, teamCode) => {
    e.preventDefault();
    const delta = parseInt(scoreDelta, 10);
    if (isNaN(delta) || delta === 0) {
      alert('Enter a valid point adjustment delta (e.g. 50 or -100).');
      return;
    }
    if (!scoreReason.trim()) {
      alert('Audit justification reason is required.');
      return;
    }
    onAdjustScore(teamCode, delta, scoreReason.trim());
    setAdjustingTeamCode(null);
    setScoreDelta('');
    setScoreReason('');
  };

  const handleKick = (teamCode, rollNumber, memberName) => {
    if (window.confirm(`Kick member ${memberName} (${rollNumber}) from squad ${teamCode}?`)) {
      onKickMember(teamCode, rollNumber);
    }
  };

  const handleDissolve = (teamCode, teamName) => {
    const reason = window.prompt(`Dissolve squad "${teamName}" (#${teamCode})? Enter reason:`, 'Abandoned lobby');
    if (reason && reason.trim()) {
      onDissolveRoom(teamCode, reason.trim());
    }
  };

  const handleDisqualifyToggle = (room) => {
    if (room.isDisqualified) {
      if (window.confirm(`Reinstate squad "${room.teamName}" (#${room.teamCode}) to active standings?`)) {
        onReinstateTeam(room.teamCode);
      }
    } else {
      const reason = window.prompt(`Disqualify squad "${room.teamName}" (#${room.teamCode})? Enter justification:`, 'Rule violation');
      if (reason && reason.trim()) {
        onDisqualifyTeam(room.teamCode, reason.trim());
      }
    }
  };

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
          const isPreSprint = room.status === 'LOBBY' || room.status === 'AWAITING_READY';
          const isFinished = room.status === 'FINISHED';
          const isActionBusy = actionLoading === room.teamCode;

          return (
            <div
              key={room.teamCode}
              className={`p-4 border transition-all ${
                room.isDisqualified
                  ? 'border-[#ff6b5e] bg-[#ff6b5e]/10'
                  : isPaused
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
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-mono text-xs font-bold bg-[#ffe36e] text-[#090c0a] px-2 py-0.5 border border-[#090c0a]">
                    #{room.teamCode}
                  </span>
                  <span className="font-display font-extrabold text-base md:text-lg text-[#e8ece3]">
                    {room.teamName}
                  </span>
                  <span
                    className={`font-mono text-[10px] px-2 py-0.5 border font-bold uppercase ${
                      room.isDisqualified
                        ? 'border-[#ff6b5e] text-[#ff6b5e] bg-[#ff6b5e]/20'
                        : isPaused
                        ? 'border-[#f5a623] text-[#f5a623] bg-[#f5a623]/20 animate-pulse'
                        : isInSprint
                        ? 'border-[#2ee58f] text-[#2ee58f] bg-[#2ee58f]/10'
                        : isFinished
                        ? 'border-[#ffe36e] text-[#ffe36e] bg-[#ffe36e]/10'
                        : 'border-white/20 text-[#aab5ac]'
                    }`}
                  >
                    {room.isDisqualified ? 'DISQUALIFIED 🚫' : isPaused ? 'PAUSED ⚠️' : room.status}
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
                  {(isInSprint || room.status === 'AWAITING_READY') && (
                    <TactileButton
                      variant="ember"
                      onClick={() => onOpenExcuseModal(room)}
                      disabled={isActionBusy}
                      className="px-3 py-1.5 text-xs font-bold"
                    >
                      [EXCUSE MEMBER]
                    </TactileButton>
                  )}

                  {/* Pre-Sprint Dissolve */}
                  {isPreSprint && (
                    <TactileButton
                      variant="ember"
                      onClick={() => handleDissolve(room.teamCode, room.teamName)}
                      disabled={isActionBusy}
                      className="px-3 py-1.5 text-xs font-bold"
                    >
                      💥 DISSOLVE
                    </TactileButton>
                  )}

                  {/* Score Adjustment Toggle */}
                  <button
                    type="button"
                    onClick={() => setAdjustingTeamCode(adjustingTeamCode === room.teamCode ? null : room.teamCode)}
                    disabled={isActionBusy}
                    className="px-2.5 py-1.5 border border-[#ffe36e]/40 bg-[#ffe36e]/10 text-[#ffe36e] hover:bg-[#ffe36e] hover:text-[#090c0a] font-mono text-xs font-bold transition-all"
                  >
                    ⚖️ SCORE
                  </button>

                  {/* Disqualify / Reinstate */}
                  <button
                    type="button"
                    onClick={() => handleDisqualifyToggle(room)}
                    disabled={isActionBusy}
                    className={`px-2.5 py-1.5 border font-mono text-xs font-bold transition-all ${
                      room.isDisqualified
                        ? 'border-[#2ee58f] bg-[#2ee58f]/20 text-[#2ee58f] hover:bg-[#2ee58f] hover:text-[#090c0a]'
                        : 'border-[#ff6b5e]/40 bg-[#ff6b5e]/10 text-[#ff6b5e] hover:bg-[#ff6b5e] hover:text-[#090c0a]'
                    }`}
                  >
                    {room.isDisqualified ? '✅ REINSTATE' : '🚫 DQ'}
                  </button>
                </div>
              </div>

              {/* Inline Score Adjustment Bar */}
              {adjustingTeamCode === room.teamCode && (
                <form
                  onSubmit={(e) => handleScoreSubmit(e, room.teamCode)}
                  className="p-3 mb-3 border border-[#ffe36e] bg-[#ffe36e]/10 flex flex-col sm:flex-row gap-2 items-center"
                >
                  <input
                    type="number"
                    value={scoreDelta}
                    onChange={(e) => setScoreDelta(e.target.value)}
                    placeholder="Points (e.g. -100 or +50)"
                    className="w-full sm:w-40 bg-[#090c0a] border border-[#ffe36e] px-2 py-1 font-mono text-xs text-[#e8ece3] outline-none"
                    autoFocus
                  />
                  <input
                    type="text"
                    value={scoreReason}
                    onChange={(e) => setScoreReason(e.target.value)}
                    placeholder="Mandatory audit justification reason..."
                    className="w-full flex-1 bg-[#090c0a] border border-[#ffe36e] px-2 py-1 font-mono text-xs text-[#e8ece3] outline-none"
                  />
                  <div className="flex items-center gap-1 shrink-0">
                    <TactileButton variant="butter" type="submit" className="px-3 py-1 text-xs font-bold">
                      SAVE ↵
                    </TactileButton>
                    <button
                      type="button"
                      onClick={() => setAdjustingTeamCode(null)}
                      className="px-2 py-1 font-mono text-xs text-[#aab5ac] hover:text-white"
                    >
                      CANCEL
                    </button>
                  </div>
                </form>
              )}

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

                      <div className="text-right shrink-0 flex flex-col items-end gap-1">
                        <div>
                          <span className="font-bold text-[#ffe36e] inline-block mr-1">
                            {m.individualScore || 0} pts
                          </span>
                          <span className="text-[10px] text-[#aab5ac]">
                            {m.isExcused ? 'EXCUSED' : m.isReady ? 'READY 🟢' : 'NOT READY ⚪'}
                          </span>
                        </div>

                        <div className="flex items-center gap-1">
                          {isPreSprint && (
                            <button
                              type="button"
                              onClick={() => handleKick(room.teamCode, m.rollNumber, m.name)}
                              disabled={isActionBusy}
                              className="px-1.5 py-0.5 border border-[#ff6b5e]/40 bg-[#ff6b5e]/10 text-[#ff6b5e] hover:bg-[#ff6b5e] hover:text-[#090c0a] font-bold text-[9px] transition-all cursor-pointer"
                              title="Kick member from lobby"
                            >
                              KICK ✕
                            </button>
                          )}
                          {m.activeSessionId && onInspectSession && (
                            <button
                              type="button"
                              onClick={() => onInspectSession(m.activeSessionId)}
                              className="px-1.5 py-0.5 border border-[#2ee58f]/40 bg-[#2ee58f]/10 text-[#2ee58f] hover:bg-[#2ee58f] hover:text-[#090c0a] font-bold text-[9px] transition-all cursor-pointer"
                              title="Inspect sprint chronology"
                            >
                              🔍 REPLAY
                            </button>
                          )}
                        </div>
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
