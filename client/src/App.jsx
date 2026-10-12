import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GrainOverlay } from './components/common/GrainOverlay.jsx';
import { MarqueeTicker } from './components/common/MarqueeTicker.jsx';
import { TeamOnboarding } from './components/lobby/TeamOnboarding.jsx';
import { TeamLobby } from './components/lobby/TeamLobby.jsx';
import { ArenaView } from './components/arena/ArenaView.jsx';
import { LeaderboardView } from './components/leaderboard/LeaderboardView.jsx';
import { AdminView } from './components/admin/AdminView.jsx';
import { leaveTeam, resetTeamSprint } from './services/api.js';

const SESSION_STORAGE_KEY = 'matiks_squad_session';
const SPRINT_STORAGE_KEY = 'matiks_sprint_session';

function getInitialView() {
  if (typeof window === 'undefined') return 'squad';
  const path = window.location.pathname.toLowerCase();
  if (path.startsWith('/leaderboard') || path.startsWith('/stage')) return 'leaderboard';
  if (path.startsWith('/admin') || path.startsWith('/organizer')) return 'admin';
  return 'squad';
}

function getUrlInviteTeamCode() {
  if (typeof window === 'undefined') return '';
  const params = new URLSearchParams(window.location.search);
  const queryTeam = params.get('team');
  if (queryTeam && queryTeam.trim()) {
    return queryTeam.trim().toUpperCase();
  }
  const match = window.location.pathname.match(/^\/team\/([A-Za-z0-9-]+)/);
  if (match && match[1]) {
    return match[1].toUpperCase();
  }
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

  const [teamSession, setTeamSession] = useState(() => {
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
          ? 'h-[100dvh] max-h-[100dvh] overflow-hidden overscroll-none bg-[#090c0a] text-[#e8ece3] flex flex-col relative selection:bg-[#2ee58f] selection:text-[#090c0a]'
          : 'min-h-screen min-h-[100dvh] bg-[#090c0a] text-[#e8ece3] flex flex-col relative selection:bg-[#2ee58f] selection:text-[#090c0a]'
      }
    >
      {/* Procedural Film Grain Overlay */}
      <GrainOverlay />

      {/* Top Banner Marquee (hidden completely during active sprint to give 100% vertical space to arena) */}
      {!isInActiveArena && <MarqueeTicker />}

      {/* Main Top Header (hidden during active sprint to eliminate distraction and free vertical real estate) */}
      {!isInActiveArena && (
        <header className="border-b-2 border-[#2ee58f]/20 bg-[#0f1411] px-3 sm:px-4 py-2 sm:py-3 flex items-center justify-between flex-wrap gap-2 sm:gap-3">
          <button
            type="button"
            onClick={() => navigateTo('squad')}
            className="flex items-center gap-2 sm:gap-3 text-left group cursor-pointer"
          >
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded bg-[#2ee58f] text-[#090c0a] font-display font-extrabold flex items-center justify-center text-base sm:text-lg border-2 border-[#090c0a] shadow-[2px_2px_0_#2ee58f] group-hover:-translate-y-0.5 transition-transform">
              M
            </div>
            <div>
              <span className="font-display font-extrabold text-base sm:text-lg tracking-tight text-[#e8ece3] group-hover:text-[#2ee58f] transition-colors">
                MATIKS
              </span>
              <span className="font-mono text-[9px] sm:text-[10px] tracking-widest text-[#2ee58f] block -mt-1 uppercase">
                SPEED SPRINT HACKATHON
              </span>
            </div>
          </button>

          {/* Global Navigation Tabs */}
          <div className="flex items-center gap-1 sm:gap-2">
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

            {teamSession && currentView === 'squad' && (
              <span className="hidden xs:inline-block sm:inline-block font-mono text-xs font-bold bg-[#ffe36e] text-[#090c0a] px-2 py-0.5 border border-[#090c0a] shadow-[2px_2px_0_#090c0a] ml-1">
                #{teamSession.teamCode}
              </span>
            )}
          </div>
        </header>
      )}

      {/* Main View Body */}
      <main className={isInActiveArena ? 'flex-1 flex flex-col h-full max-h-full overflow-hidden p-0' : 'flex-1 flex flex-col justify-center py-4 sm:py-6'}>
        {currentView === 'leaderboard' && (
          <LeaderboardView onReturnToLobby={() => navigateTo('squad')} />
        )}

        {currentView === 'admin' && (
          <AdminView
            onReturnToLobby={() => navigateTo('squad')}
            onViewLeaderboard={() => navigateTo('leaderboard')}
          />
        )}

        <div className={currentView === 'squad' ? (isInActiveArena ? 'w-full h-full flex flex-col min-h-0' : 'w-full') : 'hidden'}>
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
              onOidcCallbackComplete={(oidcUser) => {
                setOidcCallbackPending(false);
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
        </div>
      </main>

      {/* Footer (hidden during active sprint to give 100% vertical space to arena) */}
      {!isInActiveArena && (
        <footer className="border-t border-[#2ee58f]/10 bg-[#090c0a] py-4 px-4 text-center font-mono text-xs text-[#aab5ac]">
          <span>MATIKS HACKATHON ENGINE • BUILT FOR USAR FOSS CLUB</span>
          <span className="mx-2">•</span>
          <a
            href="https://www.fossclub.tech"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#2ee58f] hover:underline"
          >
            FOSSCLUB.TECH
          </a>
        </footer>
      )}
    </div>
  );
}

export default App;
