import React, { useState, useEffect, useCallback } from 'react';
import { GrainOverlay } from './components/common/GrainOverlay.jsx';
import { MarqueeTicker } from './components/common/MarqueeTicker.jsx';
import { TeamOnboarding } from './components/lobby/TeamOnboarding.jsx';
import { TeamLobby } from './components/lobby/TeamLobby.jsx';
import { ArenaView } from './components/arena/ArenaView.jsx';

const SESSION_STORAGE_KEY = 'matiks_squad_session';

export function App() {
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

  // Sync session state to localStorage
  useEffect(() => {
    try {
      if (teamSession) {
        localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(teamSession));
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
  }, []);

  const handleLeaveTeam = useCallback(() => {
    setTeamSession(null);
    setSprintSession(null);
  }, []);

  const handleStartSprint = useCallback((sprintData) => {
    setSprintSession(sprintData);
  }, []);

  return (
    <div className="min-h-screen bg-[#090c0a] text-[#e8ece3] flex flex-col relative selection:bg-[#2ee58f] selection:text-[#090c0a]">
      {/* Procedural Film Grain Overlay */}
      <GrainOverlay />

      {/* Top Banner Marquee */}
      <MarqueeTicker />

      {/* Main Top Header */}
      <header className="border-b-2 border-[#2ee58f]/20 bg-[#0f1411] px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-[#2ee58f] text-[#090c0a] font-display font-extrabold flex items-center justify-center text-lg border-2 border-[#090c0a] shadow-[2px_2px_0_#2ee58f]">
            M
          </div>
          <div>
            <span className="font-display font-extrabold text-lg tracking-tight text-[#e8ece3]">
              MATIKS
            </span>
            <span className="font-mono text-[10px] tracking-widest text-[#2ee58f] block -mt-1 uppercase">
              SPEED SPRINT HACKATHON
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden sm:inline-block font-mono text-[11px] bg-[#090c0a] border border-[#2ee58f]/40 px-2.5 py-1 text-[#2ee58f] tracking-widest uppercase">
            USAR-FOSS // UFC EDITION
          </span>
          {teamSession && (
            <span className="font-mono text-xs font-bold bg-[#ffe36e] text-[#090c0a] px-2 py-0.5 border border-[#090c0a] shadow-[2px_2px_0_#090c0a]">
              #{teamSession.teamCode}
            </span>
          )}
        </div>
      </header>

      {/* Main View Body */}
      <main className="flex-1 flex flex-col justify-center py-6">
        {sprintSession ? (
          <ArenaView
            sessionId={sprintSession.sessionId}
            questions={sprintSession.questions}
            startedAt={sprintSession.startedAt}
            durationSeconds={sprintSession.durationSeconds || 120}
            teamCode={teamSession?.teamCode}
            memberToken={teamSession?.memberToken}
            currentRoll={teamSession?.rollNumber}
            currentName={teamSession?.name}
            onReturnToLobby={() => setSprintSession(null)}
          />
        ) : teamSession ? (
          /* Active Squad Lobby */
          <TeamLobby
            teamCode={teamSession.teamCode}
            memberToken={teamSession.memberToken}
            currentRoll={teamSession.rollNumber}
            onStartSprint={handleStartSprint}
            onLeaveTeam={handleLeaveTeam}
          />
        ) : (
          /* Squad Onboarding */
          <TeamOnboarding onJoinedTeam={handleJoinedTeam} />
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
