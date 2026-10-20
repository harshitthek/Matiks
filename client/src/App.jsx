import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GrainOverlay } from './components/common/GrainOverlay.jsx';
import { MarqueeTicker } from './components/common/MarqueeTicker.jsx';
import { TeamOnboarding } from './components/lobby/TeamOnboarding.jsx';
import { TeamLobby } from './components/lobby/TeamLobby.jsx';
import { ArenaView } from './components/arena/ArenaView.jsx';
import { LeaderboardView } from './components/leaderboard/LeaderboardView.jsx';
import { AdminView } from './components/admin/AdminView.jsx';
import { ErrorBoundary } from './components/common/ErrorBoundary.jsx';
import { leaveTeam, resetTeamSprint, getAuthMe } from './services/api.js';
import { soundFx } from './services/soundFx.js';

const SESSION_STORAGE_KEY = 'matiks_squad_session';
const SPRINT_STORAGE_KEY = 'matiks_sprint_session';

function getInitialView() {
  if (typeof window === 'undefined') return 'squad';
  const path = window.location.pathname.toLowerCase();
  if (path.startsWith('/leaderboard') || path.startsWith('/stage')) return 'leaderboard';
  if (path.startsWith('/admin') || path.startsWith('/organizer')) return 'admin';
  return 'squad';
}

function savePendingInvite(code) {
  if (!code || typeof window === 'undefined') return;
  const normalized = code.trim().toUpperCase();
  const payload = JSON.stringify({ code: normalized, expiresAt: Date.now() + 15 * 60 * 1000 });
  try {
    sessionStorage.setItem('matiks_pending_invite_code', payload);
    localStorage.setItem('matiks_pending_invite_code', payload);
  } catch {
    // Storage unavailable
  }
}

function clearPendingInvite() {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem('matiks_pending_invite_code');
    localStorage.removeItem('matiks_pending_invite_code');
  } catch {
    // Storage unavailable
  }
}

function readPendingInviteFromStorage(storage) {
  if (!storage) return null;
  try {
    const raw = storage.getItem('matiks_pending_invite_code');
    if (!raw) return null;
    if (raw.startsWith('{')) {
      const parsed = JSON.parse(raw);
      if (parsed?.code && typeof parsed.expiresAt === 'number') {
        if (Date.now() < parsed.expiresAt) {
          return parsed.code.trim().toUpperCase();
        }
        storage.removeItem('matiks_pending_invite_code');
        return null;
      }
    }
    if (raw.trim()) {
      return raw.trim().toUpperCase();
    }
  } catch {
    // Storage unavailable
  }
  return null;
}

function getUrlInviteTeamCode() {
  if (typeof window === 'undefined') return '';
  const params = new URLSearchParams(window.location.search);
  const queryTeam = params.get('team');
  if (queryTeam && queryTeam.trim()) {
    const code = queryTeam.trim().toUpperCase();
    savePendingInvite(code);
    return code;
  }
  const match = window.location.pathname.match(/^\/team\/([A-Za-z0-9-]+)/);
  if (match && match[1]) {
    const code = match[1].toUpperCase();
    savePendingInvite(code);
    return code;
  }
  const sessionInvite = readPendingInviteFromStorage(window.sessionStorage);
  if (sessionInvite) return sessionInvite;
  const localInvite = readPendingInviteFromStorage(window.localStorage);
  if (localInvite) return localInvite;
  return '';
}

function hasOidcCallbackInUrl() {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return Boolean((params.get('code') && params.get('state')) || params.get('error'));
}

