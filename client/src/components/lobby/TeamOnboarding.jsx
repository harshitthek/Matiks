import React, { useState, useEffect, useRef } from 'react';
import { TactileButton } from '../common/TactileButton.jsx';
import { WashiTape } from '../common/WashiTape.jsx';
import { RansomNote } from '../common/RansomNote.jsx';
import {
  createTeam,
  joinTeam,
  getAuthConfig,
  getAuthUser,
  exchangeOidcCode
} from '../../services/api.js';

const OIDC_SESSION_KEY = 'matiks_oidc_session';
const OIDC_DRAFT_KEY = 'matiks_oidc_draft';

function loadInitialState(initialTeamCode) {
  let savedSession = null;
  let draft = null;
  let initialOidcError = null;
  let hasOidcCallback = false;

  try {
    const rawSession = localStorage.getItem(OIDC_SESSION_KEY);
    if (rawSession) {
      savedSession = JSON.parse(rawSession);
    }
  } catch {
    savedSession = null;
  }

  try {
    const draftRaw = sessionStorage.getItem(OIDC_DRAFT_KEY);
    if (draftRaw) {
      draft = JSON.parse(draftRaw);
      sessionStorage.removeItem(OIDC_DRAFT_KEY);
    }
  } catch {
    draft = null;
  }

  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const oidcErr = params.get('error');
    const oidcErrDesc = params.get('error_description');
    if (oidcErr) {
      initialOidcError = `USAR FOSS Club Sign-In declined: ${oidcErrDesc || oidcErr}`;
    } else if (params.get('code') && params.get('state')) {
      hasOidcCallback = true;
    }
  }

  const initialMode = draft?.mode === 'create' || draft?.mode === 'join' ? draft.mode : 'join';
  const initialTeamName = draft?.teamName || '';
  const initialCode = ((initialTeamCode || draft?.teamCode || '').trim()).toUpperCase();
  const initialSize = draft?.targetSize === 2 || draft?.targetSize === 3 ? draft.targetSize : 3;
  const initialRoll = (draft?.rollNumber || savedSession?.user?.rollNumber || '').toUpperCase();
  const initialName = draft?.name || savedSession?.user?.displayName || '';
  const initialOperatorMode =
    draft?.operatorMode === 'sub' || draft?.operatorMode === 'mixed'
      ? draft.operatorMode
      : 'add';

  return {
    savedSession,
    initialMode,
    initialTeamName,
    initialCode,
    initialSize,
    initialRoll,
    initialName,
    initialOperatorMode,
    initialOidcError,
    hasOidcCallback
  };
}

/**
 * Onboarding panel for creating a new squad or joining an existing one,
 * with integrated USAR FOSS Club OIDC (oidc.fossclub.tech) PKCE Single Sign-On.
 */
