'use strict';

// ── Constants (mirrored from game.js) ─────────────────────────────────────

const GRID_W       = 5;
const GRID_H       = 11;
const GOALS_TO_WIN = 2;
const DIE_SIZE     = 12;
const DECK_COMPOSITION = [
  'Forward', 'Forward', 'Forward', 'Forward', 'Forward',
  'Left', 'Left', 'Left',
  'Right', 'Right', 'Right'
];
const ROW_DIFFS = [
  [2, 1, 1, 1, 2],
  [3, 2, 2, 2, 3],
  [5, 3, 2, 3, 5],
  [7, 5, 4, 5, 7],
  [9, 7, 6, 7, 9],
  [11, 11, 12, 11, 11],
];

const NUM_GAMES = 50000;

// ── Helpers ────────────────────────────────────────────────────────────────

function shuffle(array) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function rollDie() {
  return Math.floor(Math.random() * DIE_SIZE) + 1;
}

function getDifficulty(x, y, possession) {
  const dist = possession === 'player' ? y : (10 - y);
  if (dist < 0 || dist > 5) return null;
  return ROW_DIFFS[dist][x];
}

function canShoot(ball, possession) {
  return possession === 'player' ? ball.y <= 5 : ball.y >= 5;
}

function weightedRandom(weights) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  if (entries.length === 0) return null;
  let r = Math.random() * entries.reduce((sum, [, w]) => sum + w, 0);
  for (const [key, w] of entries) {
    r -= w;
    if (r <= 0) return key;
  }
  return entries[entries.length - 1][0];
}

function drawHand(deck, discard, hand) {
  discard.push(...hand);
  hand.length = 0;
  for (let i = 0; i < 3; i++) {
    if (deck.length === 0) {
      deck.push(...shuffle(discard));
      discard.length = 0;
    }
    if (deck.length > 0) hand.push(deck.pop());
  }
}

// ── AI logic ───────────────────────────────────────────────────────────────

function pickOffense(ball, possession, hand, defenseHistory) {
  const { x, y } = ball;
  const avoid = card => 1 / ((defenseHistory[card] || 0) + 1);

  if (canShoot(ball, possession)) {
    const dist = possession === 'player' ? y : (10 - y);
    const shootProb = Math.max(0, 0.5 - dist * 0.1 - Math.abs(x - 2) * 0.1) * avoid('Shoot') * 4;
    if (Math.random() < shootProb) return 'Shoot';
  }

  const weights = {};
  for (const card of hand) {
    if      (card === 'Forward') weights.Forward = avoid('Forward') * 5;
    else if (card === 'Left')    weights.Left    = x > 0 ? avoid('Left')  * (x >= 3 ? 3 : 2) : 0;
    else if (card === 'Right')   weights.Right   = x < 4 ? avoid('Right') * (x <= 1 ? 3 : 2) : 0;
  }
  return weightedRandom(weights) || 'Forward';
}

function pickDefense(hand, offenseHistory, ball, possession, blockCooldown) {
  const cards = [...new Set([...hand, 'Shoot'])];
  const weights = {};
  for (const card of cards) {
    weights[card] = (offenseHistory[card] || 0) + 1;
    if (card === 'Shoot' && (!canShoot(ball, possession) || blockCooldown > 0)) weights[card] = 0;
  }
  return weightedRandom(weights) || hand[0];
}

// ── Simulate one game ──────────────────────────────────────────────────────

