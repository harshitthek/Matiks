import React, { useState, useEffect, useRef } from 'react';
import { TactileButton } from '../common/TactileButton.jsx';
import { WashiTape } from '../common/WashiTape.jsx';
import { RansomNote } from '../common/RansomNote.jsx';
import { FlowerSticker } from '../common/FlowerSticker.jsx';
import { FossForgeBadge } from '../common/FossForgeBadge.jsx';
import {
  createTeam,
  joinTeam,
  leaveTeam,
  getAuthConfig,
  getAuthUser,
  exchangeOidcCode,
  getPublicRoster,
  checkinByEmail
} from '../../services/api.js';
import { connectLeaderboardStream } from '../../services/sse.js';

const OIDC_SESSION_KEY = 'matiks_oidc_session';
const OIDC_DRAFT_KEY = 'matiks_oidc_draft';

const inFlightExchanges = new Map();
const processedCodes = new Set();

function saveOidcState(state) {
  if (!state || typeof window === 'undefined') return;
  const payload = JSON.stringify({ state, savedAt: Date.now() });
  try {
    sessionStorage.setItem('matiks_oidc_state', state);
  } catch {
    // Ignore storage quota
  }
  try {
    localStorage.setItem('matiks_oidc_state', payload);
  } catch {
    // Ignore storage quota
  }
}

function getSavedOidcState() {
  if (typeof window === 'undefined') return null;
  try {
    const sessionState = sessionStorage.getItem('matiks_oidc_state');
    if (sessionState && sessionState.trim()) return sessionState.trim();
  } catch {
    // Ignore
  }
  try {
    const rawLocal = localStorage.getItem('matiks_oidc_state');
    if (rawLocal) {
      if (rawLocal.startsWith('{')) {
        const parsed = JSON.parse(rawLocal);
        if (parsed?.state && Date.now() - (parsed.savedAt || 0) < 15 * 60 * 1000) {
          return parsed.state.trim();
        }
      } else if (rawLocal.trim()) {
        return rawLocal.trim();
      }
    }
  } catch {
    // Ignore
  }
  return null;
}

function clearSavedOidcState() {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem('matiks_oidc_state');
    localStorage.removeItem('matiks_oidc_state');
  } catch {
    // Ignore
  }
}

function readStoredInviteCode() {
  if (typeof window === 'undefined') return '';
  const storages = [window.sessionStorage, window.localStorage];
  for (const s of storages) {
    if (!s) continue;
    try {
      const raw = s.getItem('matiks_pending_invite_code');
      if (!raw) continue;
      if (raw.startsWith('{')) {
        const parsed = JSON.parse(raw);
        if (parsed?.code && typeof parsed.expiresAt === 'number') {
          if (Date.now() < parsed.expiresAt) {
            return parsed.code.trim().toUpperCase();
          }
          s.removeItem('matiks_pending_invite_code');
        }
      } else if (raw.trim()) {
        return raw.trim().toUpperCase();
      }
    } catch {
      // Storage unavailable
    }
  }
  return '';
}

function persistInviteCode(code) {
  if (typeof window === 'undefined') return;
  const trimmed = (code || '').trim().toUpperCase();
  if (!trimmed) return;
  const payload = JSON.stringify({ code: trimmed, expiresAt: Date.now() + 15 * 60 * 1000 });
  try { window.sessionStorage?.setItem('matiks_pending_invite_code', payload); } catch {}
  try { window.localStorage?.setItem('matiks_pending_invite_code', payload); } catch {}
}

function clearStoredInviteCode() {
  if (typeof window === 'undefined') return;
  try { window.sessionStorage?.removeItem('matiks_pending_invite_code'); } catch {}
  try { window.localStorage?.removeItem('matiks_pending_invite_code'); } catch {}
}

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

  let pendingInviteCode = readStoredInviteCode();

  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const queryTeam = params.get('team');
    if (queryTeam && queryTeam.trim()) {
      pendingInviteCode = queryTeam.trim().toUpperCase();
      persistInviteCode(pendingInviteCode);
    }
    const oidcErr = params.get('error');
    const oidcErrDesc = params.get('error_description');
    if (oidcErr) {
      initialOidcError = `USAR FOSS Club Sign-In declined: ${oidcErrDesc || oidcErr}`;
    } else if (params.get('code') && params.get('state')) {
      hasOidcCallback = true;
    }
  }

  const initialCode = ((initialTeamCode || draft?.teamCode || pendingInviteCode || '').trim()).toUpperCase();
  const initialMode = initialCode ? 'join' : (draft?.mode === 'create' || draft?.mode === 'join' ? draft.mode : 'join');
  const initialTeamName = draft?.teamName || '';
  const initialSize = [1, 2, 3, 4].includes(draft?.targetSize) ? draft.targetSize : 3;
  const initialRoll = (draft?.rollNumber || savedSession?.user?.rollNumber || '').toUpperCase();
  const initialName = draft?.name || savedSession?.user?.displayName || '';
  const initialOperatorMode = 'add';

  if (initialCode) {
    persistInviteCode(initialCode);
  }

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
 * with mandatory USAR FOSS Club OIDC (oidc.fossclub.tech) authentication gate,
 * zero manual roll-number/name typing, and organizer emergency walk-in fallback.
 */