export function TeamOnboarding({ initialTeamCode = '', onJoinedTeam, onOidcCallbackComplete }) {
  const [init] = useState(() => loadInitialState(initialTeamCode));
  const [mode, setMode] = useState(init.initialMode); // 'join' | 'create'
  const [teamName, setTeamName] = useState(init.initialTeamName);
  const [teamCode, setTeamCode] = useState(init.initialCode);
  const [targetSize, setTargetSize] = useState(init.initialSize);
  const [rollNumber, setRollNumber] = useState(init.initialRoll);
  const [name, setName] = useState(init.initialName);
  const [operatorMode, setOperatorMode] = useState(init.initialOperatorMode); // 'add' | 'sub' | 'mixed'
  const [lockedRoundMode, setLockedRoundMode] = useState(null);
  const [loading, setLoading] = useState(false);
  const [oidcLoading, setOidcLoading] = useState(init.hasOidcCallback);
  const [error, setError] = useState(init.initialOidcError);
  const [existingTeamMatch, setExistingTeamMatch] = useState(null);
  const [oidcSession, setOidcSession] = useState(init.savedSession);
  const onOidcCallbackCompleteRef = useRef(onOidcCallbackComplete);

  useEffect(() => {
    onOidcCallbackCompleteRef.current = onOidcCallbackComplete;
  }, [onOidcCallbackComplete]);

  useEffect(() => {
    let active = true;
    getAuthConfig()
      .then((cfg) => {
        if (!active) return;
        const override = cfg?.roundOperatorMode;
        if (override === 'add' || override === 'sub' || override === 'mixed') {
          setLockedRoundMode(override);
          setOperatorMode(override);
        } else {
          setLockedRoundMode(null);
        }
      })
      .catch(() => {
        // Ignore network errors on config fetch
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    const oidcError = params.get('error');

    if (oidcError) {
      const cleanUrl = window.location.pathname === '/auth/callback' ? '/' : window.location.pathname;
      window.history.replaceState({}, '', cleanUrl);
      onOidcCallbackCompleteRef.current?.(null);
      return;
    }

    if (code && state) {
      const cleanUrl = window.location.pathname === '/auth/callback' ? '/' : window.location.pathname;
      window.history.replaceState({}, '', cleanUrl);

      let authenticatedUser = null;
      exchangeOidcCode(code, state)
        .then((res) => {
          if (res?.user && res?.token) {
            authenticatedUser = res.user;
            const sessionObj = { user: res.user, token: res.token };
            setOidcSession(sessionObj);
            try {
              localStorage.setItem(OIDC_SESSION_KEY, JSON.stringify(sessionObj));
            } catch {
              // Ignore storage quota errors
            }
            if (res.user.rollNumber) {
              setRollNumber((prev) => prev || res.user.rollNumber.toUpperCase());
            }
            if (res.user.displayName) {
              setName((prev) => prev || res.user.displayName);
            }
          }
        })
        .catch((err) => {
          setError(err.message || 'Failed to complete USAR FOSS Club OIDC sign-in.');
        })
        .finally(() => {
          setOidcLoading(false);
          onOidcCallbackCompleteRef.current?.(authenticatedUser);
        });
      return;
    }

    if (init.savedSession?.token) {
      getAuthUser(init.savedSession.token)
        .then((res) => {
          const freshUser = res?.user || res;
          if (freshUser && typeof freshUser === 'object' && freshUser.rollNumber) {
            const updatedSession = { user: freshUser, token: init.savedSession.token };
            setOidcSession(updatedSession);
            try {
              localStorage.setItem(OIDC_SESSION_KEY, JSON.stringify(updatedSession));
            } catch {
              // Ignore storage quota errors
            }
          }
        })
        .catch((err) => {
          if (err?.status === 401) {
            setOidcSession(null);
            try {
              localStorage.removeItem(OIDC_SESSION_KEY);
            } catch {
              // Ignore storage errors
            }
          }
        });
    }
  }, [init.savedSession?.token]);

  const handleStartOidcLogin = async () => {
    setError(null);
    setOidcLoading(true);
    try {
      sessionStorage.setItem(
        OIDC_DRAFT_KEY,
        JSON.stringify({ mode, teamName, teamCode, targetSize, rollNumber, name, operatorMode })
      );
    } catch {
      // Ignore storage errors
    }

    try {
      const cfg = await getAuthConfig(true);
      if (!cfg?.authUrl) {
        throw new Error('OIDC authorization URL is not available on this server.');
      }
      window.location.assign(cfg.authUrl);
    } catch (err) {
      setOidcLoading(false);
      setError(err.message || 'Could not reach USAR FOSS Club OIDC provider.');
    }
  };

  const handleClearOidcSession = () => {
    setOidcSession(null);
    try {
      localStorage.removeItem(OIDC_SESSION_KEY);
    } catch {
      // Ignore storage errors
    }
  };

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

    const activeSessionToken = oidcSession?.token;

    try {
      if (mode === 'create') {
        if (!teamName.trim()) throw new Error('Please enter a squad name.');
        if (!rollNumber.trim()) throw new Error('Please enter your roll number.');
        if (!name.trim()) throw new Error('Please enter your name.');

        const res = await createTeam(
          teamName.trim(),
          targetSize,
          rollNumber.trim(),
          name.trim(),
          activeSessionToken,
          operatorMode
        );
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
        const res = await joinTeam(
          teamCode.trim().toUpperCase(),
          rollNumber.trim(),
          name.trim(),
          savedToken,
          activeSessionToken
        );
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
      const res = await joinTeam(
        targetCode,
        rollNumber.trim(),
        name.trim(),
        savedToken,
        oidcSession?.token
      );
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

        {/* USAR FOSS Club OIDC Identity Bar (oidc.fossclub.tech) */}
        <div className="mb-5 pb-5 border-b-2 border-[#2ee58f]/20">
          {oidcSession?.user ? (
            <div className="border-2 border-[#2ee58f] bg-[#2ee58f]/10 p-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                {oidcSession.user.picture ? (
                  <img
                    src={oidcSession.user.picture}
                    alt={oidcSession.user.displayName}
                    className="w-9 h-9 border-2 border-[#090c0a] shrink-0 object-cover"
                  />
                ) : (
                  <div className="w-9 h-9 bg-[#2ee58f] text-[#090c0a] border-2 border-[#090c0a] font-mono font-bold text-sm flex items-center justify-center shrink-0">
                    {(oidcSession.user.displayName || 'U').slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs font-bold text-[#e8ece3] truncate">
                      {oidcSession.user.displayName}
                    </span>
                    {oidcSession.user.isClubMember ? (
                      <span className="px-1.5 py-0.5 bg-[#ffe36e] text-[#090c0a] border border-[#090c0a] font-mono text-[10px] font-bold uppercase tracking-wider">
                        ★ UFC MEMBER
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 bg-[#2ee58f]/20 text-[#2ee58f] border border-[#2ee58f]/40 font-mono text-[10px] font-bold uppercase tracking-wider">
                        ✓ OIDC VERIFIED
                      </span>
                    )}
                  </div>
                  <p className="font-mono text-[11px] text-[#aab5ac] truncate">
                    {oidcSession.user.githubUsername
                      ? `@${oidcSession.user.githubUsername} // oidc.fossclub.tech`
                      : 'Verified via oidc.fossclub.tech'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleClearOidcSession}
                className="px-2.5 py-1 bg-[#090c0a] text-[#aab5ac] hover:text-[#ff6b5e] border border-[#aab5ac]/30 hover:border-[#ff6b5e] font-mono text-[10px] uppercase tracking-wider transition-colors shrink-0"
              >
                SIGN OUT
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={handleStartOidcLogin}
                disabled={oidcLoading || loading}
                className="w-full py-2.5 px-4 bg-[#0f1411] hover:bg-[#2ee58f]/15 text-[#2ee58f] border-2 border-[#2ee58f] shadow-[3px_3px_0_#090c0a] font-mono font-bold text-xs tracking-wider uppercase flex items-center justify-center gap-2 transition-all hover:-translate-y-0.5 disabled:opacity-50"
              >
                <span>⚡</span>
                <span>
                  {oidcLoading
                    ? 'VERIFYING WITH OIDC.FOSSCLUB.TECH...'
                    : 'SIGN IN WITH USAR FOSS CLUB (OIDC)'}
                </span>
              </button>
              <p className="font-mono text-[10px] text-[#aab5ac] text-center uppercase tracking-wider">
                ONE-CLICK GITHUB SSO VIA OIDC.FOSSCLUB.TECH (UNLOCKS ★ UFC BADGE) OR ENTER DETAILS BELOW
              </p>
            </div>
          )}
        </div>

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

              <div>
                <label className="block font-mono text-xs uppercase tracking-wider text-[#e8ece3] mb-1.5">
                  Arithmetic Mode{' '}
                  {lockedRoundMode && (
                    <span className="text-[10px] text-[#ffe36e] ml-1">
                      (LOCKED BY ORGANIZER)
                    </span>
                  )}
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'add', label: '+ ADD', title: 'Addition (15 questions)' },
                    { id: 'sub', label: '- SUB', title: 'Subtraction (15 questions)' },
                    { id: 'mixed', label: '± MIXED', title: 'Mixed (8 Add + 7 Sub)' }
                  ].map((m) => {
                    const effectiveMode = lockedRoundMode || operatorMode;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        disabled={Boolean(lockedRoundMode)}
                        onClick={() => !lockedRoundMode && setOperatorMode(m.id)}
                        className={`py-2 px-2 border-2 font-mono text-xs tracking-wider uppercase font-bold transition-all ${
                          effectiveMode === m.id
                            ? 'border-[#090c0a] bg-[#2ee58f] text-[#090c0a] shadow-[3px_3px_0_#090c0a]'
                            : 'border-[#aab5ac]/30 bg-[#090c0a] text-[#aab5ac]'
                        } ${lockedRoundMode ? 'opacity-75 cursor-not-allowed' : 'cursor-pointer'}`}
                        title={m.title}
                      >
                        {m.label}
                      </button>
                    );
                  })}
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
              disabled={loading || oidcLoading}
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
