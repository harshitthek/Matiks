import React, { useState, useEffect, useCallback, useRef } from 'react';
import { EquationCard } from './EquationCard.jsx';
import { TactileNumpad } from './TactileNumpad.jsx';
import { SprintTimer } from './SprintTimer.jsx';
import { TeammateHud } from './TeammateHud.jsx';
import { SprintSummary } from './SprintSummary.jsx';
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

  const flashTimerRef = useRef(null);
  const lastResultTimerRef = useRef(null);
  const questionStartTimeRef = useRef(0);
  const pauseStartRef = useRef(null);
  const isSubmittingRef = useRef(false);
  const isFinishedRef = useRef(Boolean(initialIsFinished));
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
            a: activeQuestion?.a,
            b: activeQuestion?.b,
            answer: parsedAnswer,
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
  }, [handleDigit, handleBackspace, handleClear, submitAnswerValue, isActiveView, isFinished, isPaused]);

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
    <div className="w-full max-w-2xl mx-auto px-3 sm:px-4 py-1.5 sm:py-6">
      {/* Top Header Telemetry */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2 sm:mb-4 pb-2 sm:pb-3 border-b-2 border-[#2ee58f]/20">
        <div className="flex items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={() => setShowExitConfirm(true)}
            className="font-mono text-[11px] sm:text-xs text-[#aab5ac] hover:text-[#ffe36e] px-2 py-0.5 border border-white/15 hover:border-[#ffe36e] transition-colors cursor-pointer"
            title="Return to Squad Lobby"
          >
            ← LOBBY
          </button>
          <span className="font-mono text-[11px] sm:text-xs font-bold bg-[#ffe36e] text-[#090c0a] px-2 py-0.5 border border-[#090c0a]">
            #{teamCode || 'SQUAD'}
          </span>
          <span className="hidden xs:inline font-mono text-xs text-[#2ee58f] font-bold tracking-widest uppercase">
            {currentName ? `${currentName} // ` : ''}§ 02 // SPRINT ARENA
          </span>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {streak >= 3 && (
            <span className="font-mono text-[11px] sm:text-xs font-bold bg-[#f5a623] text-[#090c0a] px-2 py-0.5 border border-[#090c0a] shadow-[2px_2px_0_#090c0a] animate-pulse">
              🔥 {streak}x STREAK
            </span>
          )}
          <span className="font-mono text-xs sm:text-sm md:text-base font-extrabold text-[#e8ece3]">
            SCORE: <strong className="text-[#2ee58f]">{score.toLocaleString()}</strong>
          </span>
        </div>
      </div>

      {/* Accidental Back / Exit Confirmation Bar */}
      {(showExitConfirm || exitPromptRequested) && (
        <div className="border-2 border-[#f5a623] bg-[#f5a623]/15 p-3 mb-2.5 sm:mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 shadow-[4px_4px_0_#090c0a]">
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
              className="px-3 py-1.5 bg-[#2ee58f] border-2 border-[#090c0a] text-[#090c0a] font-mono font-bold text-xs uppercase shadow-[2px_2px_0_#090c0a] cursor-pointer"
            >
              STAY IN SPRINT
            </button>
            <button
              type="button"
              onClick={onReturnToLobby}
              className="px-3 py-1.5 bg-[#090c0a] border-2 border-[#ff6b5e] text-[#ff6b5e] font-mono font-bold text-xs uppercase cursor-pointer"
            >
              EXIT TO LOBBY
            </button>
          </div>
        </div>
      )}

      {/* Teammate Live HUD */}
      <div className="mb-2 sm:mb-4">
        <TeammateHud
          teammates={teammates}
          currentRoll={currentRoll}
          totalQuestions={questions.length || 15}
        />
      </div>

      {/* Submission Error Banner */}
      {submissionError && (
        <div className="border-2 border-[#ff6b5e] bg-[#ff6b5e]/20 p-2.5 sm:p-3 mb-2.5 sm:mb-4 text-center font-mono text-xs font-bold text-[#ff6b5e] tracking-widest uppercase">
          ⚠️ {submissionError}
        </div>
      )}

      {/* Precision 120s Timer */}
      <div className="mb-2.5 sm:mb-6">
        <SprintTimer
          startedAt={startedAt}
          durationSeconds={durationSeconds}
          isPaused={isPaused}
          onExpire={handleTimerExpire}
        />
      </div>

      {/* Paused Overlay Notice */}
      {isPaused && (
        <div className="border-2 border-[#f5a623] bg-[#f5a623]/20 p-3 sm:p-4 mb-2.5 sm:mb-6 text-center font-mono text-xs font-bold text-[#f5a623] tracking-widest uppercase animate-pulse">
          ⚠️ SPRINT PAUSED BY ORGANIZER — TIMER FROZEN
        </div>
      )}

      {/* Main Equation Card (Reflex 60fps) */}
      <div className="mb-2.5 sm:mb-6">
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

      {/* Tactile On-Screen Numpad for Touch / Mobile */}
      <div className="mt-2 sm:mt-4">
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
  );
}