export function App() {
  const [currentView, setCurrentView] = useState(getInitialView);
  const [inviteTeamCode, setInviteTeamCode] = useState(getUrlInviteTeamCode);
  const [oidcCallbackPending, setOidcCallbackPending] = useState(hasOidcCallbackInUrl);
  const [isAudioMuted, setIsAudioMuted] = useState(() => soundFx.isMuted());

  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const raw = localStorage.getItem('matiks_oidc_session');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.user) return parsed.user;
      }
    } catch {
      return null;
    }
    return null;
  });

  const [hasAdminSession, setHasAdminSession] = useState(() => {
    try {
      return Boolean(sessionStorage.getItem('matiks_admin_token'));
    } catch {
      return false;
    }
  });

  // Verify OIDC session on mount to fetch up-to-date is_admin claims
  useEffect(() => {
    try {
      const raw = localStorage.getItem('matiks_oidc_session');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed?.token) return;
      const requestedToken = parsed.token;

      getAuthMe(requestedToken)
        .then((res) => {
          let currentStoredToken = null;
          try {
            const currentRaw = localStorage.getItem('matiks_oidc_session');
            if (currentRaw) currentStoredToken = JSON.parse(currentRaw)?.token;
          } catch {
            // Ignore parse errors
          }
          if (currentStoredToken !== requestedToken) return;

          if (res?.user) {
            setCurrentUser(res.user);
            try {
              localStorage.setItem(
                'matiks_oidc_session',
                JSON.stringify({ user: res.user, token: requestedToken })
              );
            } catch {
              // Ignore storage errors
            }
          }
        })
        .catch((err) => {
          let currentStoredToken = null;
          try {
            const currentRaw = localStorage.getItem('matiks_oidc_session');
            if (currentRaw) currentStoredToken = JSON.parse(currentRaw)?.token;
          } catch {
            // Ignore parse errors
          }
          if (currentStoredToken !== requestedToken) return;

          if (err?.status === 401 || err?.status === 403) {
            setCurrentUser(null);
            try {
              localStorage.removeItem('matiks_oidc_session');
            } catch {
              // Ignore storage errors
            }
          }
        });
    } catch {
      // Ignore parse errors
    }
  }, []);

  const isUserAdmin = Boolean(
    currentUser?.is_admin ||
    currentUser?.isAdmin ||
    currentUser?.role === 'admin' ||
    hasAdminSession
  );

  const handleToggleAudio = useCallback(() => {
    const nextMuted = soundFx.toggleMute();
    setIsAudioMuted(nextMuted);
  }, []);

  const [teamSession, setTeamSession] = useState(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('arena') === 'mock' || params.get('preview') === 'arena') {
        return {
          teamCode: 'XT-54',
          memberToken: 'tok_preview',
          rollNumber: '24UFC001',
          name: 'JB'
        };
      }
    }
    try {
      const saved = localStorage.getItem(SESSION_STORAGE_KEY);
      if (!saved) return null;
      const parsed = JSON.parse(saved);
      if (
        parsed &&
        typeof parsed === 'object' &&
        typeof parsed.teamCode === 'string' &&
        typeof parsed.memberToken === 'string' &&
        typeof parsed.rollNumber === 'string'
      ) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  });

  const [sprintSession, setSprintSession] = useState(() => {
    if (typeof window === 'undefined') return null;
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('arena') === 'mock' || params.get('preview') === 'arena') {
        return {
          sessionId: 'sess_preview',
          teamCode: 'XT-54',
          questionIndex: 0,
          currentScore: 120,
          streak: 2,
          maxStreak: 2,
          submissions: [],
          isFinished: false,
          isTimeOut: false,
          isPaused: false,
          startedAt: Date.now() - 15000,
          durationSeconds: 120,
          questions: [
            { bucket: 'B1', a: 24, b: 45, operation: '+', answer: 69 },
            { bucket: 'B2', a: 38, b: 27, operation: '+', answer: 65 },
            { bucket: 'B3', a: 64, b: 53, operation: '+', answer: 117 },
            { bucket: 'B4', a: 78, b: 59, operation: '+', answer: 137 }
          ]
        };
      }
      if (params.get('arena') !== '1') {
        sessionStorage.removeItem(SPRINT_STORAGE_KEY);
        return null;
      }
      const saved = sessionStorage.getItem(SPRINT_STORAGE_KEY);
      if (!saved) return null;
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === 'object' && typeof parsed.sessionId === 'string') {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  });

  const [isSprintFinished, setIsSprintFinished] = useState(() =>
    Boolean(sprintSession?.isFinished)
  );
  const [suppressedResumeSessionId, setSuppressedResumeSessionId] = useState(null);
  const [arenaExitPrompt, setArenaExitPrompt] = useState(false);
  const [lobbyLeavePrompt, setLobbyLeavePrompt] = useState(false);

  const sprintSessionRef = useRef(sprintSession);
  const teamSessionRef = useRef(teamSession);
  const isSprintFinishedRef = useRef(Boolean(sprintSession?.isFinished));
  const arenaExitPromptRef = useRef(false);
  const lobbyLeavePromptRef = useRef(false);
  const currentViewRef = useRef(currentView);

  useEffect(() => {
    sprintSessionRef.current = sprintSession;
    if (sprintSession?.sessionId === 'sess_preview') return;
    try {
      if (sprintSession) {
        sessionStorage.setItem(SPRINT_STORAGE_KEY, JSON.stringify(sprintSession));
      } else {
        sessionStorage.removeItem(SPRINT_STORAGE_KEY);
      }
    } catch {
      // Ignore storage errors
    }
  }, [sprintSession]);

  useEffect(() => {
    teamSessionRef.current = teamSession;
  }, [teamSession]);

  useEffect(() => {
    currentViewRef.current = currentView;
  }, [currentView]);

  const buildSquadUrl = useCallback((team, sprint) => {
    if (!team?.teamCode) return '/';
    const code = encodeURIComponent(team.teamCode);
    return sprint ? `/?team=${code}&arena=1` : `/?team=${code}`;
  }, []);

  // Ensure initial URL reflects restored team session (unless handling an OIDC callback)
  useEffect(() => {
    if (oidcCallbackPending || hasOidcCallbackInUrl()) return;
    if (sprintSession?.sessionId === 'sess_preview' || teamSession?.memberToken === 'tok_preview') return;
    if (currentView === 'squad' && teamSession?.teamCode) {
      const targetUrl = buildSquadUrl(teamSession, sprintSession);
      if (window.location.pathname + window.location.search !== targetUrl) {
        window.history.replaceState(
          { view: 'squad', step: sprintSession ? 'arena' : 'lobby', teamCode: teamSession.teamCode },
          '',
          targetUrl
        );
      }
    }
  }, [currentView, teamSession, sprintSession, buildSquadUrl, oidcCallbackPending]);

  const handleReturnToLobbyFromSprint = useCallback(() => {
    const activeSprint = sprintSessionRef.current;
    if (activeSprint?.sessionId) {
      setSuppressedResumeSessionId(activeSprint.sessionId);
    }
    setSprintSession(null);
    arenaExitPromptRef.current = false;
    setArenaExitPrompt(false);
    isSprintFinishedRef.current = false;
    setIsSprintFinished(false);
    setCurrentView('squad');
    const activeTeam = teamSessionRef.current;
    const url = activeTeam?.teamCode ? `/?team=${encodeURIComponent(activeTeam.teamCode)}` : '/';
    window.history.replaceState(
      { view: 'squad', step: 'lobby', teamCode: activeTeam?.teamCode },
      '',
      url
    );
  }, []);

  const handleLeaveTeam = useCallback(async (options = {}) => {
    const current = teamSessionRef.current;
    if (!options?.forceLocal && current?.teamCode && current?.rollNumber) {
      await leaveTeam(current.teamCode, current.rollNumber, current.memberToken);
    }

    if (current?.rollNumber) {
      try {
        const rawVault = localStorage.getItem('matiks_member_tokens');
        if (rawVault) {
          const vault = JSON.parse(rawVault);
          delete vault[current.rollNumber.toUpperCase()];
          localStorage.setItem('matiks_member_tokens', JSON.stringify(vault));
        }
      } catch {
        // Ignore storage cleanup errors
      }
    }

    setTeamSession(null);
    setSprintSession(null);
    setSuppressedResumeSessionId(null);
    arenaExitPromptRef.current = false;
    setArenaExitPrompt(false);
    lobbyLeavePromptRef.current = false;
    setLobbyLeavePrompt(false);
    isSprintFinishedRef.current = false;
    setIsSprintFinished(false);
    setInviteTeamCode('');
    clearPendingInvite();
    window.history.replaceState({ view: 'squad', step: 'onboarding' }, '', '/');
  }, []);

  // Sync navigation & Back/Forward button behavior with browser popstate
  useEffect(() => {
    const handlePopState = () => {
      const nextView = getInitialView();
      const prevView = currentViewRef.current;

      // Returning from /leaderboard or /admin back to squad
      if (prevView !== 'squad' && nextView === 'squad') {
        setCurrentView('squad');
        return;
      }

      if (nextView !== 'squad') {
        setCurrentView(nextView);
        return;
      }

      // User pressed Back while inside Squad view
      const activeSprint = sprintSessionRef.current;
      const activeTeam = teamSessionRef.current;

      if (activeSprint) {
        if (!isSprintFinishedRef.current) {
          if (arenaExitPromptRef.current) {
            // Second Back press while confirmation prompt is open -> exit to lobby
            handleReturnToLobbyFromSprint();
            return;
          }
          // Guard against accidental Back button / mobile swipe-back during live 2-minute sprint
          arenaExitPromptRef.current = true;
          setArenaExitPrompt(true);
          window.history.pushState(
            { view: 'squad', step: 'arena', teamCode: activeTeam?.teamCode },
            '',
            buildSquadUrl(activeTeam, activeSprint)
          );
          return;
        }
        // Sprint is already finished (Summary view) -> Back returns cleanly to Team Lobby
        handleReturnToLobbyFromSprint();
        return;
      }

      if (activeTeam) {
        if (lobbyLeavePromptRef.current) {
          // Second Back press while leave prompt is open -> leave squad
          handleLeaveTeam();
          return;
        }
        lobbyLeavePromptRef.current = true;
        setLobbyLeavePrompt(true);
        window.history.pushState(
          { view: 'squad', step: 'lobby', teamCode: activeTeam.teamCode },
          '',
          buildSquadUrl(activeTeam, null)
        );
        return;
      }

      setCurrentView('squad');
      setInviteTeamCode(getUrlInviteTeamCode());
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [buildSquadUrl, handleReturnToLobbyFromSprint, handleLeaveTeam]);

  const navigateTo = useCallback(
    (view) => {
      setCurrentView(view);
      const activeTeam = teamSessionRef.current;
      const activeSprint = sprintSessionRef.current;
      const targetUrl =
        view === 'leaderboard'
          ? '/leaderboard'
          : view === 'admin'
          ? '/admin'
          : buildSquadUrl(activeTeam, activeSprint);

      if (window.location.pathname + window.location.search !== targetUrl) {
        window.history.pushState({ view }, '', targetUrl);
      }
    },
    [buildSquadUrl]
  );

  // Sync session state to localStorage
  useEffect(() => {
    if (teamSession?.memberToken === 'tok_preview') return;
    try {
      if (teamSession) {
        localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(teamSession));
        if (teamSession.rollNumber && teamSession.memberToken) {
          const rawVault = localStorage.getItem('matiks_member_tokens');
          const vault = rawVault ? JSON.parse(rawVault) : {};
          vault[teamSession.rollNumber.toUpperCase()] = teamSession.memberToken;
          localStorage.setItem('matiks_member_tokens', JSON.stringify(vault));
        }
      } else {
        localStorage.removeItem(SESSION_STORAGE_KEY);
      }
    } catch (e) {
      console.warn('Failed to persist squad session to localStorage:', e);
    }
  }, [teamSession]);

  const handleJoinedTeam = useCallback((sessionData) => {
    setTeamSession(sessionData);
    setSprintSession(null);
    setSuppressedResumeSessionId(null);
    arenaExitPromptRef.current = false;
    setArenaExitPrompt(false);
    lobbyLeavePromptRef.current = false;
    setLobbyLeavePrompt(false);
    isSprintFinishedRef.current = false;
    setIsSprintFinished(false);
    setCurrentView('squad');
    clearPendingInvite();
    const url = `/?team=${encodeURIComponent(sessionData.teamCode)}`;
    window.history.pushState(
      { view: 'squad', step: 'lobby', teamCode: sessionData.teamCode },
      '',
      url
    );
  }, []);

  const handleStartSprint = useCallback((sprintData) => {
    setSuppressedResumeSessionId(null);
    isSprintFinishedRef.current = Boolean(sprintData.isFinished);
    setIsSprintFinished(Boolean(sprintData.isFinished));
    arenaExitPromptRef.current = false;
    setArenaExitPrompt(false);
    lobbyLeavePromptRef.current = false;
    setLobbyLeavePrompt(false);
    setSprintSession(sprintData);
    setCurrentView('squad');
    const activeTeam = teamSessionRef.current;
    const url = activeTeam?.teamCode
      ? `/?team=${encodeURIComponent(activeTeam.teamCode)}&arena=1`
      : '/?arena=1';
    window.history.pushState(
      { view: 'squad', step: 'arena', sessionId: sprintData.sessionId },
      '',
      url
    );
  }, []);

  const handleSprintStateSync = useCallback((patch) => {
    setSprintSession((prev) => {
      if (!prev) return prev;
      if (
        prev.questionIndex === patch.questionIndex &&
        prev.currentScore === patch.currentScore &&
        prev.streak === patch.streak &&
        prev.maxStreak === patch.maxStreak &&
        prev.submissions === patch.submissions &&
        prev.isFinished === patch.isFinished &&
        prev.isTimeOut === patch.isTimeOut &&
        prev.isPaused === patch.isPaused
      ) {
        return prev;
      }
      const next = { ...prev, ...patch };
      sprintSessionRef.current = next;
      try {
        sessionStorage.setItem(SPRINT_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage errors
      }
      return next;
    });
  }, []);

  const handlePlayAgainFromSummary = useCallback(async () => {
    const current = teamSessionRef.current;
    if (current?.teamCode && current?.rollNumber) {
      try {
        await resetTeamSprint(current.teamCode, current.rollNumber, current.memberToken);
      } catch {
        // Even if already reset by a teammate, transition back to lobby
      }
    }
    handleReturnToLobbyFromSprint();
  }, [handleReturnToLobbyFromSprint]);

  const isInActiveArena = Boolean(sprintSession && !isSprintFinished && currentView === 'squad');

  return (
    <div
      className={
        isInActiveArena
          ? 'h-[100dvh] max-h-[100dvh] overflow-hidden overscroll-none touch-manipulation bg-[#090c0a] text-[#e8ece3] flex flex-col relative selection:bg-[#2ee58f] selection:text-[#090c0a]'
          : 'min-h-screen min-h-[100dvh] bg-[#090c0a] text-[#e8ece3] flex flex-col relative selection:bg-[#2ee58f] selection:text-[#090c0a]'
      }
    >
      {/* Procedural Film Grain Overlay */}
      <GrainOverlay disabled={isInActiveArena} />

      {/* Top Banner Marquee (hidden completely during active sprint to give 100% vertical space to arena) */}
      {!isInActiveArena && <MarqueeTicker />}

      {/* Main Top Header (hidden during active sprint to eliminate distraction and free vertical real estate) */}
      {!isInActiveArena && (
        <header className="border-b-2 border-[#2ee58f]/20 bg-[#0f1411] px-3 sm:px-4 py-2 sm:py-2.5 flex items-center justify-between flex-wrap gap-2 sm:gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigateTo('squad')}
              className="flex items-center gap-2.5 text-left group cursor-pointer"
            >
              <div className="relative">
                <div className="w-8 h-8 rounded bg-[#2ee58f] text-[#090c0a] font-display font-extrabold flex items-center justify-center text-lg border-2 border-[#090c0a] shadow-[2px_2px_0_#2ee58f] group-hover:-translate-y-0.5 transition-transform">
                  M
                </div>
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-display font-extrabold text-base sm:text-lg tracking-tight text-[#e8ece3] group-hover:text-[#2ee58f] transition-colors">
                    MATIKS
                  </span>
                  <span className="hidden md:inline-block font-mono text-[9px] font-bold bg-[#2ee58f]/15 text-[#2ee58f] border border-[#2ee58f]/40 px-1 py-0.5 uppercase">
                    v2.0
                  </span>
                </div>
                <span className="font-mono text-[9px] sm:text-[10px] tracking-widest text-[#2ee58f] block -mt-1 uppercase">
                  SPEED MATH COMBAT
                </span>
              </div>
            </button>

            {/* UFC Club & FOSS Forge Badge */}
            <div className="hidden sm:flex items-center gap-2 pl-3 border-l-2 border-white/10">
              <a
                href="https://www.fossclub.tech"
                target="_blank"
                rel="noopener noreferrer"
                title="USAR FOSS Club (fossclub.tech)"
                className="flex items-center gap-1.5 px-2 py-0.5 bg-[#090c0a] hover:bg-[#2ee58f]/10 border border-[#2ee58f]/30 hover:border-[#2ee58f] transition-all group"
              >
                <div className="w-4 h-4 rounded-xs bg-[#E6F8ED] border border-[#090c0a] p-0.5 flex items-center justify-center shrink-0">
                  <img
                    src="/brand/ufc-logo.svg"
                    alt="UFC"
                    className="w-full h-full object-contain"
                  />
                </div>
                <span className="font-mono text-[10px] font-bold text-[#e8ece3] group-hover:text-[#2ee58f] uppercase">
                  UFC
                </span>
              </a>

              <a
                href="https://unstop.com/hackathons/foss-forge-20-university-school-of-automation-robotics-usar-guru-gobind-singh-indraprastha-university-ggsipu--1767553"
                target="_blank"
                rel="noopener noreferrer"
                title="FOSS Forge 2.0 on Unstop"
                className="hidden lg:inline-flex items-center gap-1 px-2 py-0.5 bg-[#ffe36e]/15 border border-[#ffe36e]/40 hover:border-[#ffe36e] font-mono text-[10px] font-bold text-[#ffe36e] uppercase tracking-wider transition-colors"
              >
                <span>★ FOSS FORGE 2.0</span>
              </a>
            </div>
          </div>

          {/* Global Navigation Tabs & Actions */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={() => navigateTo('squad')}
              className={`font-mono text-[11px] sm:text-xs px-2 sm:px-2.5 py-1 border transition-all ${
                currentView === 'squad'
                  ? 'border-[#2ee58f] bg-[#2ee58f] text-[#090c0a] font-bold shadow-[2px_2px_0_#090c0a]'
                  : 'border-white/10 text-[#aab5ac] hover:text-[#e8ece3]'
              }`}
            >
              {sprintSession && !isSprintFinished ? 'ARENA ⚡' : 'SQUAD ⚡'}
            </button>

            <button
              type="button"
              onClick={() => navigateTo('leaderboard')}
              className={`font-mono text-[11px] sm:text-xs px-2 sm:px-2.5 py-1 border transition-all ${
                currentView === 'leaderboard'
                  ? 'border-[#ffe36e] bg-[#ffe36e] text-[#090c0a] font-bold shadow-[2px_2px_0_#090c0a]'
                  : 'border-white/10 text-[#aab5ac] hover:text-[#e8ece3]'
              }`}
            >
              LEADERBOARD 🏆
            </button>

            {(isUserAdmin || currentView === 'admin') && (
              <button
                type="button"
                onClick={() => navigateTo('admin')}
                className={`font-mono text-[11px] sm:text-xs px-2 sm:px-2.5 py-1 border transition-all ${
                  currentView === 'admin'
                    ? 'border-[#ff6b5e] bg-[#ff6b5e] text-[#090c0a] font-bold shadow-[2px_2px_0_#090c0a]'
                    : 'border-white/10 text-[#aab5ac] hover:text-[#e8ece3]'
                }`}
              >
                ADMIN ⚙️
              </button>
            )}

            {teamSession && currentView === 'squad' && (
              <span className="hidden xs:inline-block sm:inline-block font-mono text-xs font-bold bg-[#ffe36e] text-[#090c0a] px-2 py-0.5 border border-[#090c0a] shadow-[2px_2px_0_#090c0a]">
                #{teamSession.teamCode}
              </span>
            )}

            {/* Sound FX Audio Toggle */}
            <button
              type="button"
              onClick={handleToggleAudio}
              title={isAudioMuted ? 'Sound FX: Muted (Click to enable audio feedback)' : 'Sound FX: Active (Click to mute)'}
              aria-label={isAudioMuted ? 'Unmute sound effects' : 'Mute sound effects'}
              className="p-1 sm:px-2 sm:py-1 border border-white/10 hover:border-[#2ee58f] text-[#aab5ac] hover:text-[#2ee58f] bg-[#090c0a] font-mono text-xs transition-colors cursor-pointer"
            >
              {isAudioMuted ? '🔇' : '🔊'}
            </button>
          </div>
        </header>
      )}

      {/* Main View Body */}
      <main className={isInActiveArena ? 'flex-1 flex flex-col h-full max-h-full overflow-hidden p-0' : 'flex-1 flex flex-col justify-center py-4 sm:py-6'}>
        {/* Transient views (Leaderboard, Admin) with key={currentView} so view errors reset on navigation */}
        {currentView !== 'squad' && (
          <ErrorBoundary key={currentView}>
            {currentView === 'leaderboard' && (
              <LeaderboardView onReturnToLobby={() => navigateTo('squad')} />
            )}

            {currentView === 'admin' && (
              <AdminView
                currentUser={currentUser}
                onReturnToLobby={() => navigateTo('squad')}
                onViewLeaderboard={() => navigateTo('leaderboard')}
                onLogin={() => setHasAdminSession(true)}
                onLogout={() => {
                  setHasAdminSession(false);
                  try {
                    const rawOidc = localStorage.getItem('matiks_oidc_session');
                    if (rawOidc) {
                      const parsed = JSON.parse(rawOidc);
                      setCurrentUser(parsed?.user || null);
                    } else {
                      setCurrentUser(null);
                    }
                  } catch {
                    setCurrentUser(null);
                  }
                }}
              />
            )}
          </ErrorBoundary>
        )}

        {/* Squad container is kept permanently mounted and hidden with .hidden when viewing other tabs,
            so ArenaView, SSE connections, and in-flight OIDC exchanges are preserved.
            ErrorBoundary is placed inside so errors occurring while hidden stay hidden until tab is focused */}
        <div className={currentView === 'squad' ? (isInActiveArena ? 'w-full h-full flex flex-col min-h-0' : 'w-full') : 'hidden'}>
          <ErrorBoundary key={`${sprintSession?.sessionId ?? 'none'}|${teamSession?.teamCode ?? 'none'}`}>


            {sprintSession ? (
              <ArenaView
                key={sprintSession.sessionId}
                sessionId={sprintSession.sessionId}
                questions={sprintSession.questions}
                initialQuestionIndex={sprintSession.questionIndex || 0}
                initialScore={sprintSession.currentScore || 0}
                initialStreak={sprintSession.streak || 0}
                initialMaxStreak={sprintSession.maxStreak || sprintSession.streak || 0}
                initialSubmissions={sprintSession.submissions || []}
                initialIsFinished={Boolean(sprintSession.isFinished)}
                initialIsTimeOut={Boolean(sprintSession.isTimeOut)}
                startedAt={sprintSession.startedAt}
                durationSeconds={sprintSession.durationSeconds || 120}
                initialIsPaused={Boolean(sprintSession.isPaused)}
                isActiveView={currentView === 'squad'}
                teamCode={teamSession?.teamCode}
                memberToken={teamSession?.memberToken}
                currentRoll={teamSession?.rollNumber}
                currentName={teamSession?.name}
                exitPromptRequested={arenaExitPrompt}
                isAudioMuted={isAudioMuted}
                onToggleAudioMute={handleToggleAudio}
                onDismissExitPrompt={() => {
                  arenaExitPromptRef.current = false;
                  setArenaExitPrompt(false);
                }}
                onSprintFinishedChange={(finished) => {
                  isSprintFinishedRef.current = finished;
                  setIsSprintFinished(finished);
                }}
                onStateSync={handleSprintStateSync}
                onReturnToLobby={handleReturnToLobbyFromSprint}
                onPlayAgain={handlePlayAgainFromSummary}
                onViewLeaderboard={() => navigateTo('leaderboard')}
              />
            ) : teamSession && !oidcCallbackPending ? (
              /* Active Squad Lobby */
              <TeamLobby
                teamCode={teamSession.teamCode}
                memberToken={teamSession.memberToken}
                currentRoll={teamSession.rollNumber}
                suppressedResumeSessionId={suppressedResumeSessionId}
                leavePromptRequested={lobbyLeavePrompt}
                onDismissLeavePrompt={() => {
                  lobbyLeavePromptRef.current = false;
                  setLobbyLeavePrompt(false);
                }}
                onStartSprint={handleStartSprint}
                onLeaveTeam={handleLeaveTeam}
                onViewLeaderboard={() => navigateTo('leaderboard')}
              />
            ) : (
              /* Squad Onboarding */
              <TeamOnboarding
                key={inviteTeamCode}
                initialTeamCode={inviteTeamCode}
                onJoinedTeam={handleJoinedTeam}
                onNavigateToAdmin={() => navigateTo('admin')}
                onOidcCallbackComplete={(oidcUser) => {
                  setOidcCallbackPending(false);
                  if (oidcUser) {
                    setCurrentUser(oidcUser);
                  }
                  if (
                    oidcUser?.rollNumber &&
                    teamSessionRef.current?.rollNumber &&
                    oidcUser.rollNumber.toUpperCase() !== teamSessionRef.current.rollNumber.toUpperCase()
                  ) {
                    void handleLeaveTeam({ forceLocal: true });
                  }
                }}
              />
            )}
          </ErrorBoundary>
        </div>
      </main>


      {/* Neo-brutalist FOSS Forge & UFC Community Footer (hidden during active sprint) */}
      {!isInActiveArena && (
        <footer className="border-t-2 border-[#2ee58f]/20 bg-[#0f1411] py-6 px-4 relative overflow-hidden">
          <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3 text-left">
              <a
                href="https://www.fossclub.tech"
                target="_blank"
                rel="noopener noreferrer"
                className="w-9 h-9 rounded bg-[#E6F8ED] border-2 border-[#090c0a] p-1 flex items-center justify-center shrink-0 shadow-[2px_2px_0_#2ee58f] hover:scale-105 transition-transform"
                title="USAR FOSS Club"
              >
                <img
                  src="/brand/ufc-logo.svg"
                  alt="USAR FOSS Club Logo"
                  className="w-full h-full object-contain"
                />
              </a>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-display font-extrabold text-sm text-[#e8ece3] tracking-tight">
                    MATIKS
                  </span>
                  <span className="font-mono text-[10px] text-[#2ee58f] uppercase font-bold tracking-wider">
                    // FOSS FORGE 2.0 MINI-GAME
                  </span>
                </div>
                <p className="font-mono text-[11px] text-[#aab5ac]">
                  Built with open source by <span className="text-[#e8ece3] font-bold">USAR FOSS Club</span> (UFC) · GGSIPU East Delhi Campus
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 sm:gap-4 flex-wrap justify-center font-mono text-xs">
              <a
                href="https://www.fossclub.tech"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#2ee58f] hover:underline font-bold"
              >
                FOSSCLUB.TECH ↗
              </a>
              <span className="text-white/20">•</span>
              <a
                href="https://unstop.com/hackathons/foss-forge-20-university-school-of-automation-robotics-usar-guru-gobind-singh-indraprastha-university-ggsipu--1767553"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#ffe36e] hover:underline font-bold"
              >
                UNSTOP HACKATHON ↗
              </a>
              <span className="text-white/20">•</span>
              <a
                href="https://github.com/harshitthek/Matiks"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#aab5ac] hover:text-[#e8ece3] hover:underline"
              >
                GITHUB ↗
              </a>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}

export default App;