export function TeamOnboarding({ initialTeamCode = '', onJoinedTeam, onOidcCallbackComplete, onNavigateToAdmin }) {
  const [init] = useState(() => loadInitialState(initialTeamCode));
  const [mode, setMode] = useState(init.initialMode); // 'join' | 'create'
  const [teamName, setTeamName] = useState(init.initialTeamName);
  const [teamCode, setTeamCode] = useState(init.initialCode);
  const [targetSize, setTargetSize] = useState(init.initialSize);
  const [rollNumber, setRollNumber] = useState(init.initialRoll);
  const [name, setName] = useState(init.initialName);
  const [operatorMode, setOperatorMode] = useState(init.initialOperatorMode); // Defaults to 'add'
  const [lockedRoundMode, setLockedRoundMode] = useState(null);
  const [windowOpen, setWindowOpen] = useState(false);
  const [emergencyWalkIn, setEmergencyWalkIn] = useState(false);
  const [showEmergencyWalkInForm, setShowEmergencyWalkInForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [oidcLoading, setOidcLoading] = useState(init.hasOidcCallback);
  const [error, setError] = useState(init.initialOidcError);
  const [existingTeamMatch, setExistingTeamMatch] = useState(null);
  const [oidcSession, setOidcSession] = useState(init.savedSession);
  const [hasActiveRoster, setHasActiveRoster] = useState(false);
  const [rosterTeams, setRosterTeams] = useState([]);
  const [emailInput, setEmailInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [checkinLoading, setCheckinLoading] = useState(false);
  const onOidcCallbackCompleteRef = useRef(onOidcCallbackComplete);
  const hasStreamUpdateRef = useRef(false);

  useEffect(() => {
    let active = true;
    getPublicRoster()
      .then((data) => {
        if (!active) return;
        if (Array.isArray(data?.teams)) {
          setRosterTeams(data.teams);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    onOidcCallbackCompleteRef.current = onOidcCallbackComplete;
  }, [onOidcCallbackComplete]);

  useEffect(() => {
    let active = true;
    getAuthConfig()
      .then((cfg) => {
        if (!active) return;
        if (typeof cfg?.hasActiveRoster === 'boolean') {
          setHasActiveRoster(cfg.hasActiveRoster);
        }
        if (typeof cfg?.emergencyWalkIn === 'boolean') {
          setEmergencyWalkIn(cfg.emergencyWalkIn);
        }
        if (!hasStreamUpdateRef.current) {
          if (typeof cfg?.windowOpen === 'boolean') {
            setWindowOpen(cfg.windowOpen);
          } else if (typeof cfg?.contestWindow?.isOpen === 'boolean') {
            setWindowOpen(cfg.contestWindow.isOpen);
          }
        }
        const override = cfg?.roundOperatorMode;
        if (override === 'add' || override === 'sub' || override === 'mixed') {
          setLockedRoundMode(override);
          setOperatorMode(override);
        } else {
          setLockedRoundMode(null);
          setOperatorMode('add');
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
    const stream = connectLeaderboardStream({
      onWindowStatus: (status) => {
        hasStreamUpdateRef.current = true;
        if (typeof status?.isOpen === 'boolean') {
          setWindowOpen(status.isOpen);
        }
      }
    });
    return () => {
      stream?.close?.();
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
      clearSavedOidcState();
      onOidcCallbackCompleteRef.current?.(null);
      return;
    }

    if (code && state) {
      const cleanUrl = window.location.pathname === '/auth/callback' ? '/' : window.location.pathname;
      window.history.replaceState({}, '', cleanUrl);

      if (processedCodes.has(code)) {
        return;
      }

      const savedState = getSavedOidcState();
      if (!savedState) {
        setOidcLoading(false);
        setError('Sign-in session expired or was not initiated in this browser. Please try signing in again.');
        onOidcCallbackCompleteRef.current?.(null);
        return;
      }

      if (savedState !== state) {
        setOidcLoading(false);
        setError('OIDC state verification failed. Please try signing in again.');
        clearSavedOidcState();
        onOidcCallbackCompleteRef.current?.(null);
        return;
      }

      let exchangePromise = inFlightExchanges.get(code);
      if (!exchangePromise) {
        exchangePromise = exchangeOidcCode(code, state, savedState);
        inFlightExchanges.set(code, exchangePromise);
      }

      setOidcLoading(true);

      exchangePromise
        .then((res) => {
          inFlightExchanges.delete(code);
          processedCodes.add(code);
          clearSavedOidcState();

          if (res?.user && res?.token) {
            const sessionObj = { user: res.user, token: res.token };
            setOidcSession(sessionObj);
            try {
              localStorage.setItem(OIDC_SESSION_KEY, JSON.stringify(sessionObj));
            } catch {
              // Ignore storage quota errors
            }
            if (res.user.rollNumber) {
              setRollNumber(res.user.rollNumber.toUpperCase());
            }
            if (res.user.displayName) {
              setName(res.user.displayName);
            }
            const pending = readStoredInviteCode();
            if (pending) {
              setTeamCode(pending);
              setMode('join');
            }
            onOidcCallbackCompleteRef.current?.(res.user);
          } else {
            onOidcCallbackCompleteRef.current?.(null);
          }
        })
        .catch((err) => {
          inFlightExchanges.delete(code);
          setError(err.message || 'Failed to complete USAR FOSS Club OIDC sign-in.');
          onOidcCallbackCompleteRef.current?.(null);
        })
        .finally(() => {
          setOidcLoading(false);
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
            if (freshUser.rollNumber) {
              setRollNumber(freshUser.rollNumber.toUpperCase());
            }
            if (freshUser.displayName) {
              setName(freshUser.displayName);
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

  const handleEmailCheckin = async (e) => {
    if (e) e.preventDefault();
    const effectiveEmail = emailInput.trim() || oidcSession?.user?.email || '';
    const cleanEmail = effectiveEmail.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setError('Please enter a valid registered email address.');
      return;
    }
    setError(null);
    setCheckinLoading(true);

    try {
      const res = await checkinByEmail(cleanEmail, nameInput.trim() || undefined);
      if (res?.success && res?.teamCode && res?.memberToken) {
        saveTokenForRoll(res.rollNumber, res.memberToken);
        clearStoredInviteCode();

        onJoinedTeam({
          teamCode: res.teamCode,
          teamName: res.teamName,
          memberToken: res.memberToken,
          rollNumber: res.rollNumber,
          name: res.name,
          isCaptain: res.isCaptain,
          targetSize: res.targetSize
        });
      } else {
        setError(res?.message || 'Check-in failed. Please verify your email is in the registered competition roster.');
      }
    } catch (err) {
      setError(err.message || 'Check-in failed. Please verify your email is in the registered competition roster.');
    } finally {
      setCheckinLoading(false);
    }
  };

  const handleStartOidcLogin = async () => {
    setError(null);
    setOidcLoading(true);
    const targetCode = (teamCode || initialTeamCode || '').trim().toUpperCase();
    if (targetCode) {
      persistInviteCode(targetCode);
    }

    try {
      sessionStorage.setItem(
        OIDC_DRAFT_KEY,
        JSON.stringify({ mode, teamName, teamCode: targetCode, targetSize, operatorMode })
      );
    } catch {
      // Ignore storage errors
    }

    try {
      const cfg = await getAuthConfig(true);
      if (!cfg?.authUrl) {
        throw new Error('OIDC authorization URL is not available on this server.');
      }
      if (cfg.state) {
        saveOidcState(cfg.state);
      }
      window.location.assign(cfg.authUrl);
    } catch (err) {
      setOidcLoading(false);
      setError(err.message || 'Could not reach USAR FOSS Club OIDC provider.');
    }
  };

  const handleClearOidcSession = () => {
    setOidcSession(null);
    setShowEmergencyWalkInForm(false);
    clearSavedOidcState();
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
    const finalRoll = (oidcSession?.user?.rollNumber || rollNumber || '').trim().toUpperCase();
    const finalName = (oidcSession?.user?.displayName || name || '').trim();

    try {
      if (!finalRoll) {
        throw new Error('Student roll number could not be determined. Please sign in with USAR FOSS Club.');
      }
      if (!finalName) {
        throw new Error('Student name could not be determined. Please sign in with USAR FOSS Club.');
      }

      if (mode === 'create') {
        if (!teamName.trim()) throw new Error('Please enter a squad name.');

        const res = await createTeam(
          teamName.trim(),
          targetSize,
          finalRoll,
          finalName,
          activeSessionToken,
          operatorMode
        );
        clearStoredInviteCode();
        onJoinedTeam({
          teamCode: res.teamCode,
          memberToken: res.memberToken,
          rollNumber: finalRoll,
          name: finalName,
          isCaptain: true
        });
      } else {
        if (!teamCode.trim()) throw new Error('Please enter the squad code (e.g. ZG-99).');

        const savedToken = getSavedTokenForRoll(finalRoll);
        const res = await joinTeam(
          teamCode.trim().toUpperCase(),
          finalRoll,
          finalName,
          savedToken,
          activeSessionToken
        );
        clearStoredInviteCode();
        onJoinedTeam({
          teamCode: teamCode.trim().toUpperCase(),
          memberToken: res.memberToken,
          rollNumber: finalRoll,
          name: finalName,
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
    const finalRoll = (oidcSession?.user?.rollNumber || rollNumber || '').trim().toUpperCase();
    const finalName = (oidcSession?.user?.displayName || name || '').trim();
    if (!finalRoll || !finalName) return;

    setLoading(true);
    try {
      const savedToken = getSavedTokenForRoll(finalRoll);
      const res = await joinTeam(
        targetCode,
        finalRoll,
        finalName,
        savedToken,
        oidcSession?.token
      );
      clearStoredInviteCode();
      onJoinedTeam({
        teamCode: targetCode,
        memberToken: res.memberToken,
        rollNumber: finalRoll,
        name: finalName,
        isCaptain: res.member?.isCaptain ?? false
      });
    } catch (err) {
      setError(err.message || 'Failed to rejoin squad.');
    } finally {
      setLoading(false);
    }
  };

  const handleSwitchSquad = async (oldTeamCode, newTeamCode) => {
    setError(null);
    setLoading(true);
    const finalRoll = (oidcSession?.user?.rollNumber || rollNumber || '').trim().toUpperCase();
    const finalName = (oidcSession?.user?.displayName || name || '').trim();

    try {
      const savedToken = getSavedTokenForRoll(finalRoll);
      try {
        await leaveTeam(oldTeamCode, finalRoll, savedToken);
      } catch {
        // If leave fails on server (e.g. room already dissolved), continue trying to join
      }
      setExistingTeamMatch(null);
      if (mode === 'create') {
        const res = await createTeam(
          teamName.trim(),
          targetSize,
          finalRoll,
          finalName,
          oidcSession?.token,
          operatorMode
        );
        clearStoredInviteCode();
        onJoinedTeam({
          teamCode: res.teamCode,
          memberToken: res.memberToken,
          rollNumber: finalRoll,
          name: finalName,
          isCaptain: true
        });
      } else {
        const res = await joinTeam(
          newTeamCode,
          finalRoll,
          finalName,
          undefined,
          oidcSession?.token
        );
        clearStoredInviteCode();
        onJoinedTeam({
          teamCode: newTeamCode,
          memberToken: res.memberToken,
          rollNumber: finalRoll,
          name: finalName,
          isCaptain: res.member?.isCaptain ?? false
        });
      }
    } catch (err) {
      setError(err.message || 'Failed to switch squad.');
    } finally {
      setLoading(false);
    }
  };

  const isAuthenticated = Boolean(oidcSession?.user);
  const isEmergencyDirectMode = !isAuthenticated && emergencyWalkIn && showEmergencyWalkInForm;

  return (
    <div className="w-full max-w-xl mx-auto px-4 py-8">
      {/* Hero Header with UFC & FOSS Forge Elements */}
      <div className="text-center mb-8 relative">
        <FlowerSticker
          id={4}
          size={52}
          rotation={-14}
          withTape
          tapeColor="butter"
          className="hidden sm:inline-block absolute -left-10 top-0 z-10"
        />
        <FlowerSticker
          id={11}
          size={48}
          rotation={12}
          withTape
          tapeColor="pink"
          className="hidden sm:inline-block absolute -right-10 top-4 z-10"
        />

        <div className="mb-3">
          <FossForgeBadge variant="hero" />
        </div>

        <div className="inline-block relative mt-2">
          <WashiTape color="pink" rotation="-4deg" className="-top-3 -right-6" />
          <RansomNote text="MATIKS" size="xl" />
        </div>
        <p className="font-mono text-xs sm:text-sm tracking-widest text-[#2ee58f] mt-3 uppercase font-bold">
          § SPEED MATH SPRINT // 120s REFLEX CHALLENGE
        </p>
        <p className="font-body text-xs sm:text-sm text-[#aab5ac] mt-1 max-w-md mx-auto">
          Synchronized 2-minute sprint. 15 calibrated arithmetic questions. Team score is the average.
        </p>
      </div>

      {/* Main Container Card */}
      <div className="cyber-card p-6 md:p-8 relative">
        <WashiTape color="butter" rotation="2deg" className="-top-3 -left-4" />

        {/* ==================================================================== */}
        {/* CASE 1: UN-AUTHENTICATED FRONT GATE (USAR FOSS CLUB OIDC GATEKEEPER) */}
        {/* ==================================================================== */}
        {!isAuthenticated && !isEmergencyDirectMode && (
          <div className="space-y-6">
            {error && (
              <div className="border-2 border-[#ff6b5e] bg-[#ff6b5e]/15 p-3.5 text-[#ff6b5e] font-mono text-xs tracking-wide">
                <span className="font-bold">ERROR:</span> {error}
              </div>
            )}

            {/* Contest Window Status Banner */}
            <div
              className={`p-3 border-2 font-mono text-xs flex items-center justify-between gap-2 transition-all ${
                windowOpen
                  ? 'border-[#2ee58f]/40 bg-[#2ee58f]/10 text-[#2ee58f]'
                  : 'border-[#f5a623] bg-[#f5a623]/10 text-[#f5a623]'
              }`}
            >
              <div className="flex items-center gap-2 font-bold tracking-wider uppercase">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    windowOpen ? 'bg-[#2ee58f] animate-pulse' : 'bg-[#f5a623]'
                  }`}
                />
                <span>
                  {windowOpen
                    ? 'CONTEST WINDOW OPEN // READY TO RACE'
                    : 'CONTEST WINDOW CLOSED // AWAITING ORGANIZER'}
                </span>
              </div>
              <span className="text-[11px] text-[#aab5ac] hidden sm:inline">
                {windowOpen ? 'Sprint round active' : 'Waiting for organizer to open sprint'}
              </span>
            </div>

            {/* Organizer Emergency Walk-In Ribbon (Phase 4 Safety Valve) */}
            {emergencyWalkIn && (
              <div className="border-2 border-[#f5a623] bg-[#f5a623]/15 p-3 flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex items-center gap-2">
                  <span className="animate-pulse text-base">⚠️</span>
                  <span className="font-mono text-xs text-[#ffe36e] font-bold">
                    ORGANIZER EMERGENCY WALK-IN ACTIVE
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowEmergencyWalkInForm(true)}
                  className="px-2.5 py-1 bg-[#f5a623] hover:bg-[#ffb738] text-[#090c0a] font-mono font-bold text-xs uppercase shadow-[2px_2px_0_#090c0a] cursor-pointer"
                >
                  DIRECT MANUAL ENTRY ➔
                </button>
              </div>
            )}

            {/* Squad Invitation Callout (when arrived via QR scan or ?team=CODE) */}
            {teamCode && (
              <div className="border-2 border-[#ffe36e] bg-[#ffe36e]/10 p-5 relative text-left">
                <WashiTape color="butter" rotation="-1.5deg" className="-top-3 left-6" />
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className="font-mono text-[10px] font-black px-2 py-0.5 bg-[#ffe36e] text-[#090c0a] uppercase tracking-wider">
                    INVITATION RECEIVED
                  </span>
                  <span className="font-mono text-xs font-bold text-[#ffe36e] uppercase tracking-wider">
                    SQUAD #{teamCode}
                  </span>
                </div>
                <h3 className="font-display font-black text-lg sm:text-xl text-[#e8ece3] tracking-tight">
                  YOU'VE BEEN INVITED TO JOIN SQUAD #{teamCode}
                </h3>
                <p className="font-body text-xs text-[#aab5ac] mt-1.5 leading-relaxed">
                  Enter your registered team email below to join your squad for the 120s combat sprint.
                </p>
              </div>
            )}

            {/* Event Roster Email Check-In (Primary Entry Gate) */}
            <div className="border-2 border-[#2ee58f] bg-[#090c0a] p-5 relative text-left">
              <WashiTape color="signal" rotation="-1.5deg" className="-top-3 left-6" />
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <span className="font-mono text-xs font-black text-[#2ee58f] uppercase tracking-wider">
                  § 01 // ENTER REGISTERED EMAIL
                </span>
                <span className="font-mono text-[10px] bg-[#2ee58f]/15 text-[#2ee58f] border border-[#2ee58f]/30 px-2 py-0.5 uppercase font-bold">
                  AUTOMATIC SQUAD LINK
                </span>
              </div>
              <p className="font-body text-xs text-[#aab5ac] mb-4">
                Enter the email address you registered with. Your squad and teammates will load automatically.
              </p>
              <form onSubmit={handleEmailCheckin} className="space-y-3">
                <div>
                  <label htmlFor="roster-email-input" className="block font-mono text-[11px] text-[#ffe36e] uppercase font-bold mb-1">
                    REGISTERED EMAIL ADDRESS *
                  </label>
                  <input
                    id="roster-email-input"
                    type="email"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder="e.g. participant@example.com"
                    className="w-full bg-[#0f1411] border-2 border-white/20 focus:border-[#2ee58f] p-3 text-sm font-mono text-[#e8ece3] outline-none transition-colors"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="roster-name-input" className="block font-mono text-[11px] text-[#aab5ac] uppercase font-bold mb-1">
                    DISPLAY NAME (OPTIONAL)
                  </label>
                  <input
                    id="roster-name-input"
                    type="text"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    placeholder="Auto-derived from roster if blank"
                    className="w-full bg-[#0f1411] border-2 border-white/20 focus:border-[#2ee58f] p-3 text-sm font-mono text-[#e8ece3] outline-none transition-colors"
                  />
                </div>
                <button
                  type="submit"
                  disabled={checkinLoading}
                  className="w-full py-3.5 px-6 bg-[#2ee58f] hover:bg-[#3bf59e] text-[#090c0a] font-mono font-black text-sm tracking-wider uppercase border-2 border-[#090c0a] shadow-[4px_4px_0_#090c0a] flex items-center justify-center gap-2 transition-all hover:-translate-y-0.5 cursor-pointer disabled:opacity-50 mt-2"
                >
                  <span>{checkinLoading ? 'CHECKING IN...' : 'ENTER SQUAD ARENA ➔'}</span>
                </button>
              </form>
            </div>

            {/* Pre-Registered Squads Showcase (Only Team Names) */}
            {rosterTeams.length > 0 && (
              <div className="border-2 border-white/10 bg-[#0f1411] p-4 text-left">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <span className="font-mono text-xs font-bold text-[#ffe36e] uppercase tracking-wider">
                    REGISTERED SQUADS ({rosterTeams.length} TEAMS)
                  </span>
                  <span className="font-mono text-[10px] text-[#aab5ac]">
                    Only registered teams can compete
                  </span>
                </div>
                <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
                  {rosterTeams.map((team) => (
                    <div
                      key={team.teamCode}
                      className="flex items-center justify-between p-2.5 bg-[#090c0a] border border-white/10 hover:border-[#2ee58f]/40 transition-all text-xs"
                    >
                      <div className="flex items-center gap-2 font-mono">
                        <span className="w-2 h-2 rounded-full bg-[#2ee58f]" />
                        <span className="font-bold text-[#e8ece3]">{team.teamName}</span>
                      </div>
                      <div className="flex items-center gap-2 font-mono text-[11px]">
                        <span className="text-[#aab5ac]">
                          {team.checkedInCount}/{team.targetSize} READY
                        </span>
                        <span
                          className={`px-1.5 py-0.5 border text-[10px] font-bold uppercase ${
                            team.checkedInCount >= team.targetSize
                              ? 'border-[#2ee58f] text-[#2ee58f] bg-[#2ee58f]/10'
                              : 'border-[#f5a623] text-[#f5a623] bg-[#f5a623]/10'
                          }`}
                        >
                          {team.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Secondary OIDC Login Option */}
            <div className="text-center pt-2">
              <button
                type="button"
                onClick={handleStartOidcLogin}
                disabled={oidcLoading}
                className="font-mono text-xs text-[#aab5ac] hover:text-[#2ee58f] underline underline-offset-4 transition-colors cursor-pointer"
              >
                {oidcLoading ? 'CONNECTING TO OIDC...' : 'Or sign in via USAR FOSS Club OIDC SSO'}
              </button>
            </div>

            {/* 3 Core Architectural Pillars */}
            <div className="pt-4 border-t-2 border-[#2ee58f]/20 grid grid-cols-1 sm:grid-cols-3 gap-3 text-left">
              <div className="p-3 bg-[#090c0a] border border-[#2ee58f]/30">
                <span className="font-mono text-[11px] font-bold text-[#2ee58f] block uppercase mb-1">
                  ✓ ZERO CODE TYPING
                </span>
                <p className="font-body text-xs text-[#aab5ac] leading-relaxed">
                  Enter your email; the engine matches your squad and teammates automatically.
                </p>
              </div>
              <div className="p-3 bg-[#090c0a] border border-[#2ee58f]/30">
                <span className="font-mono text-[11px] font-bold text-[#2ee58f] block uppercase mb-1">
                  📋 PRE-REGISTERED SQUADS
                </span>
                <p className="font-body text-xs text-[#aab5ac] leading-relaxed">
                  Only pre-registered teams and emails can join the competition arena.
                </p>
              </div>
              <div className="p-3 bg-[#090c0a] border border-[#2ee58f]/30">
                <span className="font-mono text-[11px] font-bold text-[#2ee58f] block uppercase mb-1">
                  ⚡ 120s REFLEX SPRINT
                </span>
                <p className="font-body text-xs text-[#aab5ac] leading-relaxed">
                  When all squad members toggle READY, the synchronized 3-2-1 countdown triggers.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ==================================================================== */}
        {/* CASE 2: ORGANIZER EMERGENCY WALK-IN BYPASS (DIRECT MANUAL ENTRY)     */}
        {/* ==================================================================== */}
        {isEmergencyDirectMode && (
          <div className="space-y-5">
            <div className="border-2 border-[#f5a623] bg-[#f5a623]/15 p-3 flex items-center justify-between gap-3">
              <div>
                <span className="font-mono text-xs font-bold text-[#ffe36e] uppercase block">
                  ⚠️ ORGANIZER EMERGENCY WALK-IN ACTIVE
                </span>
                <span className="font-mono text-[11px] text-[#aab5ac]">
                  Direct roll-number entry temporarily enabled by event organizers.
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowEmergencyWalkInForm(false)}
                className="px-2 py-1 bg-[#090c0a] text-[#aab5ac] hover:text-[#e8ece3] border border-white/20 font-mono text-[10px] uppercase tracking-wider shrink-0 cursor-pointer"
              >
                ← RETURN TO OIDC GATE
              </button>
            </div>

            {/* Mode Switcher Tabs */}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setMode('join'); setError(null); }}
                className={`flex-1 py-2.5 px-3 font-mono font-bold text-xs tracking-wider uppercase border-2 transition-all cursor-pointer ${
                  mode === 'join'
                    ? 'bg-[#2ee58f] text-[#090c0a] border-[#090c0a] shadow-[3px_3px_0_#090c0a]'
                    : 'bg-[#0f1411] text-[#aab5ac] border-[#2ee58f]/20 hover:border-[#2ee58f]/50'
                }`}
              >
                JOIN EXISTING SQUAD
              </button>
              <button
                type="button"
                onClick={() => { setMode('create'); setError(null); }}
                className={`flex-1 py-2.5 px-3 font-mono font-bold text-xs tracking-wider uppercase border-2 transition-all cursor-pointer ${
                  mode === 'create'
                    ? 'bg-[#ffe36e] text-[#090c0a] border-[#090c0a] shadow-[3px_3px_0_#090c0a]'
                    : 'bg-[#0f1411] text-[#aab5ac] border-[#ffe36e]/20 hover:border-[#ffe36e]/50'
                }`}
              >
                CREATE NEW SQUAD
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="border-2 border-[#ff6b5e] bg-[#ff6b5e]/15 p-3 text-[#ff6b5e] font-mono text-xs">
                  <span className="font-bold">ERROR:</span> {error}
                </div>
              )}

              {mode === 'create' ? (
                <>
                  <div>
                    <label htmlFor="walkin-team-name" className="block font-mono text-xs uppercase text-[#e8ece3] mb-1">
                      Squad / Team Name
                    </label>
                    <input
                      id="walkin-team-name"
                      type="text"
                      required
                      maxLength={64}
                      value={teamName}
                      onChange={(e) => setTeamName(e.target.value)}
                      placeholder="e.g. Zero Gravity"
                      className="w-full bg-[#090c0a] border-2 border-[#2ee58f]/40 px-3 py-2 font-mono text-sm text-[#e8ece3] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block font-mono text-xs uppercase text-[#e8ece3] mb-1">
                      Target Squad Size
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {[
                        { size: 1, label: '1 // SOLO' },
                        { size: 2, label: '2 // DUO' },
                        { size: 3, label: '3 // TRIO' },
                        { size: 4, label: '4 // SQUAD' }
                      ].map(({ size, label }) => (
                        <button
                          key={size}
                          type="button"
                          onClick={() => setTargetSize(size)}
                          className={`py-1.5 px-2 border-2 font-mono text-xs uppercase font-bold cursor-pointer ${
                            targetSize === size
                              ? 'border-[#090c0a] bg-[#2ee58f] text-[#090c0a] shadow-[2px_2px_0_#090c0a]'
                              : 'border-[#aab5ac]/30 bg-[#090c0a] text-[#aab5ac]'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div>
                  <label htmlFor="walkin-team-code" className="block font-mono text-xs uppercase text-[#e8ece3] mb-1">
                    Squad Room Code
                  </label>
                  <input
                    id="walkin-team-code"
                    type="text"
                    required
                    maxLength={10}
                    value={teamCode}
                    onChange={(e) => setTeamCode(e.target.value.toUpperCase())}
                    placeholder="e.g. ZG-99"
                    className="w-full bg-[#090c0a] border-2 border-[#2ee58f]/40 px-3 py-2 font-mono text-sm text-[#e8ece3] outline-none uppercase"
                  />
                </div>
              )}

              <div>
                <label htmlFor="walkin-roll-number" className="block font-mono text-xs uppercase text-[#e8ece3] mb-1">
                  Your Roll Number / Student ID
                </label>
                <input
                  id="walkin-roll-number"
                  type="text"
                  required
                  maxLength={32}
                  value={rollNumber}
                  onChange={(e) => setRollNumber(e.target.value.toUpperCase())}
                  placeholder="e.g. CS21045"
                  className="w-full bg-[#090c0a] border-2 border-[#2ee58f]/40 px-3 py-2 font-mono text-sm text-[#e8ece3] outline-none uppercase"
                />
              </div>

              <div>
                <label htmlFor="walkin-full-name" className="block font-mono text-xs uppercase text-[#e8ece3] mb-1">
                  Your Full Name
                </label>
                <input
                  id="walkin-full-name"
                  type="text"
                  required
                  maxLength={64}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Rohan Sharma"
                  className="w-full bg-[#090c0a] border-2 border-[#2ee58f]/40 px-3 py-2 font-mono text-sm text-[#e8ece3] outline-none"
                />
              </div>

              <TactileButton
                type="submit"
                variant={mode === 'create' ? 'amber' : 'signal'}
                disabled={loading}
                className="w-full text-sm py-3"
              >
                {loading ? 'CONNECTING...' : mode === 'create' ? 'CREATE SQUAD ➔' : 'ENTER LOBBY ➔'}
              </TactileButton>
            </form>
          </div>
        )}

        {/* ==================================================================== */}
        {/* CASE 3: AUTHENTICATED SQUAD ACTIONS (ZERO ROLL/NAME TYPING REQUIRED) */}
        {/* ==================================================================== */}
        {isAuthenticated && (
          <div className="space-y-6">
            {/* Verified UFC Identity Profile Card */}
            <div className="border-2 border-[#2ee58f] bg-[#2ee58f]/10 p-3.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                {oidcSession?.user?.picture ? (
                  <img
                    src={oidcSession.user.picture}
                    alt={oidcSession?.user?.displayName || 'Participant'}
                    className="w-10 h-10 border-2 border-[#090c0a] shrink-0 object-cover"
                  />
                ) : (
                  <div className="w-10 h-10 bg-[#2ee58f] text-[#090c0a] border-2 border-[#090c0a] font-mono font-black text-base flex items-center justify-center shrink-0">
                    {((oidcSession?.user?.displayName || 'U')).slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm font-black text-[#e8ece3] truncate">
                      {oidcSession?.user?.displayName || 'Verified Participant'}
                    </span>
                    {(oidcSession?.user?.is_admin || oidcSession?.user?.isAdmin || oidcSession?.user?.role === 'admin') ? (
                      <span className="px-1.5 py-0.5 bg-[#ff6b5e] text-[#090c0a] border border-[#090c0a] font-mono text-[10px] font-bold uppercase tracking-wider">
                        ★ ADMIN
                      </span>
                    ) : oidcSession?.user?.isClubMember ? (
                      <span className="px-1.5 py-0.5 bg-[#ffe36e] text-[#090c0a] border border-[#090c0a] font-mono text-[10px] font-bold uppercase tracking-wider">
                        ★ UFC MEMBER
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 bg-[#2ee58f]/20 text-[#2ee58f] border border-[#2ee58f]/40 font-mono text-[10px] font-bold uppercase tracking-wider">
                        ✓ OIDC VERIFIED
                      </span>
                    )}
                  </div>
                  <p className="font-mono text-xs text-[#2ee58f] truncate font-bold">
                    ROLL #{oidcSession?.user?.rollNumber || 'VERIFIED'}
                    {oidcSession?.user?.githubUsername ? ` • @${oidcSession.user.githubUsername}` : ''}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {(oidcSession?.user?.is_admin || oidcSession?.user?.isAdmin || oidcSession?.user?.role === 'admin') && onNavigateToAdmin && (
                  <button
                    type="button"
                    onClick={onNavigateToAdmin}
                    className="px-2.5 py-1 bg-[#ff6b5e] hover:bg-[#ff8577] text-[#090c0a] border border-[#090c0a] font-mono font-bold text-[10px] uppercase tracking-wider shadow-[2px_2px_0_#090c0a] hover:translate-x-0.5 transition-all cursor-pointer"
                  >
                    ADMIN ⚙️
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleClearOidcSession}
                  className="px-2.5 py-1 bg-[#090c0a] text-[#aab5ac] hover:text-[#ff6b5e] border border-[#aab5ac]/30 hover:border-[#ff6b5e] font-mono text-[10px] uppercase tracking-wider transition-colors shrink-0 cursor-pointer"
                >
                  SIGN OUT
                </button>
              </div>
            </div>

            {/* Event Roster Squad Link Card for Authenticated Participant */}
            {(hasActiveRoster || rosterTeams.length > 0) && (
              <div className="border-2 border-[#2ee58f] bg-[#090c0a] p-4 text-left relative">
                <WashiTape color="signal" rotation="1deg" className="-top-3 right-6" />
                <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                  <span className="font-mono text-xs font-black text-[#2ee58f] uppercase tracking-wider">
                    § TOURNAMENT ROSTER ACTIVE
                  </span>
                  <span className="font-mono text-[10px] bg-[#2ee58f]/15 text-[#2ee58f] border border-[#2ee58f]/30 px-2 py-0.5 uppercase font-bold">
                    AUTO SQUAD MATCH
                  </span>
                </div>
                <p className="font-body text-xs text-[#aab5ac] mb-3">
                  Match with your pre-assigned competition squad using your registered email.
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="email"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder={oidcSession?.user?.email || 'Enter registered email'}
                    className="flex-1 bg-[#0f1411] border-2 border-white/20 focus:border-[#2ee58f] p-2 text-xs font-mono text-[#e8ece3] outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleEmailCheckin}
                    disabled={checkinLoading}
                    className="py-2 px-3 bg-[#2ee58f] hover:bg-[#3bf59e] text-[#090c0a] font-mono font-bold text-xs uppercase cursor-pointer disabled:opacity-50"
                  >
                    {checkinLoading ? 'CONNECTING...' : 'LINK SQUAD ➔'}
                  </button>
                </div>
              </div>
            )}

            {/* Contest Window Status Banner */}
            <div
              className={`p-3 border-2 font-mono text-xs flex items-center justify-between gap-2 transition-all ${
                windowOpen
                  ? 'border-[#2ee58f]/40 bg-[#2ee58f]/10 text-[#2ee58f]'
                  : 'border-[#f5a623] bg-[#f5a623]/10 text-[#f5a623]'
              }`}
            >
              <div className="flex items-center gap-2 font-bold tracking-wider uppercase">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    windowOpen ? 'bg-[#2ee58f] animate-pulse' : 'bg-[#f5a623]'
                  }`}
                />
                <span>
                  {windowOpen
                    ? 'CONTEST WINDOW OPEN // READY TO RACE'
                    : 'CONTEST WINDOW CLOSED // AWAITING ORGANIZER'}
                </span>
              </div>
              <span className="text-[11px] text-[#aab5ac] hidden sm:inline">
                {windowOpen ? 'Sprint round active' : 'Waiting for organizer to open sprint'}
              </span>
            </div>

            {/* Mode Switcher Tabs */}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setMode('join'); setError(null); }}
                className={`flex-1 py-3 px-4 font-mono font-bold text-sm tracking-wider uppercase border-2 transition-all cursor-pointer ${
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
                className={`flex-1 py-3 px-4 font-mono font-bold text-sm tracking-wider uppercase border-2 transition-all cursor-pointer ${
                  mode === 'create'
                    ? 'bg-[#ffe36e] text-[#090c0a] border-[#090c0a] shadow-[4px_4px_0_#090c0a] -translate-y-0.5'
                    : 'bg-[#0f1411] text-[#aab5ac] border-[#ffe36e]/20 hover:border-[#ffe36e]/50'
                }`}
              >
                CREATE NEW SQUAD
              </button>
            </div>

            {/* Form & Actions */}
            <form onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <div className="border-2 border-[#ff6b5e] bg-[#ff6b5e]/15 p-3.5 text-[#ff6b5e] font-mono text-xs tracking-wide flex flex-col gap-2">
                  <div>
                    <span className="font-bold">ERROR:</span> {error}
                  </div>
                  {existingTeamMatch && (
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      <button
                        type="button"
                        onClick={() => handleQuickRejoin(existingTeamMatch)}
                        className="py-1.5 px-3 bg-[#2ee58f] text-[#090c0a] border border-[#090c0a] font-mono font-bold text-xs uppercase shadow-[2px_2px_0_#090c0a] hover:translate-x-0.5 transition-transform cursor-pointer"
                      >
                        ⚡ REJOIN SQUAD #{existingTeamMatch} NOW
                      </button>
                      {((mode === 'join' && teamCode.trim().toUpperCase() && teamCode.trim().toUpperCase() !== existingTeamMatch) || mode === 'create') && (
                        <button
                          type="button"
                          onClick={() => handleSwitchSquad(existingTeamMatch, teamCode.trim().toUpperCase())}
                          className="py-1.5 px-3 bg-[#ffe36e] text-[#090c0a] border border-[#090c0a] font-mono font-bold text-xs uppercase shadow-[2px_2px_0_#090c0a] hover:translate-x-0.5 transition-transform cursor-pointer"
                        >
                          🚪 LEAVE #{existingTeamMatch} & {mode === 'create' ? 'CREATE SQUAD' : `JOIN #${teamCode.trim().toUpperCase()}`} ➔
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {mode === 'create' ? (
                <>
                  <div>
                    <label
                      htmlFor="onboarding-team-name"
                      className="block font-mono text-xs uppercase tracking-wider text-[#e8ece3] mb-1.5 font-bold"
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
                    <label className="block font-mono text-xs uppercase tracking-wider text-[#e8ece3] mb-1.5 font-bold">
                      Target Squad Size
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      {[
                        { size: 1, label: '1 // SOLO' },
                        { size: 2, label: '2 // DUO' },
                        { size: 3, label: '3 // TRIO' },
                        { size: 4, label: '4 // SQUAD' }
                      ].map(({ size, label }) => (
                        <button
                          key={size}
                          type="button"
                          onClick={() => setTargetSize(size)}
                          className={`py-2 px-2 border-2 font-mono text-xs tracking-wider uppercase font-bold transition-all cursor-pointer ${
                            targetSize === size
                              ? 'border-[#090c0a] bg-[#2ee58f] text-[#090c0a] shadow-[3px_3px_0_#090c0a] -translate-y-0.5'
                              : 'border-[#aab5ac]/30 bg-[#090c0a] text-[#aab5ac] hover:border-[#2ee58f]/50'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <p className="font-mono text-[11px] text-[#2ee58f] mt-2">
                      {targetSize === 1 && '⚡ SOLO RACER: Race immediately when ready — no teammates required.'}
                      {targetSize === 2 && '👥 DUO SQUAD: Exactly 2 teammates required • Final score is the team average.'}
                      {targetSize === 3 && '🛡️ TRIO SQUAD: Exactly 3 teammates required • Classic hackathon sprint format.'}
                      {targetSize === 4 && '⚔️ FULL SQUAD: Exactly 4 teammates required • High-coordination squad sprint.'}
                    </p>
                  </div>

                  {/* Authoritative Identity Indicator */}
                  <div className="border border-[#2ee58f]/30 bg-[#2ee58f]/10 p-3 flex items-center justify-between text-xs font-mono">
                    <span className="text-[#aab5ac] uppercase font-bold">CREATING AS CAPTAIN:</span>
                    <span className="text-[#2ee58f] font-bold">
                      {oidcSession?.user?.displayName || 'CAPTAIN'} (ROLL #{oidcSession?.user?.rollNumber || 'VERIFIED'})
                    </span>
                  </div>
                </>
              ) : (
                <>
                  {teamCode && (
                    <div className="border-2 border-[#ffe36e] bg-[#ffe36e]/10 p-3 flex items-center justify-between">
                      <div>
                        <span className="font-mono text-[10px] text-[#ffe36e] font-black uppercase tracking-wider block">
                          TARGET SQUAD ROOM
                        </span>
                        <span className="font-mono text-sm text-[#e8ece3] font-bold">
                          #{teamCode}
                        </span>
                      </div>
                      <span className="font-mono text-[10px] font-bold text-[#ffe36e] border border-[#ffe36e]/40 px-2 py-0.5 uppercase">
                        READY TO JOIN
                      </span>
                    </div>
                  )}

                  <div>
                    <label
                      htmlFor="onboarding-team-code"
                      className="block font-mono text-xs uppercase tracking-wider text-[#e8ece3] mb-1.5 font-bold"
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

                  {/* Authoritative Identity Indicator */}
                  <div className="border border-[#2ee58f]/30 bg-[#2ee58f]/10 p-3 flex items-center justify-between text-xs font-mono">
                    <span className="text-[#aab5ac] uppercase font-bold">JOINING AS MEMBER:</span>
                    <span className="text-[#2ee58f] font-bold">
                      {oidcSession?.user?.displayName || 'MEMBER'} (ROLL #{oidcSession?.user?.rollNumber || 'VERIFIED'})
                    </span>
                  </div>
                </>
              )}

              <div className="pt-2">
                <TactileButton
                  type="submit"
                  variant={mode === 'create' ? 'amber' : 'signal'}
                  disabled={loading || oidcLoading}
                  className="w-full text-sm sm:text-base py-3.5"
                >
                  {loading
                    ? 'CONNECTING TO SQUAD...'
                    : mode === 'create'
                    ? `CREATE SQUAD AS ${(oidcSession?.user?.displayName || 'CAPTAIN').toUpperCase()} ➔`
                    : `JOIN SQUAD #${teamCode || '...'} ➔`}
                </TactileButton>
              </div>
            </form>
          </div>
        )}
      </div>

      {/* Rules Notice Post-It */}
      <div className="mt-8 relative">
        <WashiTape color="signal" rotation="-1.5deg" className="-top-3 left-6 z-10" />
        <div className="postit p-5 border-2 border-[#090c0a]">
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <span className="font-mono text-xs font-black text-[#090c0a] uppercase tracking-wider">
              § HACKATHON COMBAT RULES
            </span>
            <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 bg-[#090c0a] text-[#ffe36e] uppercase">
              ZERO LUCK GUARANTEE
            </span>
          </div>
          <p className="font-body text-xs text-[#1a1a14] leading-relaxed">
            • <strong>Squad Synchronization:</strong> All teammates must toggle "READY" before the 3-2-1 countdown unlocks.<br />
            • <strong>Individual Execution:</strong> Each member solves 15 questions independently on their own screen within 120 seconds.<br />
            • <strong>Team Scoring:</strong> Final squad leaderboard ranking is computed from the mathematical mean of all member scores.<br />
            {lockedRoundMode === 'sub' ? (
              <>• <strong>Borrow Taxonomy:</strong> 15 calibrated subtraction problems across Clean Subtraction and Regroup Borrowing.<br /></>
            ) : lockedRoundMode === 'mixed' ? (
              <>• <strong>Mixed Taxonomy:</strong> 15 calibrated problems (8 Addition with Carry Taxonomy + 7 Subtraction with Regrouping).<br /></>
            ) : (
              <>• <strong>Carry Taxonomy:</strong> Exactly 3 No Carry, 4 Ones Carry, 4 Century Carry, and 4 Double Carry 2-digit addition problems.<br /></>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
