import React, { useState, useEffect, useCallback, useRef } from 'react';
import { TactileButton } from '../common/TactileButton.jsx';
import { WashiTape } from '../common/WashiTape.jsx';
import { RadarDot } from '../common/RadarDot.jsx';
import { FlowerSticker } from '../common/FlowerSticker.jsx';
import { FossForgeBadge } from '../common/FossForgeBadge.jsx';
import { CountdownOverlay } from './CountdownOverlay.jsx';
import { toggleReady, getTeamSnapshot, resetTeamSprint } from '../../services/api.js';
import { connectTeamStream } from '../../services/sse.js';

/**
 * Team & Student Lobby panel (Showcase Mode).
 * Displays live member roster, connection radar pings, atomic ready lock,
 * post-sprint rematch controls, and synchronized 3-2-1 countdown overlay.
 */
export function TeamLobby({
  teamCode,
  memberToken,
  currentRoll,
  suppressedResumeSessionId = null,
  leavePromptRequested = false,
  onDismissLeavePrompt,
  onStartSprint,
  onLeaveTeam,
  onViewLeaderboard
}) {
  const [snapshot, setSnapshot] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [readyLoading, setReadyLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [resumableSprint, setResumableSprint] = useState(null);
  const [error, setError] = useState(null);
  const [countdown, setCountdown] = useState(null); // { secondsRemaining, message }
  const [flashBanner, setFlashBanner] = useState(null);
  const copyTimerRef = useRef(null);
  const linkTimerRef = useRef(null);
  const suppressedResumeRef = useRef(suppressedResumeSessionId);

  useEffect(() => {
    suppressedResumeRef.current = suppressedResumeSessionId;
  }, [suppressedResumeSessionId]);

  // Clear copy timers on unmount
  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      if (linkTimerRef.current) clearTimeout(linkTimerRef.current);
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
          onLeaveTeam?.({ forceLocal: true });
        } else {
          setError(err.message || 'Failed to fetch team details');
        }
      });
    return () => {
      isMounted = false;
    };
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
        setError(null);
        if (data?.status !== 'COUNTDOWN') {
          setCountdown(null);
        }
        if (data?.status !== 'IN_SPRINT') {
          setResumableSprint(null);
        } else {
          const nextPaused = Boolean(data?.isPaused);
          setResumableSprint((prev) => {
            if (!prev || prev.isPaused === nextPaused) return prev;
            const now = Date.now();
            if (nextPaused) {
              const elapsed = Math.max(0, now - (prev.capturedAt || prev.startedAt || now));
              const updatedRemaining = Math.max(0, (prev.initialRemainingMs ?? prev.durationSeconds * 1000) - elapsed);
              return {
                ...prev,
                isPaused: true,
                capturedAt: now,
                initialRemainingMs: updatedRemaining
              };
            }
            const remaining = prev.initialRemainingMs ?? prev.durationSeconds * 1000;
            return {
              ...prev,
              isPaused: false,
              capturedAt: now,
              initialRemainingMs: remaining,
              expiresAt: now + remaining
            };
          });
        }
      },
      onRoomPaused: () => {
        const now = Date.now();
        setResumableSprint((prev) => {
          if (!prev || prev.isPaused) return prev;
          const elapsed = Math.max(0, now - (prev.capturedAt || prev.startedAt || now));
          const updatedRemaining = Math.max(0, (prev.initialRemainingMs ?? prev.durationSeconds * 1000) - elapsed);
          return {
            ...prev,
            isPaused: true,
            capturedAt: now,
            initialRemainingMs: updatedRemaining
          };
        });
      },
      onRoomResumed: () => {
        const now = Date.now();
        setResumableSprint((prev) => {
          if (!prev || !prev.isPaused) return prev;
          const remaining = prev.initialRemainingMs ?? prev.durationSeconds * 1000;
          return {
            ...prev,
            isPaused: false,
            capturedAt: now,
            initialRemainingMs: remaining,
            expiresAt: now + remaining
          };
        });
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
            status: data.status || prev.status
          };
        });
      },
      onTeammateProgress: (data) => {
        setSnapshot((prev) => {
          if (!prev || !Array.isArray(prev.members)) return prev;
          const updatedMembers = prev.members.map((m) =>
            m.rollNumber === data.rollNumber
              ? {
                  ...m,
                  completedQuestions: data.questionIndex,
                  individualScore: data.currentScore
                }
              : m
          );
          return {
            ...prev,
            members: updatedMembers
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
        const playerQuestions = data.questionsByRollNumber?.[currentRoll];
        if (sprintLaunchTimer) clearTimeout(sprintLaunchTimer);
        sprintLaunchTimer = setTimeout(() => {
          onStartSprint({
            sessionId,
            questions: playerQuestions,
            questionIndex: 0,
            currentScore: 0,
            streak: 0,
            maxStreak: 0,
            submissions: [],
            startedAt: data.startedAt || Date.now(),
            durationSeconds: data.durationSeconds || 120
          });
        }, 500);
      },
      onSprintResume: (data) => {
        const now = Date.now();
        const remainingMs =
          typeof data.remainingMs === 'number'
            ? data.remainingMs
            : data.expiresAt
            ? data.expiresAt - now
            : 120000;
        if (!data.isPaused && remainingMs <= 0) {
          return;
        }
        const remainingSec = Math.max(1, Math.ceil(remainingMs / 1000));
        const resumePayload = {
          sessionId: data.sessionId,
          questions: data.questions,
          questionIndex: data.questionIndex ?? 0,
          currentScore: data.currentScore ?? 0,
          streak: data.streak ?? 0,
          maxStreak: data.maxStreak ?? data.streak ?? 0,
          submissions: Array.isArray(data.submissions) ? data.submissions : [],
          startedAt: now,
          capturedAt: now,
          initialRemainingMs: remainingMs,
          durationSeconds: remainingSec,
          expiresAt: data.expiresAt,
          isPaused: Boolean(data.isPaused),
          isResume: true
        };
        setResumableSprint(resumePayload);
        if (suppressedResumeRef.current && suppressedResumeRef.current === data.sessionId) {
          return;
        }
        onStartSprint(resumePayload);
      },
      onSprintError: (data) => {
        setCountdown(null);
        setError(data.message || 'Sprint launch failed.');
      },
      onFlashAnnouncement: (announcement) => {
        setFlashBanner(announcement);
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

  const copyTextWithFallback = useCallback(async (text) => {
    if (navigator?.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // Fall through to textarea execCommand fallback
      }
    }
    if (typeof document !== 'undefined') {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      try {
        textarea.select();
        const copied = document.execCommand('copy');
        if (copied) return true;
      } catch {
        // Ignore execCommand errors
      } finally {
        document.body.removeChild(textarea);
      }
    }
    return false;
  }, []);

  // Copy team code to clipboard
  const handleCopyCode = useCallback(() => {
    copyTextWithFallback(teamCode)
      .then((ok) => {
        if (!ok) {
          setError(`Clipboard unavailable. Share squad code manually: ${teamCode}`);
          return;
        }
        setCopiedCode(true);
        if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
        copyTimerRef.current = setTimeout(() => setCopiedCode(false), 2000);
      })
      .catch(() => {
        setError(`Failed to copy code. Share squad code manually: ${teamCode}`);
      });
  }, [teamCode, copyTextWithFallback]);

  // Copy invite URL to clipboard
  const handleCopyInviteLink = useCallback(() => {
    const inviteUrl = `${window.location.origin}/?team=${encodeURIComponent(teamCode)}`;
    copyTextWithFallback(inviteUrl)
      .then((ok) => {
        if (!ok) {
          setError(`Share invite link manually: ${inviteUrl}`);
          return;
        }
        setCopiedLink(true);
        if (linkTimerRef.current) clearTimeout(linkTimerRef.current);
        linkTimerRef.current = setTimeout(() => setCopiedLink(false), 2000);
      })
      .catch(() => {
        setError(`Share invite link manually: ${inviteUrl}`);
      });
  }, [teamCode, copyTextWithFallback]);

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

  const handlePlayAgain = async () => {
    setResetLoading(true);
    setError(null);
    try {
      const res = await resetTeamSprint(teamCode, currentRoll, memberToken);
      if (res?.snapshot) {
        setSnapshot(res.snapshot);
      }
    } catch (err) {
      setError(err.message || 'Failed to reset squad for new sprint.');
    } finally {
      setResetLoading(false);
    }
  };

  const handleCancelLeave = () => {
    setShowLeaveConfirm(false);
    onDismissLeavePrompt?.();
  };

  const handleConfirmLeave = async () => {
    setError(null);
    try {
      await onLeaveTeam?.();
    } catch (err) {
      if (err?.status === 401 || err?.status === 404) {
        await onLeaveTeam?.({ forceLocal: true });
      } else {
        setShowLeaveConfirm(false);
        onDismissLeavePrompt?.();
        setError(err?.message || 'Failed to leave squad. Please try again.');
      }
    }
  };

  const members = snapshot?.members || [];
  const activeMembers = members.filter((m) => !m.isExcused);
  const readyCount = activeMembers.filter((m) => m.isReady).length;
  const isRosterFull = snapshot ? members.length >= snapshot.targetSize : false;
  const isContestWindowOpen = snapshot?.contestWindow?.isOpen ?? true;
  const roomStatus = snapshot?.status || 'LOBBY';
  const isRoundFinished = roomStatus === 'FINISHED' || roomStatus === 'COMPLETED';

  const squadAverageScore =
    activeMembers.length > 0
      ? Math.round(
          activeMembers.reduce((sum, m) => sum + (m.individualScore || 0), 0) / activeMembers.length
        )
      : 0;

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
          onClick={() => setShowLeaveConfirm(true)}
          className="font-mono text-xs text-[#aab5ac] hover:text-[#ff6b5e] uppercase tracking-wider transition-colors underline underline-offset-4 cursor-pointer"
        >
          [← LEAVE SQUAD]
        </button>
      </div>

      {/* Global Flash Announcement Banner */}
      {flashBanner && (
        <div
          role="alert"
          className={`p-3 mb-5 font-mono text-xs flex items-center justify-between border-2 shadow-[4px_4px_0_#090c0a] ${
            flashBanner.priority === 'emergency'
              ? 'border-[#ff6b5e] bg-[#ff6b5e]/20 text-[#ff6b5e]'
              : 'border-[#ffe36e] bg-[#ffe36e]/20 text-[#ffe36e]'
          }`}
        >
          <div className="flex items-center gap-2">
            <span>{flashBanner.priority === 'emergency' ? '🚨' : '📢'}</span>
            <span>
              <strong className="uppercase mr-1.5 font-black">
                {flashBanner.priority === 'emergency' ? 'EMERGENCY:' : 'ANNOUNCEMENT:'}
              </strong>
              {flashBanner.message}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setFlashBanner(null)}
            className="font-bold ml-2 px-1.5 py-0.5 border border-current hover:bg-white/10 cursor-pointer shrink-0"
          >
            ✕
          </button>
        </div>
      )}

      {/* Leave Squad Confirmation Banner */}
      {(showLeaveConfirm || leavePromptRequested) && (
        <div className="border-2 border-[#ff6b5e] bg-[#ff6b5e]/15 p-4 mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-[4px_4px_0_#090c0a]">
          <div className="font-mono text-xs text-[#e8ece3]">
            <strong className="text-[#ff6b5e] uppercase block mb-0.5">
              LEAVE SQUAD #{teamCode}?
            </strong>
            Your spot in this squad will be released so you can join or create another team.
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleCancelLeave}
              className="px-3 py-1.5 bg-[#090c0a] border-2 border-[#2ee58f] text-[#2ee58f] font-mono font-bold text-xs uppercase cursor-pointer"
            >
              STAY IN SQUAD
            </button>
            <button
              type="button"
              onClick={handleConfirmLeave}
              className="px-3 py-1.5 bg-[#ff6b5e] border-2 border-[#090c0a] text-[#090c0a] font-mono font-bold text-xs uppercase shadow-[2px_2px_0_#090c0a] cursor-pointer"
            >
              CONFIRM LEAVE
            </button>
          </div>
        </div>
      )}

      {/* Squad Header Card */}
      <div className="cyber-card p-6 md:p-8 mb-6 relative">
        <WashiTape color="butter" rotation="-3deg" className="-top-3 -right-4" />
        <FlowerSticker
          id={7}
          size={46}
          rotation={-10}
          withTape
          tapeColor="pink"
          className="hidden sm:inline-block absolute -top-6 left-12 z-10"
        />

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="font-mono text-xs tracking-widest text-[#2ee58f] uppercase font-bold">
                SQUAD REGISTRATION
              </span>
              <span className="font-mono text-[10px] bg-[#2ee58f]/15 text-[#2ee58f] border border-[#2ee58f]/40 px-1.5 py-0.5 font-bold uppercase tracking-wider">
                FOSS FORGE 2.0 // UFC
              </span>
            </div>
            <h1 className="font-display font-extrabold text-2xl md:text-4xl text-[#e8ece3] tracking-tight">
              {snapshot?.teamName || 'Loading Squad...'}
            </h1>
          </div>

          {/* Squad Code & Mode Pill with Copy & Share Link */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="font-mono text-sm md:text-base font-bold bg-[#090c0a] border-2 border-[#2ee58f] px-4 py-2 text-[#2ee58f] tracking-widest shadow-[3px_3px_0_#2ee58f]">
              #{teamCode}
            </div>
            <div className="font-mono text-xs md:text-sm font-bold bg-[#090c0a] border-2 border-[#ffe36e] px-3 py-2 text-[#ffe36e] tracking-wider shadow-[2px_2px_0_#ffe36e]">
              {snapshot?.operatorMode === 'sub'
                ? 'SUBTRACTION (-)'
                : snapshot?.operatorMode === 'mixed'
                ? 'MIXED (±)'
                : 'ADDITION (+)'}
            </div>
            <button
              type="button"
              onClick={handleCopyCode}
              className="py-2 px-3 border-2 border-[#090c0a] bg-[#ffe36e] text-[#090c0a] font-mono font-bold text-xs uppercase tracking-wider shadow-[2px_2px_0_#090c0a] hover:translate-x-0.5 transition-transform cursor-pointer"
            >
              {copiedCode ? 'COPIED!' : 'COPY CODE'}
            </button>
            <button
              type="button"
              onClick={handleCopyInviteLink}
              className="py-2 px-3 border-2 border-[#090c0a] bg-[#2ee58f] text-[#090c0a] font-mono font-bold text-xs uppercase tracking-wider shadow-[2px_2px_0_#090c0a] hover:translate-x-0.5 transition-transform cursor-pointer"
            >
              {copiedLink ? 'LINK COPIED!' : 'INVITE LINK 🔗'}
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

      {/* Completed Sprint Summary Banner inside Lobby */}
      {isRoundFinished && (
        <div className="border-2 border-[#2ee58f] bg-[#2ee58f]/10 p-5 mb-6 shadow-[4px_4px_0_#090c0a] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <span className="font-mono text-xs font-bold text-[#2ee58f] uppercase tracking-widest block">
              🏆 SPRINT ROUND COMPLETED
            </span>
            <span className="font-body text-xs text-[#e8ece3]">
              All squad members have completed the sprint. Ready for another round?
            </span>
          </div>
          <div className="bg-[#090c0a] border-2 border-[#ffe36e] px-4 py-2 text-center shrink-0">
            <span className="font-mono text-[10px] text-[#aab5ac] uppercase block">SQUAD AVERAGE</span>
            <span className="font-display font-extrabold text-xl text-[#ffe36e]">
              {squadAverageScore.toLocaleString()} PTS
            </span>
          </div>
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
            STATUS: <strong className="text-[#2ee58f]">{roomStatus}</strong>
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
                    <div className="flex items-center gap-2 flex-wrap">
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

                {/* Status / Score Pill */}
                <div className="flex items-center gap-2 self-start sm:self-auto">
                  {member.isExcused ? (
                    <span className="font-mono text-xs px-3 py-1 bg-[#090c0a] border border-[#aab5ac]/30 text-[#aab5ac]">
                      EXCUSED FROM SPRINT
                    </span>
                  ) : isRoundFinished || roomStatus === 'IN_SPRINT' ? (
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs px-2.5 py-1 bg-[#090c0a] border border-[#2ee58f]/40 text-[#aab5ac]">
                        {member.completedQuestions || 0}/15 Q
                      </span>
                      <span className="font-mono text-xs font-bold px-3 py-1 bg-[#2ee58f] text-[#090c0a] border border-[#090c0a] shadow-[2px_2px_0_#090c0a]">
                        {(member.individualScore || 0).toLocaleString()} PTS
                      </span>
                    </div>
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
      {!isRoundFinished && (
        <div className="border-2 border-[#ffe36e] bg-[#ffe36e]/10 p-4 mb-6 shadow-[4px_4px_0_#090c0a]">
          <div className="flex items-start gap-3">
            <span className="text-xl leading-none">⚠️</span>
            <div>
              <h3 className="font-mono font-bold text-xs text-[#ffe36e] uppercase tracking-wider mb-1">
                ATOMIC SYNCHRONIZED START GATE
              </h3>
              <p className="font-body text-xs text-[#e8ece3] leading-relaxed">
                Every squad member must be logged in and in the <strong>"READY"</strong> state before the sprint can launch (
                {isRosterFull
                  ? `${readyCount} of ${activeMembers.length} ready`
                  : `${members.length} of ${snapshot?.targetSize || 3} joined • ${readyCount} ready`}
                ). All teammates solve individually at the exact same time. The team score is the <strong>AVERAGE</strong> of all members' scores!
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Big Tactile Action Area */}
      <div className="text-center">
        {!snapshot ? (
          <div className="p-4 border-2 border-[#2ee58f]/40 bg-[#090c0a] text-[#2ee58f] font-mono text-xs font-bold tracking-wider animate-pulse">
            CONNECTING TO SQUAD LOBBY TELEMETRY...
          </div>
        ) : isRoundFinished ? (
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <TactileButton
              variant="signal"
              onClick={handlePlayAgain}
              disabled={resetLoading}
              className="flex-1 py-4 text-sm md:text-base shadow-[6px_6px_0_#090c0a]"
            >
              {resetLoading ? 'RESETTING SQUAD...' : '🔄 PLAY AGAIN (NEW SPRINT WITH SQUAD)'}
            </TactileButton>

            {onViewLeaderboard && (
              <TactileButton
                variant="butter"
                onClick={onViewLeaderboard}
                className="sm:w-auto px-6 py-4 text-sm md:text-base shadow-[6px_6px_0_#090c0a]"
              >
                🏆 VIEW LEADERBOARD
              </TactileButton>
            )}
          </div>
        ) : roomStatus === 'IN_SPRINT' ? (
          <div className="space-y-3">
            <div className="p-4 border-2 border-[#2ee58f] bg-[#2ee58f]/15 text-[#2ee58f] font-mono text-xs font-bold tracking-wider animate-pulse">
              ⏳ SPRINT IN PROGRESS — {resumableSprint ? 'YOU EXITED THE ARENA' : 'WAITING FOR TEAMMATES TO FINISH...'}
            </div>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              {resumableSprint && (
                <TactileButton
                  variant="signal"
                  onClick={() => {
                    const now = Date.now();
                    const elapsedMs = resumableSprint.isPaused
                      ? 0
                      : Math.max(0, now - (resumableSprint.capturedAt || resumableSprint.startedAt || now));
                    const baseRemainingMs =
                      typeof resumableSprint.initialRemainingMs === 'number'
                        ? resumableSprint.initialRemainingMs
                        : resumableSprint.expiresAt
                        ? resumableSprint.expiresAt - now + elapsedMs
                        : resumableSprint.durationSeconds * 1000;
                    const remainingMs = baseRemainingMs - elapsedMs;
                    if (!resumableSprint.isPaused && remainingMs <= 0) {
                      setResumableSprint(null);
                      getTeamSnapshot(teamCode, memberToken)
                        .then((data) => setSnapshot(data))
                        .catch(() => {});
                      return;
                    }
                    onStartSprint({
                      ...resumableSprint,
                      startedAt: now,
                      durationSeconds: Math.max(1, Math.ceil(remainingMs / 1000))
                    });
                  }}
                  className="px-6 py-3 text-xs sm:text-sm"
                >
                  ⚡ RETURN TO ACTIVE SPRINT
                </TactileButton>
              )}
              {onViewLeaderboard && (
                <TactileButton
                  variant="butter"
                  onClick={onViewLeaderboard}
                  className="px-6 py-3 text-xs sm:text-sm"
                >
                  🏆 VIEW LIVE LEADERBOARD
                </TactileButton>
              )}
            </div>
          </div>
        ) : !isRosterFull ? (
          <div className="p-4 border-2 border-[#f5a623] bg-[#f5a623]/15 text-[#f5a623] font-mono text-xs font-bold tracking-wider">
            SQUAD INCOMPLETE: SHARE CODE #{teamCode} OR INVITE LINK WITH TEAMMATES TO FILL ROSTER ({members.length}/{snapshot.targetSize})
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