function simGame(startingPossession) {
  const state = {
    ball: { x: 2, y: 5 },
    possession: startingPossession,
    scores: { player: 0, ai: 0 },
    playerHand: [], playerDeck: shuffle(DECK_COMPOSITION), playerDiscard: [],
    aiHand:     [], aiDeck:     shuffle(DECK_COMPOSITION), aiDiscard:     [],
    playerOffenseHistory: { Forward: 0, Left: 0, Right: 0, Shoot: 0 },
    playerDefenseHistory: { Forward: 0, Left: 0, Right: 0, Shoot: 0 },
    aiOffenseHistory:     { Forward: 0, Left: 0, Right: 0, Shoot: 0 },
    aiDefenseHistory:     { Forward: 0, Left: 0, Right: 0, Shoot: 0 },
    playerBlockCooldown:  0,
    aiBlockCooldown:      0,
  };

  drawHand(state.playerDeck, state.playerDiscard, state.playerHand);
  drawHand(state.aiDeck,     state.aiDiscard,     state.aiHand);

  const stats = {
    turns: 0, shots: 0, goals: 0,
    shotsByRow: Array(6).fill(0),
    goalsByRow: Array(6).fill(0),
    blockStreaks: {},   // histogram: streak_length -> count of times it occurred
  };

  // track current consecutive-block streak per defending side
  const blockStreak = { player: 0, ai: 0 };

  function recordBlockPick(side, pickedBlock) {
    if (pickedBlock) {
      blockStreak[side]++;
    } else {
      if (blockStreak[side] >= 2) {
        stats.blockStreaks[blockStreak[side]] = (stats.blockStreaks[blockStreak[side]] || 0) + 1;
      }
      blockStreak[side] = 0;
    }
  }

  while (state.scores.player < GOALS_TO_WIN && state.scores.ai < GOALS_TO_WIN) {
    stats.turns++;
    if (stats.turns > 2000) break;

    const poss  = state.possession;
    const opp   = poss === 'player' ? 'ai' : 'player';
    const offHand       = poss === 'player' ? state.playerHand          : state.aiHand;
    const defHand       = poss === 'player' ? state.aiHand              : state.playerHand;
    const offDefHistory = poss === 'player' ? state.aiDefenseHistory     : state.playerDefenseHistory;
    const defOffHistory = poss === 'player' ? state.playerOffenseHistory : state.aiOffenseHistory;

    const defBlockCooldown = opp === 'player' ? state.playerBlockCooldown : state.aiBlockCooldown;
    const offCard = pickOffense(state.ball, poss, offHand, offDefHistory);
    const defCard = pickDefense(defHand, defOffHistory, state.ball, poss, defBlockCooldown);

    if (defCard === 'Shoot') {
      if (opp === 'player') state.playerBlockCooldown = 2;
      else                  state.aiBlockCooldown     = 2;
    }

    recordBlockPick(opp, defCard === 'Shoot');

    (poss === 'player' ? state.playerOffenseHistory : state.aiOffenseHistory)[offCard]++;
    (poss === 'player' ? state.aiDefenseHistory     : state.playerDefenseHistory)[defCard]++;

    const match = offCard === defCard;

    if (offCard === 'Shoot') {
      stats.shots++;
      const dist = poss === 'player' ? state.ball.y : (10 - state.ball.y);
      if (dist >= 0 && dist <= 5) stats.shotsByRow[dist]++;

      if (match) {
        state.possession = opp;
        const kickRoll = rollDie();
        const kickDist = Math.ceil(kickRoll / 3);
        const newY = opp === 'player'
          ? Math.max(state.ball.y - kickDist, 0)
          : Math.min(state.ball.y + kickDist, GRID_H - 1);
        state.ball = { x: state.ball.x, y: newY };
      } else {
        const diff = getDifficulty(state.ball.x, state.ball.y, poss);
        const roll = rollDie();
        if (diff !== null && roll > diff) {
          stats.goals++;
          if (dist >= 0 && dist <= 5) stats.goalsByRow[dist]++;
          state.scores[poss]++;
          state.ball = { x: 2, y: 5 };
          state.possession = opp;
        } else {
          state.possession = opp;
        }
      }
    } else if (match) {
      state.possession = opp;
      if (offCard === 'Forward') {
        const newY = poss === 'player'
          ? Math.min(state.ball.y + 1, GRID_H - 1)
          : Math.max(state.ball.y - 1, 0);
        state.ball = { x: state.ball.x, y: newY };
      }
    } else {
      let { x, y } = state.ball;
      const dist = offCard === 'Forward' ? 2 : 1;
      if      (offCard === 'Forward') y += poss === 'player' ? -dist : dist;
      else if (offCard === 'Left')    x -= 1;
      else if (offCard === 'Right')   x += 1;
      if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) {
        state.possession = opp;
      } else {
        state.ball = { x, y };
      }
    }

    if (state.playerBlockCooldown > 0) state.playerBlockCooldown--;
    if (state.aiBlockCooldown     > 0) state.aiBlockCooldown--;

    drawHand(state.playerDeck, state.playerDiscard, state.playerHand);
    drawHand(state.aiDeck,     state.aiDiscard,     state.aiHand);
  }

  // flush any open streaks
  for (const side of ['player', 'ai']) {
    if (blockStreak[side] >= 2) {
      stats.blockStreaks[blockStreak[side]] = (stats.blockStreaks[blockStreak[side]] || 0) + 1;
    }
  }

  return {
    winner: state.scores.player >= GOALS_TO_WIN ? 'player' : 'ai',
    score:  `${state.scores.player}-${state.scores.ai}`,
    ...stats,
  };
}

