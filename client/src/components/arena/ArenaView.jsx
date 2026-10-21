import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { EquationCard } from './EquationCard.jsx';
import { TactileNumpad } from './TactileNumpad.jsx';
import { SprintTimer } from './SprintTimer.jsx';
import { TeammateHud } from './TeammateHud.jsx';
import { SprintSummary } from './SprintSummary.jsx';
import { FlowerSticker } from '../common/FlowerSticker.jsx';
import { WashiTape } from '../common/WashiTape.jsx';
import { RadarDot } from '../common/RadarDot.jsx';
import { submitAnswer, getTeamSnapshot } from '../../services/api.js';
import { connectTeamStream } from '../../services/sse.js';
import { soundFx } from '../../services/soundFx.js';

/**
 * Safely derives expected numerical answer based on question operands and operation.
 * Returns null if operands are invalid or operation cannot be determined.
 */
function deriveExpectedAnswer(question) {
  if (!question || !Number.isFinite(question.a) || !Number.isFinite(question.b)) {
    return null;
  }
  const op = question.operator || question.operation;
  if (!op) {
    return null;
  }
  let result = null;
  switch (op) {
    case '+':
      result = question.a + question.b;
      break;
    case '-':
      result = question.a - question.b;
      break;
    case '*':
    case '×':
      result = question.a * question.b;
      break;
    case '/':
    case '÷':
      if (question.b !== 0 && question.a % question.b === 0) {
        result = question.a / question.b;
      }
      break;
    default:
      return null;
  }
  return typeof result === 'number' && Number.isInteger(result) && result >= 0 ? result : null;
}

/**
 * 2-Minute Sprint Arena Controller (Reflex Mode — 60fps).
 * Handles parallel question solving, Zetamac physical keyboard inputs,
 * tactile touch numpad with Thumb-Enter, anti-cheat latency calculation,
 * live teammate HUD updates, and perimeter flash feedback.
 */
