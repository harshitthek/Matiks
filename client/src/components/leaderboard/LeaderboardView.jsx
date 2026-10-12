import React, { useState, useEffect, useRef, useCallback } from 'react';
import confetti from 'canvas-confetti';
import { RansomNote } from '../common/RansomNote.jsx';
import { WashiTape } from '../common/WashiTape.jsx';
import { RadarDot } from '../common/RadarDot.jsx';
import { TactileButton } from '../common/TactileButton.jsx';
import { PodiumCard } from './PodiumCard.jsx';
import { LeaderboardRow } from './LeaderboardRow.jsx';
import { connectLeaderboardStream } from '../../services/sse.js';
import { soundFx } from '../../services/soundFx.js';

/**
 * 4K Auditorium Stage Projector Leaderboard (Showcase Mode).
 * Receives live rank and team score updates over /api/sse/leaderboard.
 * Zero Question Leak Guarantee (ADR-08): Macro telemetry only.
 * Features automated & on-demand Auditorium Ceremony Podium Reveal (Phase 3).
 */
export function LeaderboardView({ onReturnToLobby }) {
  const [standings, setStandings] = useState([]);
  const [windowStatus, setWindowStatus] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(() => Date.now());

  // Ceremony Lifecycle: 'LIVE' | 'COUNTDOWN' | 'REVEAL_3RD' | 'REVEAL_2ND' | 'REVEAL_1ST' | 'CELEBRATING'
  const [ceremonyPhase, setCeremonyPhase] = useState('LIVE');
  const [countdown, setCountdown] = useState(3);
  const ceremonyTimerRef = useRef(null);
  const countdownIntervalRef = useRef(null);
  const confettiAnimationRef = useRef(null);
  const autoTriggeredRef = useRef(false);
  const previousWindowOpenRef = useRef(null);

  useEffect(() => {
    const sse = connectLeaderboardStream({
      onLeaderboardUpdate: (data) => {
        if (Array.isArray(data)) {
          setStandings(data);
          setLastUpdated(Date.now());
        }
      },
      onWindowStatus: (status) => {
        setWindowStatus(status);
      },
      onConnectionChange: (connected) => {
        setIsConnected(connected);
      }
    });

    return () => {
      sse.disconnect();
      if (ceremonyTimerRef.current) clearTimeout(ceremonyTimerRef.current);
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
      if (confettiAnimationRef.current) cancelAnimationFrame(confettiAnimationRef.current);
    };
  }, []);

  const launchConfetti = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (confettiAnimationRef.current) {
      cancelAnimationFrame(confettiAnimationRef.current);
      confettiAnimationRef.current = null;
    }
    const duration = 4.5 * 1000;
    const end = Date.now() + duration;

    const frame = () => {
      const left = Date.now();
      if (left >= end) {
        confettiAnimationRef.current = null;
        return;
      }
      confetti({
        particleCount: 35,
        angle: 60,
        spread: 60,
        origin: { x: 0.05, y: 0.75 },
        colors: ['#2ee58f', '#ffe36e', '#f5a623', '#ff6b5e']
      });
      confetti({
        particleCount: 35,
        angle: 120,
        spread: 60,
        origin: { x: 0.95, y: 0.75 },
        colors: ['#2ee58f', '#ffe36e', '#f5a623', '#ff6b5e']
      });
      confettiAnimationRef.current = requestAnimationFrame(frame);
    };
    confettiAnimationRef.current = requestAnimationFrame(frame);
  }, []);

  const startCeremony = useCallback(() => {
    if (ceremonyTimerRef.current) clearTimeout(ceremonyTimerRef.current);
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);

    setCeremonyPhase('COUNTDOWN');
    setCountdown(3);
    soundFx.playCountdownTick(false);

    let currentCount = 3;
    countdownIntervalRef.current = setInterval(() => {
      currentCount -= 1;
      if (currentCount > 0) {
        setCountdown(currentCount);
        soundFx.playCountdownTick(currentCount === 1);
      } else {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;

        setCeremonyPhase('REVEAL_3RD');
        soundFx.playCorrect();

        ceremonyTimerRef.current = setTimeout(() => {
          setCeremonyPhase('REVEAL_2ND');
          soundFx.playCorrect();

          ceremonyTimerRef.current = setTimeout(() => {
            setCeremonyPhase('REVEAL_1ST');
            soundFx.playPodiumFanfare();

            ceremonyTimerRef.current = setTimeout(() => {
              setCeremonyPhase('CELEBRATING');
              launchConfetti();
            }, 600);
          }, 1400);
        }, 1400);
      }
    }, 1000);
  }, [launchConfetti]);

  const resetCeremony = useCallback(() => {
    if (ceremonyTimerRef.current) clearTimeout(ceremonyTimerRef.current);
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    if (confettiAnimationRef.current) {
      cancelAnimationFrame(confettiAnimationRef.current);
      confettiAnimationRef.current = null;
    }
    setCeremonyPhase('LIVE');
    setCountdown(3);
  }, []);

  // Automatic ceremony trigger when contest window transitions to closed
  useEffect(() => {
    if (!windowStatus) return;
    if (windowStatus.isOpen === true) {
      autoTriggeredRef.current = false;
    } else if (
      previousWindowOpenRef.current === true &&
      windowStatus.isOpen === false &&
      !autoTriggeredRef.current &&
      standings.length > 0
    ) {
      autoTriggeredRef.current = true;
      startCeremony();
    }
    previousWindowOpenRef.current = windowStatus.isOpen;
  }, [windowStatus, standings.length, startCeremony]);

  const top1 = standings.find((s) => s.rank === 1);
  const top2 = standings.find((s) => s.rank === 2);
  const top3 = standings.find((s) => s.rank === 3);
  const rest = standings.filter((s) => s.rank > 3);

  const isCeremonyActive = ceremonyPhase !== 'LIVE';
  const is3rdRevealed = !isCeremonyActive || ['REVEAL_3RD', 'REVEAL_2ND', 'REVEAL_1ST', 'CELEBRATING'].includes(ceremonyPhase);
  const is2ndRevealed = !isCeremonyActive || ['REVEAL_2ND', 'REVEAL_1ST', 'CELEBRATING'].includes(ceremonyPhase);
  const is1stRevealed = !isCeremonyActive || ['REVEAL_1ST', 'CELEBRATING'].includes(ceremonyPhase);

  return (
    <div className="w-full max-w-6xl mx-auto px-4 py-6 md:py-8">
      {/* Top Stage Header */}
      <div className="cyber-card cyber-card-butter p-6 md:p-8 relative mb-8 text-center">
        <WashiTape color="signal" rotation="-2deg" className="-top-3 left-8" />
        <WashiTape color="ember" rotation="3deg" className="-top-3 right-8" />

        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <RadarDot status={isConnected ? 'online' : 'offline'} />
            <span className="font-mono text-xs font-bold tracking-widest text-[#2ee58f] uppercase">
              {isConnected ? 'LIVE 4K SSE STREAM • 0-LEAK AUDIT' : 'STREAM RECONNECTING...'}
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {standings.length > 0 && (
              <>
                {ceremonyPhase === 'LIVE' ? (
                  <TactileButton
                    variant="butter"
                    onClick={startCeremony}
                    className="px-3 py-1 text-xs"
                    title="Launch stage ceremony podium reveal"
                  >
                    🏆 CEREMONY SHOWCASE
                  </TactileButton>
                ) : (
                  <>
                    <TactileButton
                      variant="butter"
                      onClick={startCeremony}
                      className="px-3 py-1 text-xs"
                      title="Replay podium ceremony reveal"
                    >
                      🔄 REPLAY
                    </TactileButton>
                    <TactileButton
                      variant="ghost"
                      onClick={resetCeremony}
                      className="px-2.5 py-1 text-xs"
                      title="Return to standard live leaderboard view"
                    >
                      ✕ LIVE VIEW
                    </TactileButton>
                  </>
                )}
              </>
            )}

            {onReturnToLobby && (
              <TactileButton
                variant="signal"
                onClick={onReturnToLobby}
                className="px-3.5 py-1 text-xs"
              >
                ← RETURN TO SQUAD
              </TactileButton>
            )}
          </div>
        </div>

        <div className="mb-3">
          <RansomNote text="TOURNAMENT PODIUM" size="xl" />
        </div>

        <p className="font-mono text-xs md:text-sm text-[#ffe36e] uppercase tracking-wider font-bold">
          LIVE SQUAD STANDINGS • MATIKS HACKATHON ARENA
        </p>

        {/* Contest Window Status Pill */}
        {windowStatus && (
          <div className="mt-4 inline-flex items-center gap-2 px-3.5 py-1 bg-[#090c0a] border border-[#2ee58f]/40 font-mono text-xs">
            <span className="text-[#aab5ac]">CONTEST WINDOW:</span>
            <span className={`font-bold ${windowStatus.isOpen ? 'text-[#2ee58f]' : 'text-[#ff6b5e]'}`}>
              {windowStatus.isOpen ? 'ACTIVE / OPEN ⚡' : 'CLOSED ⛔'}
            </span>
            {windowStatus.announcementTicker && (
              <>
                <span className="text-[#aab5ac]">•</span>
                <span className="text-[#ffe36e] truncate max-w-xs">{windowStatus.announcementTicker}</span>
              </>
            )}
          </div>
        )}

        {/* Ceremony Countdown Banner */}
        {ceremonyPhase === 'COUNTDOWN' && (
          <div className="mt-6 py-6 px-4 bg-[#090c0a] border-2 border-[#ffe36e] shadow-[4px_4px_0_#ffe36e]">
            <span className="font-mono text-xs uppercase tracking-widest text-[#ffe36e] font-bold block mb-2">
              § AUDITORIUM CEREMONY REVEAL INCOMING
            </span>
            <div className="font-display font-black text-6xl md:text-8xl text-[#2ee58f]">
              {countdown}
            </div>
            <span className="font-mono text-xs text-[#aab5ac] tracking-wider block mt-2">
              LOCKING IN SQUAD CHAMPIONS...
            </span>
          </div>
        )}

        {/* Ceremony Celebration Banner */}
        {ceremonyPhase === 'CELEBRATING' && top1 && (
          <div className="mt-6 py-3.5 px-6 bg-[#ffe36e]/15 border-2 border-[#ffe36e] shadow-[4px_4px_0_#ffe36e]">
            <span className="font-mono text-xs uppercase tracking-widest text-[#ffe36e] font-black block mb-1">
              🎉 2026 MATIKS HACKATHON TOURNAMENT CHAMPION
            </span>
            <span className="font-display font-black text-xl md:text-2xl text-[#e8ece3]">
              {top1.teamName} #{top1.teamCode} • {Math.round(top1.teamAverageScore || 0).toLocaleString()} PTS
            </span>
          </div>
        )}
      </div>

      {/* Top 3 Podium Showcase */}
      {standings.length > 0 ? (
        <div className="mb-10">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end">
            {/* Rank 2 (Left) */}
            <div className="order-2 md:order-1">
              {top2 ? (
                <PodiumCard entry={top2} position={2} isRevealed={is2ndRevealed} />
              ) : (
                <div className="border-2 border-dashed border-white/10 p-8 text-center font-mono text-xs text-[#aab5ac]">
                  [ 2ND PLACE VACANT ]
                </div>
              )}
            </div>

            {/* Rank 1 (Center Elevated) */}
            <div className="order-1 md:order-2">
              {top1 ? (
                <PodiumCard entry={top1} position={1} isRevealed={is1stRevealed} />
              ) : (
                <div className="border-2 border-dashed border-[#ffe36e]/30 p-10 text-center font-mono text-xs text-[#ffe36e]">
                  [ 1ST PLACE VACANT ]
                </div>
              )}
            </div>

            {/* Rank 3 (Right) */}
            <div className="order-3 md:order-3">
              {top3 ? (
                <PodiumCard entry={top3} position={3} isRevealed={is3rdRevealed} />
              ) : (
                <div className="border-2 border-dashed border-white/10 p-8 text-center font-mono text-xs text-[#aab5ac]">
                  [ 3RD PLACE VACANT ]
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* Empty State */
        <div className="cyber-card p-12 text-center my-8">
          <span className="text-4xl block mb-3">🏁</span>
          <h3 className="font-display font-extrabold text-xl text-[#e8ece3] mb-2">
            AWAITING SQUAD REGISTRATION
          </h3>
          <p className="font-mono text-xs text-[#aab5ac] max-w-md mx-auto">
            No squad scores recorded yet. When squads launch their 2-minute sprints,
            live macro-telemetry will stream to this auditorium board automatically.
          </p>
        </div>
      )}

      {/* Ranks 4+ Standings List */}
      {rest.length > 0 && (
        <div className="cyber-card p-6 mb-8">
          <div className="flex items-center justify-between pb-3 mb-4 border-b border-white/10">
            <h3 className="font-mono text-xs uppercase tracking-widest text-[#e8ece3] font-bold">
              STANDINGS ({rest.length} SQUADS)
            </h3>
            <span className="font-mono text-[10px] text-[#aab5ac]">
              UPDATED {new Date(lastUpdated).toLocaleTimeString()}
            </span>
          </div>

          <div className="space-y-2">
            {rest.map((entry) => (
              <LeaderboardRow key={entry.teamCode} entry={entry} />
            ))}
          </div>
        </div>
      )}

      {/* Zero Question Leak Notice */}
      <div className="text-center font-mono text-[11px] text-[#aab5ac]/60 py-2">
        <span>🛡️ SECURE MACRO-TELEMETRY: EQUATIONS AND INDIVIDUAL SUBMISSIONS ARE ISOLATED FROM STAGE BROADCASTS.</span>
      </div>
    </div>
  );
}
