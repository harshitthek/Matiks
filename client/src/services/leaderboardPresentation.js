const isEligible = entry => !entry.isDisqualified && entry.activeMembersCount > 0 && entry.status !== 'WAITING';

export function selectPodium(standings, finishedOnly = false) {
  return standings.filter(entry => isEligible(entry) && (!finishedOnly || entry.status === 'FINISHED')).slice(0, 3);
}

export function canStartCeremony(standings, windowStatus) {
  return windowStatus?.isOpen === false && windowStatus.opensAt > 0 &&
    !standings.some(entry => !entry.isDisqualified && entry.status === 'IN_SPRINT') &&
    selectPodium(standings, true).length > 0;
}

export function formatLeaderboardScore(score) {
  const value = Number.isFinite(score) ? Math.max(0, score) : 0;
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
