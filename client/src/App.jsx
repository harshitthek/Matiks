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

export function App() {
  const [currentView, setCurrentView] = useState(getInitialView);
  const [inviteTeamCode, setInviteTeamCode] = useState(getUrlInviteTeamCode);

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

  const [sprintSession, setSprintSession] = useState(null);
  const [isSprintFinished, setIsSprintFinished] = useState(false);
  const [arenaExitPrompt, setArenaExitPrompt] = useState(false);
  const [lobbyLeavePrompt, setLobbyLeavePrompt] = useState(false);

  const sprintSessionRef = useRef(null);
  const teamSessionRef = useRef(null);
  const isSprintFinishedRef = useRef(false);
  const currentViewRef = useRef(currentView);

  useEffect(() => {
    sprintSessionRef.current = sprintSession;
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

  // Ensure initial URL reflects restored team session
  useEffect(() => {
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
  }, [currentView, teamSession, sprintSession, buildSquadUrl]);

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
          // Guard against accidental Back button / mobile swipe-back during live 2-minute sprint
          setArenaExitPrompt(true);
          window.history.pushState(
            { view: 'squad', step: 'arena', teamCode: activeTeam?.teamCode },
            '',
            buildSquadUrl(activeTeam, activeSprint)
          );
          return;
        }
        // Sprint is already finished (Summary view) -> Back returns cleanly to Team Lobby
        setSprintSession(null);
        setArenaExitPrompt(false);
        isSprintFinishedRef.current = false;
        setIsSprintFinished(false);
        if (activeTeam?.teamCode) {
          window.history.replaceState(
            { view: 'squad', step: 'lobby', teamCode: activeTeam.teamCode },
            '',
            buildSquadUrl(activeTeam, null)
          );
        }
        return;
      }

      setCurrentView('squad');
      setInviteTeamCode(getUrlInviteTeamCode());
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [buildSquadUrl]);

  const navigateTo = useCallback((view) => {
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
  }, [buildSquadUrl]);

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
    setArenaExitPrompt(false);
    setLobbyLeavePrompt(false);
    isSprintFinishedRef.current = false;
    setIsSprintFinished(false);
    setCurrentView('squad');
    const url = `/?team=${encodeURIComponent(sessionData.teamCode)}`;
    window.history.pushState({ view: 'squad', step: 'lobby', teamCode: sessionData.teamCode }, '', url);
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
    setArenaExitPrompt(false);
    setLobbyLeavePrompt(false);
    isSprintFinishedRef.current = false;
    setIsSprintFinished(false);
    setInviteTeamCode('');
    window.history.pushState({ view: 'squad', step: 'onboarding' }, '', '/');
  }, []);

  const handleStartSprint = useCallback((sprintData) => {
    isSprintFinishedRef.current = false;
    setIsSprintFinished(false);
    setArenaExitPrompt(false);
    setLobbyLeavePrompt(false);
    setSprintSession(sprintData);
    setCurrentView('squad');
    const activeTeam = teamSessionRef.current;
    const url = activeTeam?.teamCode
      ? `/?team=${encodeURIComponent(activeTeam.teamCode)}&arena=1`
      : '/?arena=1';
    window.history.pushState({ view: 'squad', step: 'arena', sessionId: sprintData.sessionId }, '', url);
  }, []);

  const handleReturnToLobbyFromSprint = useCallback(() => {
    setSprintSession(null);
    setArenaExitPrompt(false);
    isSprintFinishedRef.current = false;
    setIsSprintFinished(false);
    setCurrentView('squad');
    const activeTeam = teamSessionRef.current;
    const url = activeTeam?.teamCode ? `/?team=${encodeURIComponent(activeTeam.teamCode)}` : '/';
    window.history.pushState({ view: 'squad', step: 'lobby', teamCode: activeTeam?.teamCode }, '', url);
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

  return (
    <div className="min-h-screen bg-[#090c0a] text-[#e8ece3] flex flex-col relative selection:bg-[#2ee58f] selection:text-[#090c0a]">
      {/* Procedural Film Grain Overlay */}
      <GrainOverlay />

      {/* Top Banner Marquee */}
      <MarqueeTicker />

      {/* Main Top Header */}
      <header className="border-b-2 border-[#2ee58f]/20 bg-[#0f1411] px-4 py-3 flex items-center justify-between flex-wrap gap-3">
        <button
          type="button"
          onClick={() => navigateTo('squad')}
          className="flex items-center gap-3 text-left group cursor-pointer"
        >
          <div className="w-8 h-8 rounded bg-[#2ee58f] text-[#090c0a] font-display font-extrabold flex items-center justify-center text-lg border-2 border-[#090c0a] shadow-[2px_2px_0_#2ee58f] group-hover:-translate-y-0.5 transition-transform">
            M
          </div>
          <div>
            <span className="font-display font-extrabold text-lg tracking-tight text-[#e8ece3] group-hover:text-[#2ee58f] transition-colors">
              MATIKS
            </span>
            <span className="font-mono text-[10px] tracking-widest text-[#2ee58f] block -mt-1 uppercase">
              SPEED SPRINT HACKATHON
            </span>
          </div>
        </button>

        {/* Global Navigation Tabs */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={() => navigateTo('squad')}
            className={`font-mono text-xs px-2.5 py-1 border transition-all ${
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
            className={`font-mono text-xs px-2.5 py-1 border transition-all ${
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
            className={`font-mono text-xs px-2.5 py-1 border transition-all ${
              currentView === 'admin'
                ? 'border-[#ff6b5e] bg-[#ff6b5e] text-[#090c0a] font-bold shadow-[2px_2px_0_#090c0a]'
                : 'border-white/10 text-[#aab5ac] hover:text-[#e8ece3]'
            }`}
          >
            ADMIN ⚙️
          </button>

          {teamSession && currentView === 'squad' && (
            <span className="font-mono text-xs font-bold bg-[#ffe36e] text-[#090c0a] px-2 py-0.5 border border-[#090c0a] shadow-[2px_2px_0_#090c0a] ml-1">
              #{teamSession.teamCode}
            </span>
          )}
        </div>
      </header>

      {/* Main View Body */}
      <main className="flex-1 flex flex-col justify-center py-6">
        {currentView === 'leaderboard' ? (
          <LeaderboardView onReturnToLobby={() => navigateTo('squad')} />
        ) : currentView === 'admin' ? (
          <AdminView
            onReturnToLobby={() => navigateTo('squad')}
            onViewLeaderboard={() => navigateTo('leaderboard')}
          />
        ) : sprintSession ? (
          <ArenaView
            sessionId={sprintSession.sessionId}
            questions={sprintSession.questions}
            initialQuestionIndex={sprintSession.questionIndex || 0}
            initialScore={sprintSession.currentScore || 0}
            initialStreak={sprintSession.streak || 0}
            startedAt={sprintSession.startedAt}
            durationSeconds={sprintSession.durationSeconds || 120}
            initialIsPaused={Boolean(sprintSession.isPaused)}
            teamCode={teamSession?.teamCode}
            memberToken={teamSession?.memberToken}
            currentRoll={teamSession?.rollNumber}
            currentName={teamSession?.name}
            exitPromptRequested={arenaExitPrompt}
            onDismissExitPrompt={() => setArenaExitPrompt(false)}
            onSprintFinishedChange={(finished) => {
              isSprintFinishedRef.current = finished;
              setIsSprintFinished(finished);
            }}
            onReturnToLobby={handleReturnToLobbyFromSprint}
            onPlayAgain={handlePlayAgainFromSummary}
            onViewLeaderboard={() => navigateTo('leaderboard')}
          />
        ) : teamSession ? (
          /* Active Squad Lobby */
          <TeamLobby
            teamCode={teamSession.teamCode}
            memberToken={teamSession.memberToken}
            currentRoll={teamSession.rollNumber}
            leavePromptRequested={lobbyLeavePrompt}
            onDismissLeavePrompt={() => setLobbyLeavePrompt(false)}
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
          />
        )}
      </main>

      {/* Footer */}
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
    </div>
  );
}

export default App;
