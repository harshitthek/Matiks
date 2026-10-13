import React, { useState } from 'react';
import { RansomNote } from '../common/RansomNote.jsx';
import { TactileButton } from '../common/TactileButton.jsx';

/**
 * Organizer Emergency Control Center Modal.
 * High-stakes global controls: Emergency Pause All, Synchronized Unfreeze All,
 * and Live Flash Announcements.
 */
export function EmergencyControlModal({
  isOpen,
  onClose,
  rooms = [],
  onEmergencyPauseAll,
  onEmergencyResumeAll,
  onFlashBroadcast,
  actionLoading
}) {
  const [activeTab, setActiveTab] = useState('PAUSE_RESUME'); // PAUSE_RESUME | FLASH_BROADCAST
  const [confirmedChallenge, setConfirmedChallenge] = useState(false);
  const [flashMessage, setFlashMessage] = useState('');
  const [flashPriority, setFlashPriority] = useState('emergency');

  if (!isOpen) return null;

  const inSprintRooms = rooms.filter((r) => r.status === 'IN_SPRINT' && !r.isPaused);
  const pausedRooms = rooms.filter((r) => r.isPaused);

  const handlePauseAll = () => {
    if (!confirmedChallenge) return;
    onEmergencyPauseAll();
    setConfirmedChallenge(false);
  };

  const handleResumeAll = () => {
    if (!confirmedChallenge) return;
    onEmergencyResumeAll();
    setConfirmedChallenge(false);
  };

  const handleSendFlash = (e) => {
    e.preventDefault();
    if (!flashMessage.trim()) return;
    onFlashBroadcast(flashMessage.trim(), flashPriority);
    setFlashMessage('');
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Organizer Emergency Control Center"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#090c0a]/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl cyber-card border-3 border-[#ff6b5e] bg-[#0c120e] shadow-[8px_8px_0px_#090c0a] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Bar */}
        <div className="p-4 border-b-2 border-[#ff6b5e]/40 bg-[#090c0a] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <RansomNote text="EMERGENCY CONTROLS" size="sm" />
            <span className="font-mono text-[10px] bg-[#ff6b5e] text-[#090c0a] px-2 py-0.5 font-bold uppercase animate-pulse">
              HIGH STAKES
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-xs text-[#aab5ac] hover:text-[#ff6b5e] font-bold px-2 py-1"
          >
            ESC ✕
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-white/10 bg-[#090c0a]/80">
          <button
            type="button"
            onClick={() => setActiveTab('PAUSE_RESUME')}
            className={`flex-1 py-2.5 font-mono text-xs font-bold transition-all ${
              activeTab === 'PAUSE_RESUME'
                ? 'border-b-2 border-[#ff6b5e] text-[#ff6b5e] bg-[#ff6b5e]/10'
                : 'text-[#aab5ac] hover:text-[#e8ece3]'
            }`}
          >
            ⏸ / ▶ GLOBAL SPRINT CONTROLS
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('FLASH_BROADCAST')}
            className={`flex-1 py-2.5 font-mono text-xs font-bold transition-all ${
              activeTab === 'FLASH_BROADCAST'
                ? 'border-b-2 border-[#ffe36e] text-[#ffe36e] bg-[#ffe36e]/10'
                : 'text-[#aab5ac] hover:text-[#e8ece3]'
            }`}
          >
            📢 FLASH BROADCAST BANNER
          </button>
        </div>

        {/* Tab Content */}
        <div className="p-5">
          {activeTab === 'PAUSE_RESUME' && (
            <div className="space-y-4">
              {/* Telemetry Snapshot */}
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="p-2.5 border border-white/10 bg-[#090c0a]">
                  <div className="font-mono text-[10px] text-[#aab5ac] uppercase">TOTAL SQUADS</div>
                  <div className="font-mono text-xl font-extrabold text-[#e8ece3]">{rooms.length}</div>
                </div>
                <div className="p-2.5 border border-[#2ee58f]/40 bg-[#2ee58f]/10">
                  <div className="font-mono text-[10px] text-[#2ee58f] uppercase">IN SPRINT</div>
                  <div className="font-mono text-xl font-extrabold text-[#2ee58f]">{inSprintRooms.length}</div>
                </div>
                <div className="p-2.5 border border-[#f5a623]/40 bg-[#f5a623]/10">
                  <div className="font-mono text-[10px] text-[#f5a623] uppercase">PAUSED</div>
                  <div className="font-mono text-xl font-extrabold text-[#f5a623]">{pausedRooms.length}</div>
                </div>
              </div>

              <p className="font-mono text-xs text-[#aab5ac] leading-relaxed">
                Emergency pause locks question inputs across all currently running squads while keeping lobby/finished squads intact. Resuming unfreezes paused squads and adds elapsed paused time to each squad's deadline.
              </p>

              {/* Safety Confirmation Checkbox */}
              <label className="flex items-center gap-3 p-3 border border-[#ff6b5e]/40 bg-[#ff6b5e]/10 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={confirmedChallenge}
                  onChange={(e) => setConfirmedChallenge(e.target.checked)}
                  className="w-4 h-4 accent-[#ff6b5e]"
                />
                <span className="font-mono text-xs font-bold text-[#ff6b5e]">
                  I CONFIRM THIS GLOBAL ACTION AFFECTS LIVE SQUADS STADIUM-WIDE.
                </span>
              </label>

              {/* Action Buttons */}
              <div className="grid grid-cols-2 gap-3 pt-2">
                <TactileButton
                  variant="ember"
                  disabled={!confirmedChallenge || inSprintRooms.length === 0 || Boolean(actionLoading)}
                  onClick={handlePauseAll}
                  className="py-3 text-xs font-bold w-full"
                >
                  ⏸ PAUSE ALL SPRINTS ({inSprintRooms.length})
                </TactileButton>

                <TactileButton
                  variant="signal"
                  disabled={!confirmedChallenge || pausedRooms.length === 0 || Boolean(actionLoading)}
                  onClick={handleResumeAll}
                  className="py-3 text-xs font-bold w-full"
                >
                  ▶ UNFREEZE ALL SPRINTS ({pausedRooms.length})
                </TactileButton>
              </div>
            </div>
          )}

          {activeTab === 'FLASH_BROADCAST' && (
            <form onSubmit={handleSendFlash} className="space-y-4">
              <p className="font-mono text-xs text-[#aab5ac]">
                Broadcast an instant banner alert displayed directly on participant screens and big-screen displays across the venue.
              </p>

              <div>
                <label className="font-mono text-[10px] text-[#aab5ac] uppercase font-bold block mb-1">
                  PRIORITY LEVEL
                </label>
                <div className="flex gap-2">
                  {[
                    { id: 'normal', label: 'NORMAL 📢', color: 'border-[#ffe36e] text-[#ffe36e]' },
                    { id: 'emergency', label: 'EMERGENCY 🚨', color: 'border-[#ff6b5e] text-[#ff6b5e]' }
                  ].map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setFlashPriority(p.id)}
                      className={`flex-1 py-1.5 font-mono text-xs font-bold border ${
                        flashPriority === p.id ? 'bg-white/10 ' + p.color : 'border-white/10 text-white/40'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="font-mono text-[10px] text-[#aab5ac] uppercase font-bold block mb-1">
                  ANNOUNCEMENT MESSAGE
                </label>
                <textarea
                  value={flashMessage}
                  onChange={(e) => setFlashMessage(e.target.value)}
                  placeholder="e.g. 5 minutes remaining in Round 1! Finish strong!"
                  rows={3}
                  className="w-full bg-[#090c0a] border-2 border-[#ffe36e]/40 focus:border-[#ffe36e] p-3 font-mono text-xs text-[#e8ece3] outline-none resize-none"
                  autoFocus
                />
              </div>

              <TactileButton
                type="submit"
                variant="butter"
                disabled={!flashMessage.trim() || Boolean(actionLoading)}
                className="w-full py-3 text-xs font-bold"
              >
                BROADCAST FLASH MESSAGE ↵
              </TactileButton>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
