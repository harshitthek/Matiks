import React, { useState, useEffect, useRef } from 'react';
import { RansomNote } from '../common/RansomNote.jsx';
import { TactileButton } from '../common/TactileButton.jsx';
import { RadarDot } from '../common/RadarDot.jsx';

const EXCUSE_PRESETS = [
  { label: '🔋 PHONE DIED', reason: 'Device battery died during sprint' },
  { label: '📶 WI-FI DROP', reason: 'Campus Wi-Fi disconnect during sprint' },
  { label: '💥 BROWSER CRASH', reason: 'Browser freeze/crash during sprint' }
];

/**
 * Organizer Omni-Search HUD (Ctrl+K).
 * Provides lightning-fast keyboard search across all squads, members, and roll numbers,
 * with 1-click panic recovery actions and squad governance controls.
 */
export function OmniSearchModal(props) {
  return props.isOpen ? <OmniSearchContent {...props} /> : null;
}

function OmniSearchContent({
  isOpen,
  onClose,
  rooms = [],
  onExcuseMember,
  onKickMember,
  onDissolveRoom,
  onDisqualifyTeam,
  onReinstateTeam,
  onAdjustScore,
  onPauseRoom,
  onResumeRoom
}) {
  const [query, setQuery] = useState('');
  const [filterMode, setFilterMode] = useState('ALL'); // ALL | IN_SPRINT | PRE_SPRINT | DISQUALIFIED
  const [adjustingTeamCode, setAdjustingTeamCode] = useState(null);
  const [scoreDelta, setScoreDelta] = useState('');
  const [scoreReason, setScoreReason] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const normalizedQuery = query.trim().toLowerCase();

  const filteredRooms = rooms.filter((room) => {
    // Mode filter
    if (filterMode === 'IN_SPRINT' && room.status !== 'IN_SPRINT') return false;
    if (filterMode === 'PRE_SPRINT' && room.status !== 'LOBBY' && room.status !== 'AWAITING_READY') return false;
    if (filterMode === 'DISQUALIFIED' && !room.isDisqualified) return false;

    // Search query
    if (!normalizedQuery) return true;

    const matchCode = room.teamCode?.toLowerCase().includes(normalizedQuery);
    const matchName = room.teamName?.toLowerCase().includes(normalizedQuery);
    const matchMember = room.members?.some(
      (m) =>
        m.name?.toLowerCase().includes(normalizedQuery) ||
        m.rollNumber?.toLowerCase().includes(normalizedQuery)
    );

    return matchCode || matchName || matchMember;
  });

  const handleExcusePreset = (teamCode, rollNumber, reason) => {
    if (window.confirm(`Excuse ${rollNumber} in squad ${teamCode} with reason: "${reason}"?`)) {
      onExcuseMember(teamCode, rollNumber, reason);
    }
  };

  const handleKick = (teamCode, rollNumber, memberName) => {
    if (window.confirm(`Kick member ${memberName} (${rollNumber}) from squad ${teamCode}?`)) {
      onKickMember(teamCode, rollNumber);
    }
  };

  const handleDissolve = (teamCode, teamName) => {
    const reason = window.prompt(`Dissolve squad "${teamName}" (#${teamCode})? Enter justification:`, 'Abandoned lobby');
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
      const reason = window.prompt(`Disqualify squad "${room.teamName}" (#${room.teamCode})? Enter reason:`, 'Rule violation');
      if (reason && reason.trim()) {
        onDisqualifyTeam(room.teamCode, reason.trim());
      }
    }
  };

  const handleScoreSubmit = (e, teamCode) => {
    e.preventDefault();
    const delta = parseInt(scoreDelta, 10);
    if (isNaN(delta) || delta === 0) {
      alert('Enter a valid non-zero point delta (e.g. 50 or -100).');
      return;
    }
    if (!scoreReason.trim()) {
      alert('Audit justification reason is required for score adjustments.');
      return;
    }
    onAdjustScore(teamCode, delta, scoreReason.trim());
    setAdjustingTeamCode(null);
    setScoreDelta('');
    setScoreReason('');
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Organizer Omni-Search"
      className="fixed inset-0 z-50 flex items-start justify-center pt-12 md:pt-20 p-4 bg-[#090c0a]/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl cyber-card border-3 border-[#2ee58f] bg-[#0c120e] shadow-[8px_8px_0px_#090c0a] max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Bar */}
        <div className="p-4 border-b-2 border-white/10 bg-[#090c0a] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <RansomNote text="OMNI SEARCH" size="sm" />
            <span className="font-mono text-[10px] bg-[#2ee58f] text-[#090c0a] px-2 py-0.5 font-bold uppercase">
              CTRL + K
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-xs text-[#aab5ac] hover:text-[#ff6b5e] font-bold px-2 py-1 border border-transparent hover:border-[#ff6b5e]"
          >
            ESC ✕
          </button>
        </div>

        {/* Search Input */}
        <div className="p-4 border-b border-white/10 bg-[#090c0a]/60">
          <div className="relative">
            <span className="absolute left-3 top-3.5 text-base">🔍</span>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search squad name, team code, member name, or roll number..."
              className="w-full bg-[#090c0a] border-2 border-[#2ee58f]/50 focus:border-[#2ee58f] pl-10 pr-4 py-3 font-mono text-sm text-[#e8ece3] outline-none"
            />
          </div>

          {/* Quick Filter Chips */}
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <span className="font-mono text-[10px] text-[#aab5ac] uppercase font-bold">FILTERS:</span>
            {['ALL', 'IN_SPRINT', 'PRE_SPRINT', 'DISQUALIFIED'].map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setFilterMode(mode)}
                className={`font-mono text-[10px] px-2.5 py-1 border font-bold transition-all ${
                  filterMode === mode
                    ? 'border-[#2ee58f] bg-[#2ee58f] text-[#090c0a]'
                    : 'border-white/15 bg-[#090c0a] text-[#aab5ac] hover:text-[#e8ece3]'
                }`}
              >
                {mode.replace('_', ' ')}
              </button>
            ))}
            <span className="ml-auto font-mono text-[10px] text-[#aab5ac]">
              {filteredRooms.length} squad{filteredRooms.length === 1 ? '' : 's'} found
            </span>
          </div>
        </div>

        {/* Results List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {filteredRooms.length === 0 ? (
            <div className="text-center py-12 text-[#aab5ac] font-mono text-xs">
              NO MATCHING SQUADS OR MEMBERS FOUND FOR "{query}".
            </div>
          ) : (
            filteredRooms.map((room) => {
              const isInSprint = room.status === 'IN_SPRINT';
              const isPreSprint = room.status === 'LOBBY' || room.status === 'AWAITING_READY';
              const isPaused = room.isPaused ?? false;

              return (
                <div
                  key={room.teamCode}
                  className={`p-3.5 border transition-all ${
                    room.isDisqualified
                      ? 'border-[#ff6b5e] bg-[#ff6b5e]/10'
                      : isPaused
                      ? 'border-[#f5a623] bg-[#f5a623]/10'
                      : isInSprint
                      ? 'border-[#2ee58f]/40 bg-[#2ee58f]/5'
                      : 'border-white/10 bg-[#090c0a]'
                  }`}
                >
                  {/* Room Summary Header */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-bold bg-[#ffe36e] text-[#090c0a] px-2 py-0.5 border border-[#090c0a]">
                        #{room.teamCode}
                      </span>
                      <span className="font-display font-extrabold text-sm text-[#e8ece3]">
                        {room.teamName}
                      </span>
                      <span
                        className={`font-mono text-[10px] px-1.5 py-0.5 border font-bold uppercase ${
                          room.isDisqualified
                            ? 'border-[#ff6b5e] text-[#ff6b5e] bg-[#ff6b5e]/20'
                            : isPaused
                            ? 'border-[#f5a623] text-[#f5a623] bg-[#f5a623]/20'
                            : isInSprint
                            ? 'border-[#2ee58f] text-[#2ee58f] bg-[#2ee58f]/10'
                            : 'border-white/20 text-[#aab5ac]'
                        }`}
                      >
                        {room.isDisqualified ? 'DISQUALIFIED 🚫' : isPaused ? 'PAUSED ⏸' : room.status}
                      </span>
                    </div>

                    {/* Room Level Quick Actions */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {isInSprint && (
                        <TactileButton
                          variant={isPaused ? 'signal' : 'amber'}
                          onClick={() => isPaused ? onResumeRoom(room.teamCode) : onPauseRoom(room.teamCode)}
                          className="px-2 py-1 text-[10px] font-bold"
                        >
                          {isPaused ? '▶ RESUME' : '⏸ PAUSE'}
                        </TactileButton>
                      )}

                      {isPreSprint && (
                        <TactileButton
                          variant="ember"
                          onClick={() => handleDissolve(room.teamCode, room.teamName)}
                          className="px-2 py-1 text-[10px] font-bold"
                        >
                          💥 DISSOLVE
                        </TactileButton>
                      )}

                      <button
                        type="button"
                        onClick={() => setAdjustingTeamCode(adjustingTeamCode === room.teamCode ? null : room.teamCode)}
                        className="px-2 py-1 border border-[#ffe36e]/40 bg-[#ffe36e]/10 text-[#ffe36e] hover:bg-[#ffe36e] hover:text-[#090c0a] font-mono text-[10px] font-bold transition-all"
                      >
                        ⚖️ ADJUST SCORE
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDisqualifyToggle(room)}
                        className={`px-2 py-1 border font-mono text-[10px] font-bold transition-all ${
                          room.isDisqualified
                            ? 'border-[#2ee58f] bg-[#2ee58f]/20 text-[#2ee58f] hover:bg-[#2ee58f] hover:text-[#090c0a]'
                            : 'border-[#ff6b5e]/40 bg-[#ff6b5e]/10 text-[#ff6b5e] hover:bg-[#ff6b5e] hover:text-[#090c0a]'
                        }`}
                      >
                        {room.isDisqualified ? '✅ REINSTATE' : '🚫 DISQUALIFY'}
                      </button>
                    </div>
                  </div>

                  {/* Inline Score Adjustment Box */}
                  {adjustingTeamCode === room.teamCode && (
                    <form
                      onSubmit={(e) => handleScoreSubmit(e, room.teamCode)}
                      className="p-3 mb-3 border border-[#ffe36e] bg-[#ffe36e]/10 flex flex-col sm:flex-row gap-2 items-center"
                    >
                      <input
                        type="number"
                        value={scoreDelta}
                        onChange={(e) => setScoreDelta(e.target.value)}
                        placeholder="Delta (e.g. -50 or +100)"
                        className="w-full sm:w-36 bg-[#090c0a] border border-[#ffe36e] px-2 py-1 font-mono text-xs text-[#e8ece3] outline-none"
                        autoFocus
                      />
                      <input
                        type="text"
                        value={scoreReason}
                        onChange={(e) => setScoreReason(e.target.value)}
                        placeholder="Mandatory justification reason..."
                        className="w-full flex-1 bg-[#090c0a] border border-[#ffe36e] px-2 py-1 font-mono text-xs text-[#e8ece3] outline-none"
                      />
                      <div className="flex items-center gap-1 shrink-0">
                        <TactileButton variant="butter" type="submit" className="px-3 py-1 text-[10px] font-bold">
                          APPLY ↵
                        </TactileButton>
                        <button
                          type="button"
                          onClick={() => setAdjustingTeamCode(null)}
                          className="px-2 py-1 font-mono text-[10px] text-[#aab5ac] hover:text-white"
                        >
                          CANCEL
                        </button>
                      </div>
                    </form>
                  )}

                  {/* Members & 1-Click Excuse Presets */}
                  <div className="space-y-1.5 pt-2 border-t border-white/10">
                    {room.members?.map((m) => (
                      <div
                        key={m.rollNumber}
                        className={`flex flex-col sm:flex-row sm:items-center justify-between p-2 border font-mono text-xs gap-2 ${
                          m.isExcused
                            ? 'border-[#ff6b5e]/30 bg-[#ff6b5e]/5 text-[#ff6b5e]'
                            : 'border-white/5 bg-[#0c120e] text-[#e8ece3]'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <RadarDot status={m.connected ? (m.isExcused ? 'ember' : 'online') : 'offline'} />
                          <span className={`font-bold truncate ${m.isExcused ? 'line-through' : ''}`}>
                            {m.name}
                          </span>
                          <span className="text-[10px] text-[#aab5ac]">({m.rollNumber})</span>
                          {m.isCaptain && <span className="text-[10px] text-[#ffe36e]">⭐ CAPTAIN</span>}
                          {m.isExcused && <span className="text-[10px] text-[#ff6b5e] font-bold">[EXCUSED]</span>}
                        </div>

                        {/* Action buttons per member */}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {/* 1-Click Panic Excuse Chips (During sprint or awaiting ready for unexcused members) */}
                          {(isInSprint || room.status === 'AWAITING_READY') && !m.isExcused && (
                            <div className="flex items-center gap-1">
                              {EXCUSE_PRESETS.map((preset) => (
                                <button
                                  key={preset.label}
                                  type="button"
                                  onClick={() => handleExcusePreset(room.teamCode, m.rollNumber, preset.reason)}
                                  className="px-1.5 py-0.5 border border-[#ff6b5e]/40 bg-[#ff6b5e]/10 text-[#ff6b5e] hover:bg-[#ff6b5e] hover:text-[#090c0a] font-mono text-[9px] font-bold transition-all"
                                  title={preset.reason}
                                >
                                  {preset.label}
                                </button>
                              ))}
                            </div>
                          )}

                          {/* Pre-Sprint Kick Action */}
                          {isPreSprint && (
                            <button
                              type="button"
                              onClick={() => handleKick(room.teamCode, m.rollNumber, m.name)}
                              className="px-2 py-0.5 border border-[#ff6b5e]/40 bg-[#ff6b5e]/10 text-[#ff6b5e] hover:bg-[#ff6b5e] hover:text-[#090c0a] font-mono text-[10px] font-bold transition-all"
                            >
                              KICK ✕
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer Shortcut Legend */}
        <div className="p-3 border-t border-white/10 bg-[#090c0a] flex items-center justify-between font-mono text-[10px] text-[#aab5ac]">
          <span>⚡ TIP: Instant excuse chips dynamically recompute team divisor without pausing.</span>
          <span>PRESS <strong className="text-white">ESC</strong> TO CLOSE</span>
        </div>
      </div>
    </div>
  );
}
