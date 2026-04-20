'use strict';

const GRID_W = 5;
const GRID_H = 9;
const GOALS_TO_WIN = 3;
const DIE_SIZE = 12;
const DECK_COMPOSITION = ['Forward', 'Forward', 'Forward', 'Forward', 'Forward', 'Left', 'Left', 'Left', 'Right', 'Right', 'Right'];
const DIFF_GOAL = [2, 2, 1, 2, 2];    // difficulty at goal line (closest row)
const DIFF_MID  = [11, 11, 12, 11, 11]; // difficulty at halfway line (row 4)

function shuffle(array) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function newState() {
  return {
    ball: { x: 2, y: 4 },
    possession: 'player',
    scores: { player: 0, ai: 0 },
    playerHand: [],
    playerDeck: shuffle(DECK_COMPOSITION),
    playerDiscard: [],
    aiHand: [],
    aiDeck: shuffle(DECK_COMPOSITION),
    aiDiscard: [],
    playerCardHistory: { Forward: 0, Left: 0, Right: 0, Shoot: 0 },
    playerDefenseHistory: { Forward: 0, Left: 0, Right: 0, Shoot: 0 },
    aiCardHistory: { Forward: 0, Left: 0, Right: 0, Shoot: 0 },
    aiDefenseHistory: { Forward: 0, Left: 0, Right: 0, Shoot: 0 },
    turns: 0,
    winner: null
  };
}

function drawHand(state, side) {
  const sideDeck = `${side}Deck`;
  const sideDiscard = `${side}Discard`;
  const sideHand = `${side}Hand`;
  state[sideDiscard].push(...state[sideHand]);
  state[sideHand] = [];
  for (let i = 0; i < 2; i++) {
    if (state[sideDeck].length === 0) {
      if (state[sideDiscard].length === 0) {
        state[sideDeck] = shuffle(DECK_COMPOSITION);
      } else {
        state[sideDeck] = shuffle(state[sideDiscard]);
        state[sideDiscard] = [];
      }
    }
    if (state[sideDeck].length > 0) state[sideHand].push(state[sideDeck].pop());
  }
}

function canShoot(state) {
  return state.possession === 'player' ? state.ball.y <= 4 : state.ball.y >= 4;
}

function calcDiff(x, dist) {
  // dist: 0 = goal line, 4 = halfway line
  return Math.round(DIFF_GOAL[x] + (DIFF_MID[x] - DIFF_GOAL[x]) * dist / 4);
}

function shotDifficulty(state) {
  const { x, y } = state.ball;
  const dist = state.possession === 'player' ? y : (8 - y);
  return calcDiff(x, dist);
}

function moveBall(state, card) {
  let { x, y } = state.ball;
  if (card === 'Forward') y += state.possession === 'player' ? -1 : 1;
  else if (card === 'Left') x -= 1;
  else if (card === 'Right') x += 1;
  return { x, y, oob: x < 0 || x >= GRID_W || y < 0 || y >= GRID_H };
}

function rollDie() {
  return Math.floor(Math.random() * DIE_SIZE) + 1;
}

function weightedRandom(weights) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  if (entries.length === 0) return 'Forward';
  let r = Math.random() * entries.reduce((sum, [, w]) => sum + w, 0);
  for (const [key, w] of entries) {
    r -= w;
    if (r <= 0) return key;
  }
  return entries[entries.length - 1][0];
}

function pickMove(state, side, isOffense) {
  const { x, y } = state.ball;
  const hand = [...state[`${side}Hand`], isOffense ? 'Shoot' : 'Block'];
  const opponentSide = side === 'player' ? 'ai' : 'player';
  const history = isOffense ? state[`${opponentSide}DefenseHistory`] : state[`${opponentSide}CardHistory`];
  
  const avoid = card => 1 / ((history[card === 'Block' ? 'Shoot' : card] || 0) + 1);

  const weights = {};
  hand.forEach(card => {
    if (isOffense) {
      if (card === 'Shoot') {
        if (canShoot(state)) {
          const dist = side === 'player' ? y : (8 - y);
          weights.Shoot = Math.max(0, 0.5 - dist * 0.1 - Math.abs(x - 2) * 0.1) * avoid('Shoot') * 4;
        } else weights.Shoot = 0;
      } else if (card === 'Forward') weights.Forward = avoid('Forward') * 5;
      else if (card === 'Left') weights.Left = x > 0 ? avoid('Left') * (x >= 3 ? 3 : 2) : 0;
      else if (card === 'Right') weights.Right = x < 4 ? avoid('Right') * (x <= 1 ? 3 : 2) : 0;
    } else {
      const actualCard = card === 'Block' ? 'Shoot' : card;
      weights[card] = (history[actualCard] || 0) + 1;
      if (card === 'Block' && !canShoot(state)) weights[card] = 0;
    }
  });

  return weightedRandom(weights);
}

function runGame() {
  const state = newState();
  drawHand(state, 'player');
  drawHand(state, 'ai');

  while (!state.winner && state.turns < 1000) {
    state.turns++;
    const attacker = state.possession;
    const defender = attacker === 'player' ? 'ai' : 'player';
    
    const offCard = pickMove(state, attacker, true);
    const defCardRaw = pickMove(state, defender, false);
    const defCard = defCardRaw === 'Block' ? 'Shoot' : defCardRaw;

    // Track history
    state[`${attacker}CardHistory`][offCard]++;
    state[`${defender}DefenseHistory`][defCard]++;

    if (offCard === defCard) {
      // Tackle / Block
      state.possession = defender;
      if (offCard === 'Shoot') {
        const kickRoll = rollDie();
        const kickDist = Math.ceil(kickRoll / 6); // 1-2 spaces on d12
        const { x, y } = state.ball;
        state.ball.y = state.possession === 'player' ? Math.max(y - kickDist, 0) : Math.min(y + kickDist, GRID_H - 1);
      }
    } else if (offCard === 'Shoot') {
      const diff = shotDifficulty(state);
      const roll = rollDie();
      if (roll > diff) {
        state.scores[attacker]++;
        if (state.scores[attacker] >= GOALS_TO_WIN) {
          state.winner = attacker;
        } else {
          state.ball = { x: 2, y: 4 };
          state.possession = defender;
        }
      } else {
        state.possession = defender;
      }
    } else {
      const pos = moveBall(state, offCard);
      if (pos.oob) {
        state.possession = defender;
      } else {
        state.ball = pos;
      }
    }

    if (!state.winner) {
      drawHand(state, 'player');
      drawHand(state, 'ai');
    }
  }
  return state;
}

const GAMES = 10000;
const results = { playerWins: 0, aiWins: 0, totalTurns: 0, turnCounts: [] };

for (let i = 0; i < GAMES; i++) {
  const game = runGame();
  if (game.winner === 'player') results.playerWins++;
  else if (game.winner === 'ai') results.aiWins++;
  results.totalTurns += game.turns;
  results.turnCounts.push(game.turns);
}

console.log(`--- Simulation Results (5x9 grid, d12, ${GAMES} games) ---`);
console.log(`Player Wins (Started): ${results.playerWins} (${(results.playerWins/GAMES*100).toFixed(1)}%)`);
console.log(`AI Wins (Opponent):    ${results.aiWins} (${(results.aiWins/GAMES*100).toFixed(1)}%)`);
console.log(`Avg Game Length:       ${(results.totalTurns/GAMES).toFixed(1)} turns`);
results.turnCounts.sort((a,b) => a-b);
console.log(`Median Game Length:    ${results.turnCounts[Math.floor(GAMES/2)]} turns`);
console.log('------------------------------------------');
