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
  startedAt = 0,
  durationSeconds = 120,
  initialIsPaused = false,
  teamCode,
  memberToken,
  currentRoll,
  currentName,
  exitPromptRequested = false,
  onDismissExitPrompt,
  onSprintFinishedChange,
  onReturnToLobby,
  onPlayAgain,
  onViewLeaderboard
}) {
  const [currentIndex, setCurrentIndex] = useState(initialQuestionIndex || 0);
  const [currentInput, setCurrentInput] = useState('');
  const [score, setScore] = useState(initialScore || 0);
  const [streak, setStreak] = useState(initialStreak || 0);
  const [maxStreak, setMaxStreak] = useState(initialStreak || 0);
  const [submissions, setSubmissions] = useState([]);
  const [flashState, setFlashState] = useState(null); // 'correct' | 'incorrect' | null
  const [lastResult, setLastResult] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [isTimeOut, setIsTimeOut] = useState(false);
  const [isPaused, setIsPaused] = useState(Boolean(initialIsPaused));
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [submissionError, setSubmissionError] = useState(null);
  const [teammates, setTeammates] = useState([]);

  const flashTimerRef = useRef(null);
  const lastResultTimerRef = useRef(null);
  const questionStartTimeRef = useRef(0);
  const pauseStartRef = useRef(null);
  const isSubmittingRef = useRef(false);
  const isFinishedRef = useRef(false);

  // Initialize question start time on mount
  useEffect(() => {
    questionStartTimeRef.current = performance.now();
  }, []);

  useEffect(() => {
    onSprintFinishedChange?.(isFinished);
  }, [isFinished, onSprintFinishedChange]);

  // Subscribe to Team SSE Stream for live teammate HUD, snapshots, and admin pauses
  useEffect(() => {
    if (!teamCode) return;

    const sse = connectTeamStream(teamCode, memberToken, {
      onSnapshot: (data) => {
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
  }, [teamCode, memberToken]);

  // Clean up flash and floating callout timers
  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      if (lastResultTimerRef.current) clearTimeout(lastResultTimerRef.current);
    };
  }, []);

  const currentQuestion = questions[currentIndex];

  // Submit current answer
  const handleSubmitAnswer = useCallback(async () => {
    if (isSubmittingRef.current || isFinished || isPaused) return;
    if (!currentInput || currentInput.trim().length === 0) return;

    const parsedAnswer = parseInt(currentInput.trim(), 10);
    if (!Number.isFinite(parsedAnswer)) return;

    isSubmittingRef.current = true;
    const nowPerf = performance.now();
    const clientDeltaMs = Math.max(50, Math.round(nowPerf - questionStartTimeRef.current));
    const clientTimestamp = Date.now();

    setIsSubmitting(true);

    try {
      setSubmissionError(null);
      const res = await submitAnswer(
        sessionId,
        currentIndex,
        parsedAnswer,
        clientDeltaMs,
        clientTimestamp,
        memberToken
      );

      const isCorrect = Boolean(res.isCorrect);
      const points = Number(res.pointsAwarded) || 0;
      const newScore = typeof res.currentScore === 'number' ? res.currentScore : score + points;
      const newStreak =
        typeof res.consecutiveStreak === 'number'
          ? res.consecutiveStreak
          : isCorrect
          ? streak + 1
          : 0;

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

      // Hit feedback badge
      setLastResult({
        isCorrect,
        pointsAwarded: points,
        consecutiveStreak: newStreak
      });
      if (lastResultTimerRef.current) clearTimeout(lastResultTimerRef.current);
      lastResultTimerRef.current = setTimeout(() => {
        setLastResult(null);
      }, 700);

      // Record submission record
      setSubmissions((prev) => [
        ...prev,
        {
          questionIndex: currentIndex,
          a: currentQuestion?.a,
          b: currentQuestion?.b,
          answer: parsedAnswer,
          isCorrect,
          pointsAwarded: points,
          latencyMs: clientDeltaMs
        }
      ]);

      setScore(newScore);
      setStreak(newStreak);
      setMaxStreak((prevMax) => Math.max(prevMax, newStreak));

      // Advance to next question or complete sprint
      if (res.isFinished || currentIndex + 1 >= questions.length) {
        if (!isFinishedRef.current) {
          isFinishedRef.current = true;
          setIsFinished(true);
          soundFx.playFinish();
        }
      } else {
        if (isFinishedRef.current) return;
        setCurrentIndex((prev) => prev + 1);
        setCurrentInput('');
        questionStartTimeRef.current = performance.now();
      }
    } catch (err) {
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
        if (!isFinishedRef.current) {
          setSubmissionError(err?.message || 'Submission failed');
        }
      }
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  }, [
    isFinished,
    isPaused,
    currentInput,
    sessionId,
    currentIndex,
    memberToken,
    score,
    streak,
    currentQuestion,
    questions.length
  ]);

  // Digits input logic
  const handleDigit = useCallback(
    (digit) => {
      if (isFinished || isPaused) return;
      setCurrentInput((prev) => {
        if (prev.length >= 3) return prev; // Sums range up to 198 (3 digits max)
        return prev + digit;
      });
    },
    [isFinished, isPaused]
  );

  const handleClear = useCallback(() => {
    if (isFinished || isPaused) return;
    setCurrentInput('');
  }, [isFinished, isPaused]);

  // Zetamac Physical Keyboard listeners (Universal Explicit Submit)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (isFinished || isPaused) return;

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
        setCurrentInput((prev) => prev.slice(0, -1));
      } else if (e.key === 'Escape') {
        soundFx.playKeyClick();
        handleClear();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault(); // Prevent Spacebar from scrolling
        if (e.repeat) return;
        soundFx.playKeyClick();
        handleSubmitAnswer();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleDigit, handleClear, handleSubmitAnswer, isFinished, isPaused]);

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
    <div className="w-full max-w-2xl mx-auto px-4 py-4 sm:py-6">
      {/* Top Header Telemetry */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4 pb-3 border-b-2 border-[#2ee58f]/20">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowExitConfirm(true)}
            className="font-mono text-xs text-[#aab5ac] hover:text-[#ffe36e] px-2 py-0.5 border border-white/15 hover:border-[#ffe36e] transition-colors cursor-pointer"
            title="Return to Squad Lobby"
          >
            ← LOBBY
          </button>
          <span className="font-mono text-xs font-bold bg-[#ffe36e] text-[#090c0a] px-2 py-0.5 border border-[#090c0a]">
            #{teamCode || 'SQUAD'}
          </span>
          <span className="font-mono text-xs text-[#2ee58f] font-bold tracking-widest uppercase">
            {currentName ? `${currentName} // ` : ''}§ 02 // SPRINT ARENA
          </span>
        </div>

        <div className="flex items-center gap-3">
          {streak >= 3 && (
            <span className="font-mono text-xs font-bold bg-[#f5a623] text-[#090c0a] px-2 py-0.5 border border-[#090c0a] shadow-[2px_2px_0_#090c0a] animate-pulse">
              🔥 {streak}x STREAK
            </span>
          )}
          <span className="font-mono text-sm md:text-base font-extrabold text-[#e8ece3]">
            SCORE: <strong className="text-[#2ee58f]">{score.toLocaleString()}</strong>
          </span>
        </div>
      </div>

      {/* Accidental Back / Exit Confirmation Bar */}
      {(showExitConfirm || exitPromptRequested) && (
        <div className="border-2 border-[#f5a623] bg-[#f5a623]/15 p-3.5 mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-[4px_4px_0_#090c0a]">
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
      <div className="mb-4">
        <TeammateHud
          teammates={teammates}
          currentRoll={currentRoll}
          totalQuestions={questions.length || 15}
        />
      </div>

      {/* Submission Error Banner */}
      {submissionError && (
        <div className="border-2 border-[#ff6b5e] bg-[#ff6b5e]/20 p-3 mb-4 text-center font-mono text-xs font-bold text-[#ff6b5e] tracking-widest uppercase">
          ⚠️ {submissionError}
        </div>
      )}

      {/* Precision 120s Timer */}
      <div className="mb-6">
        <SprintTimer
          startedAt={startedAt}
          durationSeconds={durationSeconds}
          isPaused={isPaused}
          onExpire={handleTimerExpire}
        />
      </div>

      {/* Paused Overlay Notice */}
      {isPaused && (
        <div className="border-2 border-[#f5a623] bg-[#f5a623]/20 p-4 mb-6 text-center font-mono text-xs font-bold text-[#f5a623] tracking-widest uppercase animate-pulse">
          ⚠️ SPRINT PAUSED BY ORGANIZER — TIMER FROZEN
        </div>
      )}

      {/* Main Equation Card (Reflex 60fps) */}
      <div className="mb-6">
        <EquationCard
          question={currentQuestion}
          questionNumber={currentIndex + 1}
          totalQuestions={questions.length || 15}
          currentInput={currentInput}
          flashState={flashState}
          lastResult={lastResult}
          isSubmitting={isSubmitting}
        />
      </div>

      {/* Tactile On-Screen Numpad for Touch / Mobile */}
      <div className="mt-4">
        <TactileNumpad
          onDigit={handleDigit}
          onClear={handleClear}
          onSubmit={handleSubmitAnswer}
          disabled={isSubmitting || isFinished || isPaused}
        />
      </div>
    </div>
  );
}