// ── Run simulation ─────────────────────────────────────────────────────────

console.log(`Running ${NUM_GAMES.toLocaleString()} games...\n`);

const results = {
  playerWins: 0, aiWins: 0, scores: {},
  totalTurns: 0, totalShots: 0, totalGoals: 0,
  shotsByRow: Array(6).fill(0), goalsByRow: Array(6).fill(0),
  blockStreaks: {},
};

for (let i = 0; i < NUM_GAMES; i++) {
  const r = simGame(i % 2 === 0 ? 'player' : 'ai');
  if (r.winner === 'player') results.playerWins++;
  else results.aiWins++;
  results.scores[r.score] = (results.scores[r.score] || 0) + 1;
  results.totalTurns += r.turns;
  results.totalShots += r.shots;
  results.totalGoals += r.goals;
  for (let row = 0; row < 6; row++) {
    results.shotsByRow[row] += r.shotsByRow[row];
    results.goalsByRow[row] += r.goalsByRow[row];
  }
  for (const [len, cnt] of Object.entries(r.blockStreaks)) {
    results.blockStreaks[len] = (results.blockStreaks[len] || 0) + cnt;
  }
}

const pct = (n, d = NUM_GAMES) => (n / d * 100).toFixed(1) + '%';
const avg = n => (n / NUM_GAMES).toFixed(1);

console.log('── Results ───────────────────────────────');
console.log(`Player wins:    ${results.playerWins.toLocaleString().padStart(7)} (${pct(results.playerWins)})`);
console.log(`AI wins:        ${results.aiWins.toLocaleString().padStart(7)} (${pct(results.aiWins)})`);
console.log(`Avg turns/game: ${avg(results.totalTurns)}`);
console.log(`Avg shots/game: ${avg(results.totalShots)}`);
console.log(`Avg goals/game: ${avg(results.totalGoals)}`);

console.log('\n── Score distribution ────────────────────');
Object.entries(results.scores)
  .sort((a, b) => b[1] - a[1])
  .forEach(([score, count]) => {
    const bar = '█'.repeat(Math.round(count / NUM_GAMES * 50));
    console.log(`  ${score.padEnd(6)} ${bar} ${pct(count)}`);
  });

console.log('\n── Shots & conversion by row ─────────────');
console.log('  Row  Label        Shots    Goals   Conv%');
const labels = ['goal line', 'row 1    ', 'row 2    ', 'row 3    ', 'row 4    ', 'midfield '];
for (let row = 0; row < 6; row++) {
  const shots = results.shotsByRow[row];
  const goals = results.goalsByRow[row];
  const conv  = shots > 0 ? pct(goals, shots) : '   n/a';
  console.log(`  ${row}    ${labels[row]}  ${String(shots).padStart(6)}   ${String(goals).padStart(5)}   ${conv}`);
}

console.log('\n── Consecutive Block streaks (2+) ────────');
const totalStreaks = Object.values(results.blockStreaks).reduce((a, b) => a + b, 0);
if (totalStreaks === 0) {
  console.log('  None observed.');
} else {
  Object.entries(results.blockStreaks)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .forEach(([len, cnt]) => {
      const bar = '█'.repeat(Math.round(cnt / totalStreaks * 30));
      console.log(`  ${len}x Block  ${bar} ${cnt.toLocaleString()} occurrences (${pct(cnt, totalStreaks)} of streaks)`);
    });
  console.log(`  Total streak events: ${totalStreaks.toLocaleString()} across ${NUM_GAMES.toLocaleString()} games`);
}
