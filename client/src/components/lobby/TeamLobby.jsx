import React, { useState, useEffect, useCallback, useRef } from 'react';
import { TactileButton } from '../common/TactileButton.jsx';
import { WashiTape } from '../common/WashiTape.jsx';
import { RadarDot } from '../common/RadarDot.jsx';
import { CountdownOverlay } from './CountdownOverlay.jsx';
import { toggleReady, getTeamSnapshot } from '../../services/api.js';
import { connectTeamStream } from '../../services/sse.js';

/**
 * Team & Student Lobby panel (Showcase Mode).
 * Displays live member roster, connection radar pings, atomic ready lock,
 * and synchronized 3-2-1 countdown overlay.
 */
export function TeamLobby({
  teamCode,
  memberToken,
  currentRoll,
  onStartSprint,
  onLeaveTeam
}) {
  const [snapshot, setSnapshot] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [readyLoading, setReadyLoading] = useState(false);
  const [error, setError] = useState(null);
  const [countdown, setCountdown] = useState(null); // { secondsRemaining, message }
  const copyTimerRef = useRef(null);

  // Clear copy timer on unmount
  useEffect(() => {
    return () => {
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  // Initial Snapshot Fetch
  useEffect(() => {
    let isMounted = true;
    getTeamSnapshot(teamCode, memberToken)
      .then((data) => {
        if (isMounted) setSnapshot(data);
      })
      .catch((err) => {
        if (!isMounted) return;
        if (err.status === 401 || err.status === 404) {
          console.warn('[Lobby] Stale or invalid session detected, resetting to onboarding:', err.message);
          onLeaveTeam?.();
        } else {
          setError(err.message || 'Failed to fetch team details');
        }
      });
    return () => { isMounted = false; };
  }, [teamCode, memberToken, onLeaveTeam]);

  // Connect SSE Team Stream
  useEffect(() => {
    let sprintLaunchTimer = null;
    const sse = connectTeamStream(teamCode, memberToken, {
      onConnectionChange: (connected) => {
        setIsConnected(connected);
      },
      onSnapshot: (data) => {
        setSnapshot(data);
        if (data?.status !== 'COUNTDOWN') {
          setCountdown(null);
        }
      },
      onMemberReady: (data) => {
        setSnapshot((prev) => {
          if (!prev) return prev;
          const updatedMembers = prev.members.map((m) =>
            m.rollNumber === data.rollNumber ? { ...m, isReady: data.isReady } : m
          );
          return {
            ...prev,
            members: updatedMembers,
            allReady: data.allReady,
            status: data.status
          };
        });
      },
      onCountdownTick: (data) => {
        setCountdown({
          secondsRemaining: data.secondsRemaining,
          message: data.message
        });
      },
      onSprintStart: (data) => {
        const sessionId = data.sessions?.[currentRoll];
        if (!sessionId) {
          setCountdown(null);
          setError('Failed to launch sprint: Missing player session identifier.');
          return;
        }

        setCountdown({ secondsRemaining: 0, message: 'START!' });
        // Hand off to Arena view with individual player's assigned sessionId
        const playerQuestions = data.questionsByRollNumber?.[currentRoll];
        if (sprintLaunchTimer) clearTimeout(sprintLaunchTimer);
        sprintLaunchTimer = setTimeout(() => {
          onStartSprint({
            sessionId,
            questions: playerQuestions,
            startedAt: data.startedAt,
            durationSeconds: data.durationSeconds
          });
        }, 500);
      },
      onSprintResume: (data) => {
        // Player reconnected mid-sprint
        onStartSprint({
          sessionId: data.sessionId,
          questions: data.questions,
          currentScore: data.currentScore,
          streak: data.streak,
          expiresAt: data.expiresAt,
          isPaused: data.isPaused,
          isResume: true
        });
      },
      onSprintError: (data) => {
        setCountdown(null);
        setError(data.message || 'Sprint launch failed.');
      },
      onError: (err) => {
        console.warn('[Lobby] SSE connection error:', err);
      }
    });

    return () => {
      if (sprintLaunchTimer) {
        clearTimeout(sprintLaunchTimer);
      }
      sse.disconnect();
    };
  }, [teamCode, memberToken, currentRoll, onStartSprint]);

  // Copy team code to clipboard
  const handleCopyCode = useCallback(() => {
    if (!navigator?.clipboard?.writeText) {
      setError(`Clipboard unavailable. Share squad code manually: ${teamCode}`);
      return;
    }
    navigator.clipboard
      .writeText(teamCode)
      .then(() => {
        setCopiedCode(true);
        if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
        copyTimerRef.current = setTimeout(() => setCopiedCode(false), 2000);
      })
      .catch(() => {
        setError(`Failed to copy code. Share squad code manually: ${teamCode}`);
      });
  }, [teamCode]);

  // Toggle ready status
  const currentMember = snapshot?.members?.find((m) => m.rollNumber === currentRoll);
  const isCurrentlyReady = currentMember?.isReady ?? false;

  const handleToggleReady = async () => {
    setReadyLoading(true);
    setError(null);
    try {
      await toggleReady(teamCode, currentRoll, !isCurrentlyReady, memberToken);
    } catch (err) {
      setError(err.message || 'Failed to update ready state.');
    } finally {
      setReadyLoading(false);
    }
  };

  const members = snapshot?.members || [];
  const activeMembers = members.filter((m) => !m.isExcused);
  const readyCount = activeMembers.filter((m) => m.isReady).length;
  const isRosterFull = snapshot ? members.length >= snapshot.targetSize : false;
  const isContestWindowOpen = snapshot?.contestWindow?.isOpen ?? true;

  return (
    <div className="w-full max-w-3xl mx-auto px-4 py-8">
      {/* Synchronized 3-2-1 Countdown Overlay */}
      {countdown !== null && (
        <CountdownOverlay
          secondsRemaining={countdown.secondsRemaining}
          message={countdown.message}
        />
      )}

      {/* Top Telemetry Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6 pb-4 border-b-2 border-[#2ee58f]/20">
        <div className="flex items-center gap-3">
          <RadarDot
            status={isConnected ? 'online' : 'amber'}
            label={isConnected ? 'SSE STREAM LIVE' : 'CONNECTING...'}
          />
          <span className="text-[#aab5ac]/40">|</span>
          <span className="font-mono text-xs text-[#aab5ac] uppercase tracking-wider">
            § 01 // TEAM LOBBY
          </span>
        </div>

        <button
          type="button"
          onClick={onLeaveTeam}
          className="font-mono text-xs text-[#aab5ac] hover:text-[#ff6b5e] uppercase tracking-wider transition-colors underline underline-offset-4"
        >
          [LEAVE SQUAD]
        </button>
      </div>

      {/* Squad Header Card */}
      <div className="cyber-card p-6 md:p-8 mb-6 relative">
        <WashiTape color="butter" rotation="-3deg" className="-top-3 -right-4" />

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
          <div>
            <span className="font-mono text-xs tracking-widest text-[#2ee58f] uppercase font-bold">
              SQUAD NAME
            </span>
            <h1 className="font-display font-extrabold text-2xl md:text-4xl text-[#e8ece3] tracking-tight">
              {snapshot?.teamName || 'Loading Squad...'}
            </h1>
          </div>

          {/* Squad Code Pill with Copy */}
          <div className="flex items-center gap-2">
            <div className="font-mono text-sm md:text-base font-bold bg-[#090c0a] border-2 border-[#2ee58f] px-4 py-2 text-[#2ee58f] tracking-widest shadow-[3px_3px_0_#2ee58f]">
              #{teamCode}
            </div>
            <button
              type="button"
              onClick={handleCopyCode}
              className="py-2 px-3 border-2 border-[#090c0a] bg-[#ffe36e] text-[#090c0a] font-mono font-bold text-xs uppercase tracking-wider shadow-[2px_2px_0_#090c0a] hover:translate-x-0.5 transition-transform"
            >
              {copiedCode ? 'COPIED!' : 'COPY'}
            </button>
          </div>
        </div>

        {/* Contest Window Status Banner */}
        <div className="flex items-center justify-between p-3 border-2 border-[#090c0a] bg-[#090c0a]/60 text-xs font-mono">
          <span className="text-[#aab5ac]">CONTEST WINDOW:</span>
          {isContestWindowOpen ? (
            <span className="text-[#2ee58f] font-bold tracking-wider flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#2ee58f] animate-pulse" />
              WINDOW OPEN // READY TO RACE
            </span>
          ) : (
            <span className="text-[#f5a623] font-bold tracking-wider flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#f5a623]" />
              WINDOW CLOSED // WAITING FOR ORGANIZER
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="border-2 border-[#ff6b5e] bg-[#ff6b5e]/15 p-4 text-[#ff6b5e] font-mono text-xs tracking-wide mb-6">
          <span className="font-bold">ALERT:</span> {error}
        </div>
      )}

      {/* Roster Card */}
      <div className="cyber-card p-6 md:p-8 mb-6 relative">
        <WashiTape color="pink" rotation="2deg" className="-top-3 -left-4" />

        <div className="flex items-center justify-between pb-4 mb-4 border-b border-[#2ee58f]/20">
          <h2 className="font-mono text-sm tracking-widest text-[#e8ece3] uppercase font-bold">
            SQUAD ROSTER ({members.length} / {snapshot?.targetSize || 3} SQUAD CAPACITY)
          </h2>
          <span className="font-mono text-xs text-[#aab5ac]">
            STATUS: <strong className="text-[#2ee58f]">{snapshot?.status || 'LOBBY'}</strong>
          </span>
        </div>

        {/* Members List */}
        <div className="space-y-3">
          {members.map((member) => {
            const isMe = member.rollNumber === currentRoll;
            return (
              <div
                key={member.rollNumber}
                className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 border-2 transition-all ${
                  isMe
                    ? 'border-[#2ee58f] bg-[#2ee58f]/10 shadow-[3px_3px_0_#2ee58f]'
                    : 'border-[#2ee58f]/20 bg-[#090c0a]'
                }`}
              >
                <div className="flex items-center gap-3">
                  <RadarDot status={member.connected ? 'online' : 'offline'} />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-display font-bold text-base text-[#e8ece3]">
                        {member.name} {isMe && <span className="text-[#2ee58f] font-mono text-xs">(YOU)</span>}
                      </span>
                      {member.isCaptain && (
                        <span className="bg-[#ffe36e] text-[#090c0a] font-mono font-bold text-[10px] uppercase px-1.5 py-0.5 border border-[#090c0a]">
                          CAPTAIN
                        </span>
                      )}
                      {member.isClubMember && (
                        <span className="bg-[#2ee58f]/20 text-[#2ee58f] font-mono font-bold text-[10px] uppercase px-1.5 py-0.5 border border-[#2ee58f] tracking-wider">
                          🛡️ UFC MEMBER
                        </span>
                      )}
                      {member.isExcused && (
                        <span className="bg-[#ff6b5e]/20 text-[#ff6b5e] font-mono font-bold text-[10px] uppercase px-1.5 py-0.5 border border-[#ff6b5e]">
                          EXCUSED
                        </span>
                      )}
                    </div>
                    <span className="font-mono text-xs text-[#c7b3ff] tracking-wider">
                      ID: {member.rollNumber}
                    </span>
                  </div>
                </div>

                {/* Ready Status Pill */}
                <div className="flex items-center gap-2 self-start sm:self-auto">
                  {member.isExcused ? (
                    <span className="font-mono text-xs px-3 py-1 bg-[#090c0a] border border-[#aab5ac]/30 text-[#aab5ac]">
                      EXCUSED FROM SPRINT
                    </span>
                  ) : member.isReady ? (
                    <span className="font-mono text-xs font-bold px-3 py-1 bg-[#2ee58f] text-[#090c0a] border border-[#090c0a] shadow-[2px_2px_0_#090c0a] flex items-center gap-1">
                      ✓ READY LOCKED
                    </span>
                  ) : (
                    <span className="font-mono text-xs px-3 py-1 bg-[#090c0a] border border-[#f5a623] text-[#f5a623] flex items-center gap-1">
                      ⏳ NOT READY
                    </span>
                  )}
                </div>
              </div>
            );
          })}

          {/* Missing Slots */}
          {snapshot && members.length < snapshot.targetSize && (
            <div className="p-4 border-2 border-dashed border-[#2ee58f]/30 bg-[#090c0a]/40 text-center font-mono text-xs text-[#aab5ac]">
              WAITING FOR {snapshot.targetSize - members.length} MORE TEAMMATE(S) TO JOIN WITH CODE <strong className="text-[#2ee58f]">#{teamCode}</strong>
            </div>
          )}
        </div>
      </div>

      {/* Atomic Ready Lock Notice */}
      <div className="border-2 border-[#ffe36e] bg-[#ffe36e]/10 p-4 mb-6 shadow-[4px_4px_0_#090c0a]">
        <div className="flex items-start gap-3">
          <span className="text-xl leading-none">⚠️</span>
          <div>
            <h3 className="font-mono font-bold text-xs text-[#ffe36e] uppercase tracking-wider mb-1">
              ATOMIC SYNCHRONIZED START GATE
            </h3>
            <p className="font-body text-xs text-[#e8ece3] leading-relaxed">
              Every squad member must be logged in and in the <strong>"READY"</strong> state before the sprint can launch ({readyCount} of {activeMembers.length} ready).
              All teammates solve individually at the exact same time. The team score is the <strong>AVERAGE</strong> of all members' scores!
            </p>
          </div>
        </div>
      </div>

      {/* Big Tactile Action Button */}
      <div className="text-center">
        {!snapshot ? (
          <div className="p-4 border-2 border-[#2ee58f]/40 bg-[#090c0a] text-[#2ee58f] font-mono text-xs font-bold tracking-wider animate-pulse">
            CONNECTING TO SQUAD LOBBY TELEMETRY...
          </div>
        ) : !isRosterFull ? (
          <div className="p-4 border-2 border-[#f5a623] bg-[#f5a623]/15 text-[#f5a623] font-mono text-xs font-bold tracking-wider">
            SQUAD INCOMPLETE: SHARE CODE #{teamCode} WITH TEAMMATES TO FILL ROSTER ({members.length}/{snapshot.targetSize})
          </div>
        ) : !isContestWindowOpen ? (
          <div className="p-4 border-2 border-[#f5a623] bg-[#f5a623]/15 text-[#f5a623] font-mono text-xs font-bold tracking-wider">
            CONTEST WINDOW CURRENTLY CLOSED: WAIT FOR HACKATHON ORGANIZER TO OPEN THE SPRINT WINDOW
          </div>
        ) : (
          <TactileButton
            variant={isCurrentlyReady ? 'ghost' : 'signal'}
            onClick={handleToggleReady}
            disabled={readyLoading}
            className="w-full py-4 text-base md:text-lg shadow-[6px_6px_0_#090c0a]"
          >
            {readyLoading
              ? 'COMMUNICATING WITH SQUAD...'
              : isCurrentlyReady
              ? '✓ READY LOCKED (CLICK TO CANCEL)'
              : 'I AM READY NOW! ↵'}
          </TactileButton>
        )}
      </div>
    </div>
  );
}
