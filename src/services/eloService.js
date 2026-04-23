function bracket(rank) {
  return rank >= 1 && rank <= 20 ? 'high' : 'low';
}

function eloChange({ winnerRank, loserRank }) {
  const wB = bracket(winnerRank);
  const lB = bracket(loserRank);

  if (wB === lB) return { winner: 15, loser: -15 };

  if (wB === 'high' && lB === 'low') {
    return { winner: 10, loser: -5 };
  }

  return { winner: 25, loser: -18 };
}

function streakBonus(streak) {
  if (streak <= 1) return 0;
  return streak;
}

module.exports = { eloChange, streakBonus, bracket };