export function ArenaView({
  sessionId,
  questions = [],
  initialQuestionIndex = 0,
  initialScore = 0,
  initialStreak = 0,
  initialMaxStreak = 0,
  initialSubmissions = [],
  initialIsFinished = false,
  initialIsTimeOut = false,
  startedAt = 0,
  durationSeconds = 120,
  initialIsPaused = false,
  isActiveView = true,
  teamCode,
  memberToken,
  currentRoll,
  currentName,
  exitPromptRequested = false,
  isAudioMuted: propIsAudioMuted = null,
  onToggleAudioMute = null,
  onDismissExitPrompt,
  onSprintFinishedChange,
  onStateSync,
  onReturnToLobby,
  onPlayAgain,
  onViewLeaderboard
}) {
  const [currentIndex, setCurrentIndex] = useState(initialQuestionIndex || 0);
  const [currentInput, setCurrentInput] = useState('');
  const [score, setScore] = useState(initialScore || 0);
  const [streak, setStreak] = useState(initialStreak || 0);
  const [maxStreak, setMaxStreak] = useState(() =>
    Math.max(initialStreak || 0, initialMaxStreak || 0)
  );
  const [submissions, setSubmissions] = useState(() =>
    Array.isArray(initialSubmissions) ? initialSubmissions : []
  );
  const [flashState, setFlashState] = useState(null); // 'correct' | 'incorrect' | null
  const [lastResult, setLastResult] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFinished, setIsFinished] = useState(Boolean(initialIsFinished));
  const [isTimeOut, setIsTimeOut] = useState(Boolean(initialIsTimeOut));
  const [isPaused, setIsPaused] = useState(Boolean(initialIsPaused));
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [submissionError, setSubmissionError] = useState(null);
  const [teammates, setTeammates] = useState([]);
  const [flashBanner, setFlashBanner] = useState(null);

  const [isFullscreen, setIsFullscreen] = useState(() =>
    typeof document !== 'undefined'
      ? Boolean(document.fullscreenElement || document.webkitFullscreenElement)
      : false
  );
  const [internalIsAudioMuted, setInternalIsAudioMuted] = useState(() => soundFx.isMuted());
  const isAudioMuted = propIsAudioMuted !== null ? propIsAudioMuted : internalIsAudioMuted;

  const handleToggleAudio = useCallback(() => {
    if (onToggleAudioMute) {
      onToggleAudioMute();
    } else {
      const nextMuted = soundFx.toggleMute();
      setInternalIsAudioMuted(nextMuted);
    }
  }, [onToggleAudioMute]);

  const enteredFullscreenByArenaRef = useRef(false);
  const userOptedOutOfFullscreenRef = useRef(false);
  const isUnmountedRef = useRef(false);
  const isFinishedRef = useRef(Boolean(initialIsFinished));

  const requestFullscreenSafe = useCallback(async (isManual = false) => {
    try {
      if (
        typeof document !== 'undefined' &&
        !(document.fullscreenElement || document.webkitFullscreenElement)
      ) {
        if (!isManual && userOptedOutOfFullscreenRef.current) {
          return;
        }
        const root = document.documentElement;
        if (root.requestFullscreen) {
          await root.requestFullscreen();
        } else if (root.webkitRequestFullscreen) {
          await root.webkitRequestFullscreen();
        }

        if (isUnmountedRef.current || isFinishedRef.current) {
          if (
            typeof document !== 'undefined' &&
            (document.fullscreenElement || document.webkitFullscreenElement)
          ) {
            if (document.exitFullscreen) {
              await document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
              await document.webkitExitFullscreen();
            }
          }
        } else {
          enteredFullscreenByArenaRef.current = true;
        }
      }
    } catch {
      // Browser rejected due to transient activation requirements
    }
  }, []);

  const exitFullscreenSafe = useCallback(async (isUserAction = false) => {
    try {
      if (isUserAction) {
        userOptedOutOfFullscreenRef.current = true;
      }
      if (
        typeof document !== 'undefined' &&
        (document.fullscreenElement || document.webkitFullscreenElement)
      ) {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
          await document.webkitExitFullscreen();
        }
      }
    } catch {
      // Ignore exit error
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (
      typeof document !== 'undefined' &&
      (document.fullscreenElement || document.webkitFullscreenElement)
    ) {
      void exitFullscreenSafe(true);
    } else {
      userOptedOutOfFullscreenRef.current = false;
      void requestFullscreenSafe(true);
    }
  }, [exitFullscreenSafe, requestFullscreenSafe]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const handleFullscreenChange = () => {
      const activeEl = document.fullscreenElement || document.webkitFullscreenElement;
      setIsFullscreen(Boolean(activeEl));
      if (!activeEl && enteredFullscreenByArenaRef.current) {
        // User exited via Escape or browser chrome
        userOptedOutOfFullscreenRef.current = true;
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, []);


  // Cleanly exit fullscreen on sprint completion or unmount ONLY if entered by arena
  useEffect(() => {
    if (
      isFinished &&
      enteredFullscreenByArenaRef.current &&
      (document.fullscreenElement || document.webkitFullscreenElement)
    ) {
      void exitFullscreenSafe(false);
    }
  }, [isFinished, exitFullscreenSafe]);

  useEffect(() => {
    return () => {
      isUnmountedRef.current = true;
      if (
        enteredFullscreenByArenaRef.current &&
        typeof document !== 'undefined' &&
        (document.fullscreenElement || document.webkitFullscreenElement)
      ) {
        void exitFullscreenSafe(false);
      }
    };
  }, [exitFullscreenSafe]);

  const flashTimerRef = useRef(null);
  const lastResultTimerRef = useRef(null);
  const questionStartTimeRef = useRef(0);
  const pauseStartRef = useRef(null);
  const isSubmittingRef = useRef(false);
  const currentInputRef = useRef('');
  const currentIndexRef = useRef(initialQuestionIndex || 0);
  const streakRef = useRef(initialStreak || 0);
  const pendingInputBufferRef = useRef([]);
  const handleDigitRef = useRef(null);
  const submissionTokenRef = useRef(0);

  // Initialize question start time on mount
  useEffect(() => {
    questionStartTimeRef.current = performance.now();
  }, []);

  useEffect(() => {
    onSprintFinishedChange?.(isFinished);
  }, [isFinished, onSprintFinishedChange]);

  useEffect(() => {
    onStateSync?.({
      questionIndex: currentIndex,
      currentScore: score,
      streak,
      maxStreak,
      submissions,
      isFinished,
      isTimeOut,
      isPaused
    });
  }, [
    currentIndex,
    score,
    streak,
    maxStreak,
    submissions,
    isFinished,
    isTimeOut,
    isPaused,
    onStateSync
  ]);

  // Subscribe to Team SSE Stream for live teammate HUD, snapshots, and admin pauses
  useEffect(() => {
    if (!teamCode) return;

    const sse = connectTeamStream(teamCode, memberToken, {
      onSnapshot: (data) => {
        if (
          isFinishedRef.current &&
          (data?.status === 'AWAITING_READY' || data?.status === 'LOBBY')
        ) {
          onReturnToLobby?.();
          return;
        }
        if (Array.isArray(data?.members)) {
          setTeammates(
            data.members.map((m) => ({
              rollNumber: m.rollNumber,
              name: m.name,
              completedQuestions: m.completedQuestions ?? 0,
              individualScore: m.individualScore ?? 0,
              streak: m.streak ?? 0,
              connected: m.connected ?? true
            }))
          );
        }
      },
      onTeammateProgress: (data) => {
        setTeammates((prev) => {
          const exists = prev.some((m) => m.rollNumber === data.rollNumber);
          if (exists) {
            return prev.map((m) =>
              m.rollNumber === data.rollNumber
                ? {
                    ...m,
                    completedQuestions: data.questionIndex,
                    individualScore: data.currentScore,
                    streak: data.streak
                  }
                : m
            );
          }
          return [
            ...prev,
            {
              rollNumber: data.rollNumber,
              name: data.name,
              completedQuestions: data.questionIndex,
              individualScore: data.currentScore,
              streak: data.streak,
              connected: true
            }
          ];
        });
      },
      onRoomPaused: () => {
        if (pauseStartRef.current === null) {
          pauseStartRef.current = performance.now();
        }
        setIsPaused(true);
      },
      onRoomResumed: () => {
        if (pauseStartRef.current !== null) {
          const pauseDuration = performance.now() - pauseStartRef.current;
          questionStartTimeRef.current += pauseDuration;
          pauseStartRef.current = null;
        }
        setIsPaused(false);
      },
      onFlashAnnouncement: (announcement) => {
        setFlashBanner(announcement);
      }
    });

    return () => {
      sse.disconnect();
    };
  }, [teamCode, memberToken, onReturnToLobby]);

  // Clean up flash and floating callout timers
  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      if (lastResultTimerRef.current) clearTimeout(lastResultTimerRef.current);
    };
  }, []);

  const currentQuestion = questions[currentIndex];
  const hasAutoSubmit = deriveExpectedAnswer(currentQuestion) !== null;

  // Submit answer value (invoked automatically upon reaching target digit length)
  const submitAnswerValue = useCallback(
    async (rawVal) => {
      if (isSubmittingRef.current || isFinishedRef.current || isFinished || isPaused) return;
      const inputStr = typeof rawVal === 'string' ? rawVal.trim() : currentInputRef.current.trim();
      if (!inputStr) return;

      const parsedAnswer = parseInt(inputStr, 10);
      if (!Number.isFinite(parsedAnswer)) return;

      const activeIndex = currentIndexRef.current;
      const activeQuestion = questions[activeIndex];

      const currentToken = ++submissionTokenRef.current;
      let lockReleased = false;

      isSubmittingRef.current = true;
      const nowPerf = performance.now();
      const clientDeltaMs = Math.max(50, Math.round(nowPerf - questionStartTimeRef.current));
      const clientTimestamp = Date.now();

      setIsSubmitting(true);

      try {
        setSubmissionError(null);
        const res = await submitAnswer(
          sessionId,
          activeIndex,
          parsedAnswer,
          clientDeltaMs,
          clientTimestamp,
          memberToken
        );

        const isCorrect = Boolean(res.isCorrect);
        const points = Number(res.pointsAwarded) || 0;

        // Play audio feedback
        if (isCorrect) {
          soundFx.playCorrect();
        } else {
          soundFx.playIncorrect();
        }

        // Visual perimeter flash
        setFlashState(isCorrect ? 'correct' : 'incorrect');
        if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
        flashTimerRef.current = setTimeout(() => {
          setFlashState(null);
        }, 350);

        // Update score via functional updater
        setScore((prev) => (typeof res.currentScore === 'number' ? res.currentScore : prev + points));

        // Derive effective streak directly via ref and update state, maxStreak, and feedback badge
        const effectiveStreak =
          typeof res.consecutiveStreak === 'number'
            ? res.consecutiveStreak
            : isCorrect
            ? streakRef.current + 1
            : 0;

        streakRef.current = effectiveStreak;
        setStreak(effectiveStreak);
        setMaxStreak((prevMax) => Math.max(prevMax, effectiveStreak));

        // Hit feedback badge
        setLastResult({
          isCorrect,
          pointsAwarded: points,
          consecutiveStreak: effectiveStreak
        });
        if (lastResultTimerRef.current) clearTimeout(lastResultTimerRef.current);
        lastResultTimerRef.current = setTimeout(() => {
          setLastResult(null);
        }, 700);

        // Record submission record
        setSubmissions((prev) => [
          ...prev,
          {
            questionIndex: activeIndex,
            bucket: activeQuestion?.bucket,
            operator: activeQuestion?.operator || activeQuestion?.operation || '+',
            a: activeQuestion?.a,
            b: activeQuestion?.b,
            answer: parsedAnswer,
            correctAnswer: activeQuestion?.answer ?? deriveExpectedAnswer(activeQuestion),
            isCorrect,
            pointsAwarded: points,
            latencyMs: clientDeltaMs
          }
        ]);

        // Advance to next question or complete sprint
        if (res.isFinished || activeIndex + 1 >= questions.length) {
          pendingInputBufferRef.current = [];
          if (!isFinishedRef.current) {
            isFinishedRef.current = true;
            setIsFinished(true);
            soundFx.playFinish();
          }
        } else {
          if (isFinishedRef.current) return;
          currentInputRef.current = '';
          setCurrentInput('');
          const nextIndex = activeIndex + 1;
          currentIndexRef.current = nextIndex;
          setCurrentIndex(nextIndex);
          questionStartTimeRef.current = performance.now();

          // Release submission lock before replaying buffered digits for the new question
          lockReleased = true;
          isSubmittingRef.current = false;
          setIsSubmitting(false);

          if (pendingInputBufferRef.current.length > 0) {
            const buffered = [...pendingInputBufferRef.current];
            pendingInputBufferRef.current = [];
            for (const d of buffered) {
              handleDigitRef.current?.(d);
            }
          }
        }
      } catch (err) {
        pendingInputBufferRef.current = [];
        console.warn('[Arena] Answer submission failed:', err);

        // The server is on an earlier question than this player (it came back from a restart a moment behind). Step back to the question
        // it is on instead of showing an error: the next answer is scored from there, and the score on screen is corrected by its reply.
        const expectedIndex = err?.data?.expectedIndex;
        if (
          err?.data?.errorCode === 'OUT_OF_SYNC' &&
          Number.isInteger(expectedIndex) &&
          expectedIndex >= 0 &&
          expectedIndex < questions.length &&
          !isFinishedRef.current
        ) {
          currentInputRef.current = '';
          setCurrentInput('');
          currentIndexRef.current = expectedIndex;
          setCurrentIndex(expectedIndex);
          questionStartTimeRef.current = performance.now();
          setSubmissions((prev) => prev.filter((s) => s.questionIndex < expectedIndex));
          setSubmissionError(null);
          return;
        }

        const isSprintDone = Boolean(
          err?.data?.isFinished ||
            err?.data?.errorCode === 'SPRINT_FINISHED' ||
            /already finished|deadline expired|already completed/i.test(err?.message || '')
        );
        if (isSprintDone) {
          if (!isFinishedRef.current) {
            isFinishedRef.current = true;
            setIsFinished(true);
            soundFx.playFinish();
          }
        } else {
          currentInputRef.current = '';
          setCurrentInput('');
          if (!isFinishedRef.current) {
            setSubmissionError(err?.message || 'Submission failed');
          }
        }
      } finally {
        if (!lockReleased && submissionTokenRef.current === currentToken) {
          isSubmittingRef.current = false;
          setIsSubmitting(false);
        }
      }
    },
    [
      isFinished,
      isPaused,
      sessionId,
      memberToken,
      questions
    ]
  );

  // Digits input logic with zero-Enter automatic submission and in-flight digit buffering
  const handleDigit = useCallback(
    (digit) => {
      if (isFinishedRef.current || isFinished || isPaused) return;

      // If a submission is currently in flight, buffer the typed digit for the next question
      if (isSubmittingRef.current) {
        if (pendingInputBufferRef.current.length < 6) {
          pendingInputBufferRef.current.push(digit);
        }
        return;
      }

      const activeQuestion = questions[currentIndexRef.current];
      const expectedAnswer = deriveExpectedAnswer(activeQuestion);
      const targetDigits =
        expectedAnswer !== null ? String(expectedAnswer).length : null;

      const prev = currentInputRef.current;
      const maxAllowedLength = targetDigits !== null ? targetDigits : 6;
      if (prev.length >= maxAllowedLength) return;

      const next = prev + digit;
      currentInputRef.current = next;
      setCurrentInput(next);

      if (targetDigits !== null && next.length >= targetDigits) {
        void submitAnswerValue(next);
      }
    },
    [isFinished, isPaused, questions, submitAnswerValue]
  );

  // Sync handleDigit ref to avoid circular useCallback dependencies during buffered replay
  useEffect(() => {
    handleDigitRef.current = handleDigit;
  }, [handleDigit]);

  const handleBackspace = useCallback(() => {
    if (isFinishedRef.current || isFinished || isPaused) return;
    if (isSubmittingRef.current) {
      if (pendingInputBufferRef.current.length > 0) {
        pendingInputBufferRef.current.pop();
      }
      return;
    }
    const next = currentInputRef.current.slice(0, -1);
    currentInputRef.current = next;
    setCurrentInput(next);
  }, [isFinished, isPaused]);

  const handleClear = useCallback(() => {
    if (isFinishedRef.current || isFinished || isPaused) return;
    if (isSubmittingRef.current) {
      pendingInputBufferRef.current = [];
      return;
    }
    currentInputRef.current = '';
    setCurrentInput('');
  }, [isFinished, isPaused]);

  // Zetamac Physical Keyboard listeners (Zero-Enter Automatic Submit with Manual Fallback)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!isActiveView || isFinished || isPaused) return;

      const target = e.target;
      const isEditable =
        target &&
        (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
      if (isEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const isGameKey =
        (e.key >= '0' && e.key <= '9') ||
        e.key === 'Backspace' ||
        e.key === 'Escape' ||
        e.key === 'Enter' ||
        e.key === ' ';

      if (!isGameKey) return;

      if (e.key >= '0' && e.key <= '9') {
        soundFx.playKeyClick();
        handleDigit(e.key);
      } else if (e.key === 'Backspace') {
        soundFx.playKeyClick();
        handleBackspace();
      } else if (e.key === 'Escape') {
        soundFx.playKeyClick();
        handleClear();
      } else if (e.key === 'Enter' || e.key === ' ') {
        if (e.key === ' ') e.preventDefault(); // Prevent Spacebar from scrolling
        soundFx.playKeyClick();
        void submitAnswerValue();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleDigit, handleBackspace, handleClear, submitAnswerValue, isActiveView, isFinished, isPaused, requestFullscreenSafe]);

  // Handle 120s sprint timeout
  const handleTimerExpire = useCallback(async () => {
    setIsTimeOut(true);
    isFinishedRef.current = true;
    setIsFinished(true);
    soundFx.playFinish();

    if (isSubmittingRef.current) {
      let checks = 0;
      while (isSubmittingRef.current && checks < 15) {
        await new Promise((r) => setTimeout(r, 50));
        checks++;
      }
    }

    if (teamCode && memberToken) {
      try {
        const snap = await getTeamSnapshot(teamCode, memberToken);
        const membersList = snap?.members || snap?.team?.members || [];
        const myData = membersList.find((m) => m.rollNumber === currentRoll);
        if (myData && typeof myData.individualScore === 'number') {
          setScore(myData.individualScore);
        }
      } catch {
        // Silently preserve current score if snapshot request fails
      }
    }
  }, [teamCode, memberToken, currentRoll]);

  const handleCancelExit = () => {
    setShowExitConfirm(false);
    onDismissExitPrompt?.();
  };

  const bucketCounts = useMemo(() => {
    if (!Array.isArray(questions) || questions.length === 0) {
      return { B1: 3, B2: 4, B3: 4, B4: 4 };
    }
    const counts = { B1: 0, B2: 0, B3: 0, B4: 0 };
    for (const q of questions) {
      if (q && q.bucket && counts[q.bucket] !== undefined) {
        counts[q.bucket]++;
      }
    }
    return counts;
  }, [questions]);

  const onlineTeammatesCount = useMemo(() => {
    if (!Array.isArray(teammates) || teammates.length === 0) return 1;
    return teammates.filter((t) => t.connected !== false).length;
  }, [teammates]);

  // If sprint is finished, render summary
  if (isFinished) {
    return (
      <SprintSummary
        finalScore={score}
        maxStreak={maxStreak}
        submissions={submissions}
        totalQuestions={questions.length || 15}
        teammates={teammates}
        currentRoll={currentRoll}
        teamName={teamCode ? `#${teamCode}` : 'Squad'}
        isTimeOut={isTimeOut}
        onReturnToLobby={onReturnToLobby}
        onPlayAgain={onPlayAgain}
        onViewLeaderboard={onViewLeaderboard}
      />
    );
  }

  return (
    <div className="w-full max-w-6xl mx-auto h-full max-h-[100dvh] flex flex-col justify-between overflow-x-hidden overflow-y-auto px-2.5 sm:px-4 py-1.5 sm:py-2 select-none touch-manipulation overscroll-none arena-stage">
      {/* Top Header Telemetry */}
      <div className="shrink-0 flex items-center justify-between gap-1.5 sm:gap-2 mb-1 pb-1 border-b border-[#2ee58f]/20">
        <div className="flex items-center gap-1 sm:gap-2">
          <button
            type="button"
            onClick={() => setShowExitConfirm(true)}
            className="font-mono text-[10px] sm:text-xs text-[#aab5ac] hover:text-[#ffe36e] px-1.5 sm:px-2 py-0.5 border border-white/15 hover:border-[#ffe36e] transition-colors cursor-pointer"
            title="Return to Squad Lobby"
          >
            ← LOBBY
          </button>
          <span className="font-mono text-[10px] sm:text-xs font-bold bg-[#ffe36e] text-[#090c0a] px-1.5 sm:px-2 py-0.5 border border-[#090c0a]">
            #{teamCode || 'SQUAD'}
          </span>
          <div className="hidden sm:flex items-center gap-1 px-1.5 py-0.5 bg-[#090c0a] border border-white/15">
            <div className="w-3.5 h-3.5 rounded-xs bg-[#E6F8ED] border border-[#090c0a] p-0.5 flex items-center justify-center shrink-0">
              <img src="/brand/ufc-logo.svg" alt="UFC" className="w-full h-full object-contain" />
            </div>
            <span className="font-mono text-[10px] font-bold text-[#e8ece3] uppercase">UFC</span>
          </div>
          <button
            type="button"
            onClick={toggleFullscreen}
            className="hidden sm:inline-block font-mono text-[10px] sm:text-xs text-[#aab5ac] hover:text-[#2ee58f] px-1.5 sm:px-2 py-0.5 border border-white/15 hover:border-[#2ee58f] transition-colors cursor-pointer"
            title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
          >
            {isFullscreen ? '⛶ EXIT FULL' : '⛶ FULL'}
          </button>
          <button
            type="button"
            onClick={handleToggleAudio}
            className="font-mono text-[10px] sm:text-xs text-[#aab5ac] hover:text-[#2ee58f] px-1.5 sm:px-2 py-0.5 border border-white/15 hover:border-[#2ee58f] transition-colors cursor-pointer"
            title={isAudioMuted ? 'Sound FX: Muted (Click to enable audio feedback)' : 'Sound FX: Active (Click to mute)'}
            aria-label={isAudioMuted ? 'Unmute sound effects' : 'Mute sound effects'}
          >
            {isAudioMuted ? '🔇' : '🔊'}
          </button>
          <span className="hidden sm:inline font-mono text-xs text-[#2ee58f] font-bold tracking-widest uppercase truncate max-w-[140px] md:max-w-[200px]">
            {currentName ? `${currentName} // ` : ''}§ 02 ARENA
          </span>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
          {streak >= 3 && (
            <span className="font-mono text-[10px] sm:text-xs font-bold bg-[#f5a623] text-[#090c0a] px-1.5 py-0.5 border border-[#090c0a] shadow-[2px_2px_0_#090c0a] animate-pulse">
              🔥 {streak}x
            </span>
          )}
          <span className="font-mono text-xs sm:text-sm md:text-base font-extrabold text-[#e8ece3]">
            SCORE: <strong className="text-[#2ee58f]">{score.toLocaleString()}</strong>
          </span>
        </div>
      </div>

      {/* Global Flash Announcement Banner */}
      {flashBanner && (
        <div
          role="alert"
          className={`shrink-0 p-1.5 sm:p-2 mb-1 sm:mb-2 font-mono text-[11px] sm:text-xs flex items-center justify-between border-2 shadow-[2px_2px_0_#090c0a] ${
            flashBanner.priority === 'emergency'
              ? 'border-[#ff6b5e] bg-[#ff6b5e]/20 text-[#ff6b5e]'
              : 'border-[#ffe36e] bg-[#ffe36e]/20 text-[#ffe36e]'
          }`}
        >
          <div className="flex items-center gap-1.5 truncate">
            <span>{flashBanner.priority === 'emergency' ? '🚨' : '📢'}</span>
            <span className="truncate">{flashBanner.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setFlashBanner(null)}
            className="font-bold ml-2 px-1 border border-current hover:bg-white/10 cursor-pointer shrink-0"
          >
            ✕
          </button>
        </div>
      )}

      {/* Accidental Back / Exit Confirmation Bar */}
      {(showExitConfirm || exitPromptRequested) && (
        <div className="shrink-0 border-2 border-[#f5a623] bg-[#f5a623]/15 p-2 sm:p-2.5 mb-1 sm:mb-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-[3px_3px_0_#090c0a]">
          <div className="font-mono text-xs text-[#e8ece3]">
            <strong className="text-[#f5a623] uppercase block">
              ⚠️ SPRINT IN PROGRESS!
            </strong>
            Leave the arena and return to the squad lobby?
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleCancelExit}
              className="px-2.5 py-1 bg-[#2ee58f] border-2 border-[#090c0a] text-[#090c0a] font-mono font-bold text-xs uppercase shadow-[2px_2px_0_#090c0a] cursor-pointer"
            >
              STAY IN SPRINT
            </button>
            <button
              type="button"
              onClick={onReturnToLobby}
              className="px-2.5 py-1 bg-[#090c0a] border-2 border-[#ff6b5e] text-[#ff6b5e] font-mono font-bold text-xs uppercase cursor-pointer"
            >
              EXIT TO LOBBY
            </button>
          </div>
        </div>
      )}

      {/* Submission Error Banner */}
      {submissionError && (
        <div className="shrink-0 border-2 border-[#ff6b5e] bg-[#ff6b5e]/20 p-1.5 sm:p-2 mb-1 sm:mb-1.5 text-center font-mono text-xs font-bold text-[#ff6b5e] tracking-widest uppercase">
          ⚠️ {submissionError}
        </div>
      )}

      {/* Paused Overlay Notice */}
      {isPaused && (
        <div className="shrink-0 border-2 border-[#f5a623] bg-[#f5a623]/20 p-2 sm:p-2.5 mb-1 sm:mb-2 text-center font-mono text-xs font-bold text-[#f5a623] tracking-widest uppercase animate-pulse">
          ⚠️ SPRINT PAUSED BY ORGANIZER — TIMER FROZEN
        </div>
      )}

      {/* Main Battle Deck: 3-Panel Responsive Station */}
      <div className="flex-1 min-h-0 flex items-center justify-center lg:gap-6 w-full max-w-full my-auto">
        {/* Left Flank (Desktop): Carry Taxonomy Guide */}
        <div className="hidden lg:flex flex-col gap-3 w-56 xl:w-64 shrink-0">
          <div className="cyber-card p-3 relative text-left">
            <WashiTape color="signal" rotation="-2.5deg" width="70px" className="-top-3 left-4" />
            <div className="font-mono text-[10px] text-[#2ee58f] font-bold tracking-widest uppercase mb-2 pb-1 border-b border-[#2ee58f]/20 flex items-center justify-between">
              <span>CARRY TAXONOMY</span>
              <span className="text-[9px] text-[#aab5ac]">4 BUCKETS</span>
            </div>
            <div className="flex flex-col gap-1.5 font-mono text-[11px]">
              <div className="p-1.5 bg-[#090c0a] border border-[#ffe36e]/40 flex items-center justify-between">
                <span className="font-bold text-[#ffe36e]">B1 // NO CARRY</span>
                <span className="text-[10px] text-[#aab5ac]">{bucketCounts.B1} Qs</span>
              </div>
              <div className="p-1.5 bg-[#090c0a] border border-[#2ee58f]/40 flex items-center justify-between">
                <span className="font-bold text-[#2ee58f]">B2 // ONES CARRY</span>
                <span className="text-[10px] text-[#aab5ac]">{bucketCounts.B2} Qs</span>
              </div>
              <div className="p-1.5 bg-[#090c0a] border border-[#f5a623]/40 flex items-center justify-between">
                <span className="font-bold text-[#f5a623]">B3 // TENS CARRY</span>
                <span className="text-[10px] text-[#aab5ac]">{bucketCounts.B3} Qs</span>
              </div>
              <div className="p-1.5 bg-[#090c0a] border border-[#ff6b5e]/40 flex items-center justify-between">
                <span className="font-bold text-[#ff6b5e]">B4 // DOUBLE CARRY</span>
                <span className="text-[10px] text-[#aab5ac]">{bucketCounts.B4} Qs</span>
              </div>
            </div>
            <div className="mt-2.5 pt-2 border-t border-white/10 font-mono text-[10px] text-[#aab5ac] flex items-center justify-between">
              <span>ACTIVE BUCKET:</span>
              <strong className="text-[#2ee58f] uppercase font-bold">{currentQuestion?.bucket || 'B1'}</strong>
            </div>
          </div>

          {/* Botanical Sticker Accent */}
          <div className="flex items-center justify-center py-1">
            <FlowerSticker id={2} size={50} rotation={-6} withTape tapeColor="butter" interactive />
          </div>
        </div>

        {/* Center Stage: Core Combat Reflex Cockpit (Timer + Card + Numpad) */}
        <div className="w-full max-w-lg min-w-0 flex flex-col items-center gap-1.5 sm:gap-2.5 my-auto">
          {/* Teammate Live HUD (Horizontal ribbon on mobile/tablet) */}
          <div className="lg:hidden w-full min-w-0 mb-0.5">
            <TeammateHud
              teammates={teammates}
              currentRoll={currentRoll}
              totalQuestions={questions.length || 15}
              layout="horizontal"
            />
          </div>

          {/* Precision 120s Timer */}
          <div className="w-full min-w-0">
            <SprintTimer
              startedAt={startedAt}
              durationSeconds={durationSeconds}
              isPaused={isPaused}
              onExpire={handleTimerExpire}
            />
          </div>

          {/* Main Equation Card — Proportional & Centered */}
          <div className="w-full min-w-0">
            <EquationCard
              question={currentQuestion}
              questionNumber={currentIndex + 1}
              totalQuestions={questions.length || 15}
              currentInput={currentInput}
              flashState={flashState}
              lastResult={lastResult}
              isSubmitting={isSubmitting}
              hasAutoSubmit={hasAutoSubmit}
            />
          </div>

          {/* Tactile On-Screen Numpad — Centered Directly Beneath EquationCard */}
          <div className="w-full max-w-[320px] sm:max-w-[340px]">
            <TactileNumpad
              onDigit={handleDigit}
              onBackspace={handleBackspace}
              onClear={handleClear}
              onSubmit={() => void submitAnswerValue()}
              showSubmit={!hasAutoSubmit}
              disabled={isSubmitting || isFinished || isPaused}
            />
          </div>
        </div>

        {/* Right Flank (Desktop): Squad Telemetry & Live Stats */}
        <div className="hidden lg:flex flex-col gap-3 w-56 xl:w-64 shrink-0">
          <div className="cyber-card p-3 relative text-left">
            <WashiTape color="pink" rotation="2.5deg" width="70px" className="-top-3 right-4" />
            <div className="font-mono text-[10px] text-[#ffe36e] font-bold tracking-widest uppercase mb-2 pb-1 border-b border-[#ffe36e]/20 flex items-center justify-between">
              <span>SQUAD TELEMETRY</span>
              <span className="text-[9px] text-[#2ee58f]">{onlineTeammatesCount} ONLINE</span>
            </div>

            <div className="flex flex-col gap-2 font-mono text-[11px]">
              {(teammates.length > 0 ? teammates : [{ rollNumber: currentRoll || 'YOU', name: currentName || 'Player', currentScore: score, streak, connected: true, completedQuestions: currentIndex }]).map((mate) => {
                const isMe = mate.rollNumber === currentRoll;
                const isDone = (mate.completedQuestions || 0) >= (questions.length || 15);
                const progressPct = Math.min(100, Math.round(((mate.completedQuestions || 0) / (questions.length || 15)) * 100));

                return (
                  <div
                    key={mate.rollNumber}
                    className={`p-2 border bg-[#090c0a] ${
                      isMe ? 'border-[#2ee58f]/50' : 'border-white/10'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5 truncate">
                        <RadarDot status={mate.connected ? (isDone ? 'butter' : 'online') : 'offline'} />
                        <span className="font-bold truncate text-[#e8ece3] text-xs">
                          {mate.name || mate.rollNumber}
                        </span>
                        {isMe && <span className="text-[9px] bg-[#2ee58f] text-[#090c0a] font-black px-1">YOU</span>}
                      </div>
                      <span className="text-[#ffe36e] font-bold text-xs shrink-0">
                        {(isMe ? score : (mate.individualScore ?? mate.currentScore ?? 0)).toLocaleString()} pts
                      </span>
                    </div>

                    {/* Micro Progress Bar */}
                    <div className="flex items-center gap-1.5 text-[9px] text-[#aab5ac]">
                      <div className="flex-1 h-1 bg-[#141a16] border border-white/10 overflow-hidden">
                        <div
                          className={`h-full ${isDone ? 'bg-[#ffe36e]' : 'bg-[#2ee58f]'}`}
                          style={{ width: `${isMe ? Math.min(100, Math.round((currentIndex / (questions.length || 15)) * 100)) : progressPct}%` }}
                        />
                      </div>
                      <span className={isDone ? 'text-[#ffe36e] font-bold' : 'text-[#2ee58f]'}>
                        {isDone ? 'DONE' : `Q${(isMe ? currentIndex : (mate.completedQuestions || 0)) + 1}`}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Botanical Sticker Accent */}
          <div className="flex items-center justify-center py-1">
            <FlowerSticker id={8} size={50} rotation={8} withTape tapeColor="pink" interactive />
          </div>
        </div>
      </div>
    </div>
  );
}
