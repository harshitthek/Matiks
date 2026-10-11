import React, { useState } from 'react';
import { TactileButton } from '../common/TactileButton.jsx';
import { WashiTape } from '../common/WashiTape.jsx';

/**
 * Hardware Failure Recovery: Excuse Member Modal (ADR-10).
 * Dynamically re-adjusts team average divisor when a student device crashes or loses power.
 */
export function ExcuseMemberModal({ room, onClose, onExcuse, isLoading }) {
  const [selectedRoll, setSelectedRoll] = useState(
    room?.members?.find((m) => !m.isExcused)?.rollNumber || ''
  );
  const [reason, setReason] = useState('Laptop battery died during sprint run');
  const [error, setError] = useState(null);

  if (!room) return null;

  const activeMembers = room.members?.filter((m) => !m.isExcused) || [];

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedRoll) {
      setError('Select an active team member to excuse.');
      return;
    }
    if (!reason || reason.trim().length === 0) {
      setError('A valid audit reason is required.');
      return;
    }

    try {
      setError(null);
      await onExcuse(room.teamCode, selectedRoll, reason.trim());
      onClose();
    } catch (err) {
      setError(err?.message || 'Failed to excuse member.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="cyber-card cyber-card-ember w-full max-w-lg p-6 md:p-8 relative">
        <WashiTape color="ember" rotation="-2deg" className="-top-3 right-8" />

        <div className="flex items-center justify-between pb-3 mb-4 border-b border-white/10">
          <div>
            <span className="font-mono text-xs text-[#ff6b5e] font-bold tracking-widest uppercase block">
              § HARDWARE FAILURE RECOVERY (ADR-10)
            </span>
            <h3 className="font-display font-black text-xl text-[#e8ece3]">
              EXCUSE TEAM MEMBER
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-[#aab5ac] hover:text-[#e8ece3] font-mono text-xl p-1"
          >
            ✕
          </button>
        </div>

        <p className="font-mono text-xs text-[#ffe36e] mb-4">
          SQUAD: <strong>{room.teamName} (#{room.teamCode})</strong>
          <br />
          <span className="text-[#aab5ac]">
            Excusing a member removes them from the team scoring divisor (e.g. dividing by 2 instead of 3),
            recalculating team standing and preserving an immutable audit log.
          </span>
        </p>

        {error && (
          <div className="border border-[#ff6b5e] bg-[#ff6b5e]/10 p-3 mb-4 font-mono text-xs text-[#ff6b5e]">
            ⚠️ {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="font-mono text-[10px] text-[#aab5ac] uppercase font-bold block mb-1">
              SELECT MEMBER TO EXCUSE
            </label>
            <select
              value={selectedRoll}
              onChange={(e) => setSelectedRoll(e.target.value)}
              className="w-full bg-[#090c0a] border border-white/20 px-3 py-2.5 font-mono text-sm text-[#e8ece3] outline-none focus:border-[#ff6b5e]"
            >
              {activeMembers.map((m) => (
                <option key={m.rollNumber} value={m.rollNumber}>
                  {m.name} ({m.rollNumber}) — Q{m.completedQuestions || 0} ({m.individualScore || 0} pts)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="font-mono text-[10px] text-[#aab5ac] uppercase font-bold block mb-1">
              AUDIT JUSTIFICATION / REASON
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Battery depleted at Q8 / Browser crash"
              className="w-full bg-[#090c0a] border border-white/20 px-3 py-2.5 font-mono text-sm text-[#e8ece3] outline-none focus:border-[#ff6b5e]"
            />
          </div>

          <div className="flex justify-end gap-3 pt-3 border-t border-white/10">
            <TactileButton
              type="button"
              variant="muted"
              onClick={onClose}
              disabled={isLoading}
              className="px-4 py-2.5 text-xs"
            >
              CANCEL
            </TactileButton>

            <TactileButton
              type="submit"
              variant="ember"
              disabled={isLoading || activeMembers.length === 0}
              className="px-6 py-2.5 text-xs font-bold"
            >
              {isLoading ? 'EXCUSING...' : 'CONFIRM EXCUSE ↵'}
            </TactileButton>
          </div>
        </form>
      </div>
    </div>
  );
}
