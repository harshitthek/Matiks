import React, { useState, useEffect, useCallback } from 'react';
import { GrainOverlay } from './components/common/GrainOverlay.jsx';
import { MarqueeTicker } from './components/common/MarqueeTicker.jsx';
import { WashiTape } from './components/common/WashiTape.jsx';
import { TeamOnboarding } from './components/lobby/TeamOnboarding.jsx';
import { TeamLobby } from './components/lobby/TeamLobby.jsx';
import { TactileButton } from './components/common/TactileButton.jsx';

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
          /* Arena Phase 4 Preparation Screen */
          <div className="w-full max-w-2xl mx-auto px-4 py-8">
            <div className="cyber-card cyber-card-signal p-8 text-center relative">
              <WashiTape color="signal" rotation="-2deg" className="-top-3 -right-4" />
              <div className="font-mono text-xs text-[#2ee58f] font-bold tracking-widest uppercase mb-2">
                § 02 // SPRINT ARENA READY
              </div>
              <h2 className="font-display font-extrabold text-3xl md:text-5xl text-[#e8ece3] mb-4">
                SPRINT LAUNCHED!
              </h2>
              <p className="font-mono text-sm text-[#ffe36e] mb-6">
                Session ID: {sprintSession.sessionId}
              </p>
              <div className="border-2 border-[#2ee58f]/30 bg-[#090c0a] p-4 text-left font-mono text-xs text-[#aab5ac] space-y-2 mb-8">
                <div>PLAYER: <strong className="text-[#e8ece3]">{teamSession?.name}</strong> ({teamSession?.rollNumber})</div>
                <div>QUESTIONS: <strong className="text-[#2ee58f]">{sprintSession.questions?.length || 15} Qs Loaded</strong></div>
                <div>TIMELIMIT: <strong className="text-[#ffe36e]">120.0s (2 Minutes)</strong></div>
                <div>TACTILE INPUT: <strong className="text-[#2ee58f]">Universal Explicit Submit Enabled</strong></div>
              </div>
              <TactileButton
                variant="signal"
                onClick={() => setSprintSession(null)}
                className="w-full py-3.5 text-sm"
              >
                RETURN TO SQUAD LOBBY
              </TactileButton>
            </div>
          </div>
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
