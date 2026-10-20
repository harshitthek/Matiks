import React, { useState, useEffect, useCallback } from 'react';
import { WashiTape } from '../common/WashiTape.jsx';
import {
  adminGetRoster,
  adminUploadRosterCsv,
  adminLoadRosterPreset,
  adminResetRosterMember,
  adminClearRoster
} from '../../services/api.js';

/**
 * Event Roster & CSV Import Manager (Organizer HUD).
 * Allows administrators to upload team CSVs, load Unstop/consolidated presets,
 * monitor check-ins per squad, and reset individual participant sessions.
 */
export function EventRosterManager({ adminToken, onActionFeedback, onRosterUpdated }) {
  const [rosterData, setRosterData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all'); // 'all' | 'checked_in' | 'waiting'

  const fetchRoster = useCallback(async () => {
    if (!adminToken) return;
    try {
      const data = await adminGetRoster(adminToken);
      setRosterData(data);
    } catch (err) {
      console.warn('[EventRosterManager] Fetch error:', err);
    }
  }, [adminToken]);

  useEffect(() => {
    let active = true;
    if (adminToken) {
      adminGetRoster(adminToken)
        .then((data) => {
          if (active) setRosterData(data);
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [adminToken]);

  const handleUploadCsv = async (file) => {
    if (!file) return;
    setLoading(true);
    try {
      const text = await file.text();
      const res = await adminUploadRosterCsv(text, adminToken);
      onActionFeedback?.('success', `Roster imported: ${res.teamsCount} teams, ${res.membersCount} participants.`);
      await fetchRoster();
      onRosterUpdated?.();
    } catch (err) {
      onActionFeedback?.('error', err.message || 'Failed to upload roster CSV.');
    } finally {
      setLoading(false);
    }
  };

  const handleLoadPreset = async (preset) => {
    setLoading(true);
    try {
      const res = await adminLoadRosterPreset(preset, adminToken);
      onActionFeedback?.('success', `Preset loaded: ${res.teamsCount} teams, ${res.membersCount} participants.`);
      await fetchRoster();
      onRosterUpdated?.();
    } catch (err) {
      onActionFeedback?.('error', err.message || 'Failed to load roster preset.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetMember = async (email) => {
    if (!window.confirm(`Reset check-in status for ${email}? This allows the student to re-enter their squad.`)) {
      return;
    }
    setLoading(true);
    try {
      await adminResetRosterMember(email, adminToken);
      onActionFeedback?.('success', `Reset check-in status for ${email}.`);
      await fetchRoster();
      onRosterUpdated?.();
    } catch (err) {
      onActionFeedback?.('error', err.message || 'Failed to reset member check-in.');
    } finally {
      setLoading(false);
    }
  };

  const handleClearRoster = async () => {
    if (!window.confirm('Are you sure you want to CLEAR the entire competition roster? All pre-registered teams will be removed.')) {
      return;
    }
    setLoading(true);
    try {
      await adminClearRoster(adminToken);
      onActionFeedback?.('success', 'Competition roster cleared.');
      await fetchRoster();
      onRosterUpdated?.();
    } catch (err) {
      onActionFeedback?.('error', err.message || 'Failed to clear roster.');
    } finally {
      setLoading(false);
    }
  };

  const teams = rosterData?.teams || [];
  const totalTeams = rosterData?.totalTeams || 0;
  const totalMembers = teams.reduce((acc, t) => acc + (t.members?.length || 0), 0);
  const totalCheckedIn = teams.reduce(
    (acc, t) => acc + (t.members?.filter((m) => m.checkedIn)?.length || 0),
    0
  );

  const filteredTeams = teams.filter((t) => {
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch =
      !q ||
      t.teamName.toLowerCase().includes(q) ||
      t.teamCode.toLowerCase().includes(q) ||
      t.members.some((m) => m.email.toLowerCase().includes(q) || m.name?.toLowerCase().includes(q));

    if (!matchesSearch) return false;

    if (filterStatus === 'checked_in') {
      return t.members.some((m) => m.checkedIn);
    }
    if (filterStatus === 'waiting') {
      return t.members.some((m) => !m.checkedIn);
    }
    return true;
  });

  return (
    <div className="cyber-card p-6 mb-8 relative border-2 border-white/20 bg-[#0f1411]">
      <WashiTape color="butter" rotation="-1deg" className="-top-3 left-6" />

      {/* Header & Controls Toolbar */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 mb-5 border-b border-white/10 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                totalTeams > 0 ? 'bg-[#2ee58f] animate-pulse' : 'bg-[#f5a623]'
              }`}
            />
            <h2 className="font-display font-black text-xl text-[#e8ece3] tracking-wide uppercase">
              EVENT TEAM ROSTER (CSV IMPORT)
            </h2>
          </div>
          <p className="font-mono text-xs text-[#aab5ac] mt-1">
            {totalTeams > 0 ? (
              <span className="text-[#2ee58f] font-bold">
                ✓ ACTIVE ROSTER: {totalTeams} SQUADS • {totalMembers} PARTICIPANTS ({totalCheckedIn} CHECKED IN)
              </span>
            ) : (
              <span className="text-[#f5a623] font-bold">
                ⚠️ NO ROSTER LOADED — SQUADS NOT RESTRICTED
              </span>
            )}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-2 items-center">
          <label className="font-mono text-xs px-3.5 py-2 bg-[#2ee58f] hover:bg-[#3bf59e] text-[#090c0a] font-bold uppercase border-2 border-[#090c0a] shadow-[2px_2px_0_#090c0a] cursor-pointer transition-all flex items-center gap-1.5">
            <span>{loading ? 'PARSING...' : '📄 UPLOAD CSV'}</span>
            <input
              type="file"
              accept=".csv"
              className="hidden"
              disabled={loading}
              onChange={(e) => {
                if (e.target.files?.[0]) {
                  handleUploadCsv(e.target.files[0]);
                  e.target.value = '';
                }
              }}
            />
          </label>

          <button
            type="button"
            onClick={() => handleLoadPreset('competition-roster')}
            disabled={loading}
            className="font-mono text-xs px-3 py-2 bg-[#090c0a] hover:bg-[#ffe36e] hover:text-[#090c0a] text-[#ffe36e] font-bold uppercase border border-[#ffe36e]/40 transition-all cursor-pointer disabled:opacity-50"
            title="Load competition-roster.csv (28 consolidated teams)"
          >
            ⚡ 28 TEAMS PRESET
          </button>

          <button
            type="button"
            onClick={() => handleLoadPreset('final-selected-teams')}
            disabled={loading}
            className="font-mono text-xs px-3 py-2 bg-[#090c0a] hover:bg-[#ffe36e] hover:text-[#090c0a] text-[#ffe36e] font-bold uppercase border border-[#ffe36e]/40 transition-all cursor-pointer disabled:opacity-50"
            title="Load final_selected_teams.csv (Unstop full export with names)"
          >
            ⚡ UNSTOP EXPORT PRESET
          </button>

          {totalTeams > 0 && (
            <button
              type="button"
              onClick={handleClearRoster}
              disabled={loading}
              className="font-mono text-xs px-3 py-2 bg-[#ff6b5e]/20 hover:bg-[#ff6b5e] hover:text-[#090c0a] text-[#ff6b5e] font-bold uppercase border border-[#ff6b5e]/40 transition-all cursor-pointer disabled:opacity-50"
            >
              🗑 CLEAR
            </button>
          )}
        </div>
      </div>

      {/* Roster Search & Filter Controls */}
      {totalTeams > 0 && (
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <input
              type="text"
              placeholder="Search by team name, code, candidate name, or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 bg-[#090c0a] border border-white/20 focus:border-[#ffe36e] p-2.5 text-xs font-mono text-[#e8ece3] outline-none"
            />
            <div className="flex gap-1.5 shrink-0">
              {[
                { id: 'all', label: `ALL (${teams.length})` },
                { id: 'checked_in', label: `IN (${teams.filter((t) => t.members.some((m) => m.checkedIn)).length})` },
                { id: 'waiting', label: `WAITING (${teams.filter((t) => t.members.some((m) => !m.checkedIn)).length})` }
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilterStatus(f.id)}
                  className={`px-2.5 py-1 font-mono text-[10px] font-bold uppercase border transition-all cursor-pointer ${
                    filterStatus === f.id
                      ? 'border-[#ffe36e] bg-[#ffe36e] text-[#090c0a]'
                      : 'border-white/10 bg-[#090c0a] text-[#aab5ac] hover:text-[#e8ece3]'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Roster Table / Cards */}
          <div className="max-h-96 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
            {filteredTeams.map((team) => {
              const checkedCount = team.members.filter((m) => m.checkedIn).length;
              return (
                <div
                  key={team.teamCode}
                  className="p-3 bg-[#090c0a] border border-white/10 hover:border-[#ffe36e]/40 transition-all text-xs font-mono"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2 pb-1.5 border-b border-white/5">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-[#ffe36e] text-sm">{team.teamName}</span>
                      <span className="text-[10px] bg-white/10 px-1.5 py-0.5 text-[#aab5ac]">
                        #{team.teamCode}
                      </span>
                      <span className="text-[10px] text-[#2ee58f]">
                        TARGET SIZE: {team.targetSize}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px]">
                      <span
                        className={`font-bold ${
                          checkedCount === team.targetSize
                            ? 'text-[#2ee58f]'
                            : checkedCount > 0
                            ? 'text-[#ffe36e]'
                            : 'text-[#aab5ac]'
                        }`}
                      >
                        {checkedCount}/{team.targetSize} CHECKED IN
                      </span>
                    </div>
                  </div>

                  {/* Members Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                    {team.members.map((member) => (
                      <div
                        key={member.email}
                        className={`p-2 border flex items-center justify-between gap-2 text-[11px] ${
                          member.checkedIn
                            ? 'bg-[#2ee58f]/5 border-[#2ee58f]/30 text-[#e8ece3]'
                            : 'bg-[#0f1411] border-white/5 text-[#aab5ac]'
                        }`}
                      >
                        <div className="truncate min-w-0">
                          <div className="flex items-center gap-1 truncate">
                            <span className="font-bold text-[#e8ece3] truncate">
                              {member.name || member.email.split('@')[0]}
                            </span>
                            {member.isLeader && (
                              <span className="px-1 bg-[#ffe36e] text-[#090c0a] text-[9px] font-black shrink-0">
                                LEADER
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-[#aab5ac] truncate block">
                            {member.email}
                          </span>
                        </div>

                        <div className="shrink-0">
                          {member.checkedIn ? (
                            <button
                              type="button"
                              onClick={() => handleResetMember(member.email)}
                              className="px-1.5 py-0.5 bg-[#2ee58f]/20 hover:bg-[#ff6b5e] hover:text-[#090c0a] text-[#2ee58f] border border-[#2ee58f]/40 text-[9px] uppercase font-bold cursor-pointer transition-colors"
                              title="Reset check-in"
                            >
                              ✓ IN [RESET]
                            </button>
                          ) : (
                            <span className="px-1.5 py-0.5 bg-white/5 text-[#aab5ac] text-[9px] uppercase font-bold">
                              WAITING
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}

            {filteredTeams.length === 0 && (
              <div className="p-6 text-center text-[#aab5ac] font-mono text-xs border border-dashed border-white/10">
                No teams match your search filter.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
