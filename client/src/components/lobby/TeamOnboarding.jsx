import React, { useState } from 'react';
import { TactileButton } from '../common/TactileButton.jsx';
import { WashiTape } from '../common/WashiTape.jsx';
import { RansomNote } from '../common/RansomNote.jsx';
import { createTeam, joinTeam } from '../../services/api.js';

/**
 * Onboarding panel for creating a new squad or joining an existing one.
 */
export function TeamOnboarding({ initialTeamCode = '', onJoinedTeam }) {
  const [mode, setMode] = useState('join'); // 'join' | 'create'
  const [teamName, setTeamName] = useState('');
  const [teamCode, setTeamCode] = useState(() => (initialTeamCode || '').trim().toUpperCase());
  const [targetSize, setTargetSize] = useState(3);
  const [rollNumber, setRollNumber] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [existingTeamMatch, setExistingTeamMatch] = useState(null);

  const getSavedTokenForRoll = (roll) => {
    try {
      const raw = localStorage.getItem('matiks_member_tokens');
      if (!raw) return undefined;
      const vault = JSON.parse(raw);
      return vault?.[roll.trim().toUpperCase()];
    } catch {
      return undefined;
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setExistingTeamMatch(null);
    setLoading(true);

    try {
      if (mode === 'create') {
        if (!teamName.trim()) throw new Error('Please enter a squad name.');
        if (!rollNumber.trim()) throw new Error('Please enter your roll number.');
        if (!name.trim()) throw new Error('Please enter your name.');

        const res = await createTeam(teamName.trim(), targetSize, rollNumber.trim(), name.trim());
        onJoinedTeam({
          teamCode: res.teamCode,
          memberToken: res.memberToken,
          rollNumber: rollNumber.trim().toUpperCase(),
          name: name.trim(),
          isCaptain: true
        });
      } else {
        if (!teamCode.trim()) throw new Error('Please enter the squad code (e.g. ZG-99).');
        if (!rollNumber.trim()) throw new Error('Please enter your roll number.');
        if (!name.trim()) throw new Error('Please enter your name.');

        const savedToken = getSavedTokenForRoll(rollNumber);
        const res = await joinTeam(teamCode.trim().toUpperCase(), rollNumber.trim(), name.trim(), savedToken);
        onJoinedTeam({
          teamCode: teamCode.trim().toUpperCase(),
          memberToken: res.memberToken,
          rollNumber: rollNumber.trim().toUpperCase(),
          name: name.trim(),
          isCaptain: res.member?.isCaptain ?? false
        });
      }
    } catch (err) {
      const msg = err.message || 'Operation failed. Please check inputs.';
      setError(msg);
      const match = msg.match(/already registered in team ([A-Za-z0-9-]+)/i);
      if (match && match[1]) {
        setExistingTeamMatch(match[1].toUpperCase());
      }
    } finally {
      setLoading(false);
    }
  };

  const handleQuickRejoin = async (targetCode) => {
    setError(null);
    setExistingTeamMatch(null);
    setMode('join');
    setTeamCode(targetCode);
    if (!rollNumber.trim() || !name.trim()) return;
    setLoading(true);
    try {
      const savedToken = getSavedTokenForRoll(rollNumber);
      const res = await joinTeam(targetCode, rollNumber.trim(), name.trim(), savedToken);
      onJoinedTeam({
        teamCode: targetCode,
        memberToken: res.memberToken,
        rollNumber: rollNumber.trim().toUpperCase(),
        name: name.trim(),
        isCaptain: res.member?.isCaptain ?? false
      });
    } catch (err) {
      setError(err.message || 'Failed to rejoin squad.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-xl mx-auto px-4 py-8">
      {/* Hero Header */}
      <div className="text-center mb-8 relative">
        <div className="inline-block relative">
          <WashiTape color="pink" rotation="-4deg" className="-top-3 -right-6" />
          <RansomNote text="MATIKS" size="xl" />
        </div>
        <p className="font-mono text-sm tracking-widest text-[#2ee58f] mt-3 uppercase">
          § 01 // COMPETITIVE MENTAL MATH HACKATHON
        </p>
        <p className="font-body text-sm text-[#aab5ac] mt-1">
          Synchronized 2-minute sprint. 15 questions. Team score is the average.
        </p>
      </div>

      {/* Mode Switcher Tabs */}
      <div className="flex gap-3 mb-6">
        <button
          type="button"
          onClick={() => { setMode('join'); setError(null); }}
          className={`flex-1 py-3 px-4 font-mono font-bold text-sm tracking-wider uppercase border-2 transition-all ${
            mode === 'join'
              ? 'bg-[#2ee58f] text-[#090c0a] border-[#090c0a] shadow-[4px_4px_0_#090c0a] -translate-y-0.5'
              : 'bg-[#0f1411] text-[#aab5ac] border-[#2ee58f]/20 hover:border-[#2ee58f]/50'
          }`}
        >
          JOIN EXISTING SQUAD
        </button>
        <button
          type="button"
          onClick={() => { setMode('create'); setError(null); }}
          className={`flex-1 py-3 px-4 font-mono font-bold text-sm tracking-wider uppercase border-2 transition-all ${
            mode === 'create'
              ? 'bg-[#ffe36e] text-[#090c0a] border-[#090c0a] shadow-[4px_4px_0_#090c0a] -translate-y-0.5'
              : 'bg-[#0f1411] text-[#aab5ac] border-[#ffe36e]/20 hover:border-[#ffe36e]/50'
          }`}
        >
          CREATE NEW SQUAD
        </button>
      </div>

      {/* Card Form */}
      <div className="cyber-card p-6 md:p-8 relative">
        <WashiTape color="butter" rotation="2deg" className="-top-3 -left-4" />

        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div className="border-2 border-[#ff6b5e] bg-[#ff6b5e]/15 p-3.5 text-[#ff6b5e] font-mono text-xs tracking-wide flex flex-col gap-2">
              <div>
                <span className="font-bold">ERROR:</span> {error}
              </div>
              {existingTeamMatch && (
                <button
                  type="button"
                  onClick={() => handleQuickRejoin(existingTeamMatch)}
                  className="self-start py-1.5 px-3 bg-[#2ee58f] text-[#090c0a] border border-[#090c0a] font-mono font-bold text-xs uppercase shadow-[2px_2px_0_#090c0a] hover:translate-x-0.5 transition-transform"
                >
                  ⚡ REJOIN SQUAD #{existingTeamMatch} NOW
                </button>
              )}
            </div>
          )}

          {mode === 'create' ? (
            <>
              <div>
                <label
                  htmlFor="onboarding-team-name"
                  className="block font-mono text-xs uppercase tracking-wider text-[#e8ece3] mb-1.5"
                >
                  Squad / Team Name
                </label>
                <input
                  id="onboarding-team-name"
                  type="text"
                  required
                  maxLength={64}
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  placeholder="e.g. Zero Gravity"
                  className="w-full bg-[#090c0a] border-2 border-[#2ee58f]/40 focus:border-[#2ee58f] px-3.5 py-2.5 font-mono text-sm text-[#e8ece3] outline-none transition-colors placeholder:text-[#aab5ac]/40"
                />
              </div>

              <div>
                <label className="block font-mono text-xs uppercase tracking-wider text-[#e8ece3] mb-1.5">
                  Target Squad Size
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {[2, 3].map((size) => (
                    <button
                      key={size}
                      type="button"
                      onClick={() => setTargetSize(size)}
                      className={`py-2 px-3 border-2 font-mono text-xs tracking-wider uppercase font-bold transition-all ${
                        targetSize === size
                          ? 'border-[#090c0a] bg-[#2ee58f] text-[#090c0a] shadow-[3px_3px_0_#090c0a]'
                          : 'border-[#aab5ac]/30 bg-[#090c0a] text-[#aab5ac]'
                      }`}
                    >
                      {size} Members
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div>
              <label
                htmlFor="onboarding-team-code"
                className="block font-mono text-xs uppercase tracking-wider text-[#e8ece3] mb-1.5"
              >
                Squad Room Code
              </label>
              <input
                id="onboarding-team-code"
                type="text"
                required
                maxLength={10}
                value={teamCode}
                onChange={(e) => setTeamCode(e.target.value.toUpperCase())}
                placeholder="e.g. ZG-99"
                className="w-full bg-[#090c0a] border-2 border-[#2ee58f]/40 focus:border-[#2ee58f] px-3.5 py-2.5 font-mono text-sm text-[#e8ece3] outline-none uppercase tracking-wider transition-colors placeholder:text-[#aab5ac]/40"
              />
            </div>
          )}

          <div>
            <label
              htmlFor="onboarding-roll-number"
              className="block font-mono text-xs uppercase tracking-wider text-[#e8ece3] mb-1.5"
            >
              Your Roll Number / Student ID
            </label>
            <input
              id="onboarding-roll-number"
              type="text"
              required
              maxLength={32}
              value={rollNumber}
              onChange={(e) => setRollNumber(e.target.value.toUpperCase())}
              placeholder="e.g. CS21045"
              className="w-full bg-[#090c0a] border-2 border-[#2ee58f]/40 focus:border-[#2ee58f] px-3.5 py-2.5 font-mono text-sm text-[#e8ece3] outline-none uppercase tracking-wider transition-colors placeholder:text-[#aab5ac]/40"
            />
          </div>

          <div>
            <label
              htmlFor="onboarding-full-name"
              className="block font-mono text-xs uppercase tracking-wider text-[#e8ece3] mb-1.5"
            >
              Your Full Name
            </label>
            <input
              id="onboarding-full-name"
              type="text"
              required
              maxLength={64}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Rohan Sharma"
              className="w-full bg-[#090c0a] border-2 border-[#2ee58f]/40 focus:border-[#2ee58f] px-3.5 py-2.5 font-mono text-sm text-[#e8ece3] outline-none transition-colors placeholder:text-[#aab5ac]/40"
            />
          </div>

          <div className="pt-2">
            <TactileButton
              type="submit"
              variant={mode === 'create' ? 'amber' : 'signal'}
              disabled={loading}
              className="w-full text-sm py-3.5"
            >
              {loading
                ? 'CONNECTING TO SQUAD...'
                : mode === 'create'
                ? 'CREATE SQUAD & ENTER LOBBY'
                : 'ENTER SQUAD LOBBY'}
            </TactileButton>
          </div>
        </form>
      </div>

      {/* Rules Notice */}
      <div className="mt-6 border-2 border-[#2ee58f]/20 bg-[#0f1411]/60 p-4">
        <p className="font-mono text-xs text-[#2ee58f] font-bold uppercase tracking-wider mb-1">
          RULESET // HIVE PLAY
        </p>
        <p className="font-body text-xs text-[#aab5ac] leading-relaxed">
          • All teammates must toggle "READY" before the 3-2-1 countdown unlocks.<br />
          • Each member solves 15 questions independently on their own screen.<br />
          • Official standing is determined by the team's mathematical average score.
        </p>
      </div>
    </div>
  );
}
