'use strict';

// ── Constants ──────────────────────────────────────────────────────────────

const GRID_W      = 5;
const GRID_H      = 11;
const GOALS_TO_WIN = 5;
const CARD_EMOJI  = { Forward: '⬆️', Left: '⬅️', Right: '➡️', Shoot: '🎯' };
const DIFF_GOAL = [5, 3, 2, 3, 5];    // difficulty at goal line (closest row)
const DIFF_MID  = [19, 19, 20, 19, 19]; // difficulty at halfway line (furthest row)

// ── State ──────────────────────────────────────────────────────────────────

let state = null;

function newState() {
  return {
    ball:       { x: 2, y: 5 },
    possession: 'player',           // 'player' | 'ai'
    scores:     { player: 0, ai: 0 },
    phase:      'selectCard',        // 'selectCard' | 'aiThink' | 'playerDefend' | 'resolving' | 'gameOver'
    aiCard:     null,
    playerCardHistory: { Forward: 0, Left: 0, Right: 0, Shoot: 0 },
    history:    ['Game started! YOU have the biscuit.'],
    winner:     null,
  };
}

// ── DOM helpers ────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
}

// ── Game helpers ───────────────────────────────────────────────────────────

function canShoot() {
  return state.possession === 'player' ? state.ball.y < 5 : state.ball.y > 5;
}

function calcDiff(x, dist) {
  // dist: 0 = goal line, 4 = halfway line
  return Math.round(DIFF_GOAL[x] + (DIFF_MID[x] - DIFF_GOAL[x]) * dist / 4);
}

function shotDifficulty() {
  const { x, y } = state.ball;
  const dist = state.possession === 'player' ? y : (10 - y);
  return calcDiff(x, dist);
}

function cellDifficulty(x, y) {
  if (state.possession === 'player' && y >= 5) return null;
  if (state.possession === 'ai'     && y <= 5) return null;
  const dist = state.possession === 'player' ? y : (10 - y);
  return calcDiff(x, dist);
}

function moveBall(card) {
  let { x, y } = state.ball;
  if      (card === 'Forward') y += state.possession === 'player' ? -1 : 1;
  else if (card === 'Left')    x -= 1;
  else if (card === 'Right')   x += 1;
  return { x, y, oob: x < 0 || x >= GRID_W || y < 0 || y >= GRID_H };
}

function switchPossession() {
  state.possession = state.possession === 'player' ? 'ai' : 'player';
}

function log(msg) { state.history.push(msg); }

// ── AI ─────────────────────────────────────────────────────────────────────

function weightedRandom(weights) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  let r = Math.random() * entries.reduce((sum, [, w]) => sum + w, 0);
  for (const [key, w] of entries) {
    r -= w;
    if (r <= 0) return key;
  }
  return entries[entries.length - 1][0];
}

function aiPickOffense() {
  const { x, y } = state.ball;

  if (canShoot()) {
    const dist = 10 - y; // 0 = goal line, 4 = halfway
    const shootProb = Math.max(0, 0.5 - dist * 0.1 - Math.abs(x - 2) * 0.08);
    if (Math.random() < shootProb) return 'Shoot';
  }

  return weightedRandom({
    Forward: 5,
    Left:    x > 0 ? (x >= 3 ? 3 : 2) : 0,
    Right:   x < 4 ? (x <= 1 ? 3 : 2) : 0,
  });
}

function aiPickDefense() {
  const h = state.playerCardHistory;
  return weightedRandom({
    Forward: h.Forward + 1,
    Left:    h.Left    + 1,
    Right:   h.Right   + 1,
    Shoot:   canShoot() ? h.Shoot + 1 : 0,
  });
}

// ── Resolve ────────────────────────────────────────────────────────────────

function resolveRound(offCard, defCard) {
  const match = offCard === defCard;

  if (offCard === 'Shoot') {
    if (match) {
      switchPossession();
      const pos = moveBall('Forward');
      if (!pos.oob) state.ball = pos;
      log('🛡️ Shot blocked!');
      return { type: 'blocked' };
    }
    const diff  = shotDifficulty();
    const roll  = Math.floor(Math.random() * 20) + 1;
    const scored = roll > diff;
    return { type: 'shot', roll, diff, scored };
  }

  if (match) {
    switchPossession();
    const pos = moveBall(offCard);
    if (!pos.oob) state.ball = pos;
    log('⚔️ Tackled!');
    return { type: 'tackled' };
  }

  const pos = moveBall(offCard);
  if (pos.oob) {
    switchPossession();
    log('🍪 Out of bounds!');
    return { type: 'oob' };
  }
  state.ball = pos;
  log(`✅ ${CARD_EMOJI[offCard]} ${offCard}`);
  return { type: 'moved' };
}

// ── After resolve ──────────────────────────────────────────────────────────

function afterResolve(result) {
  if (result.type === 'shot') {
    const { roll, diff, scored } = result;
    if (scored) {
      const scorer = state.possession;
      state.scores[scorer]++;
      log(`⚽ GOAL! (rolled ${roll}, needed >${diff})`);

      if (state.scores[scorer] >= GOALS_TO_WIN) {
        state.winner = scorer;
        state.phase  = 'gameOver';
        render();
        setTimeout(showGameOver, 1000);
        return;
      }

      state.ball = { x: 2, y: 5 };
      switchPossession();
      log(state.possession === 'player' ? 'YOU have the biscuit.' : 'AI has the biscuit.');
    } else {
      log(`❌ Miss! (rolled ${roll}, needed >${diff})`);
      switchPossession();
    }
  }

  state.phase = 'selectCard';
  render();

  if (state.possession === 'ai') scheduleAiTurn();
}

// ── Turn flow ──────────────────────────────────────────────────────────────

function onPlayerOffense(card) {
  if (state.phase !== 'selectCard' || state.possession !== 'player') return;
  if (card === 'Shoot' && !canShoot()) return;

  state.playerCardHistory[card]++;
  state.phase = 'resolving';
  render();

  setTimeout(() => {
    const defCard = aiPickDefense();
    const result  = resolveRound(card, defCard);
    afterResolve(result);
  }, 500);
}

function onPlayerDefense(card) {
  if (state.phase !== 'playerDefend') return;

  state.phase = 'resolving';
  render();

  setTimeout(() => {
    const result = resolveRound(state.aiCard, card);
    afterResolve(result);
  }, 500);
}

function scheduleAiTurn() {
  state.phase = 'aiThink';
  render();

  setTimeout(() => {
    state.aiCard = aiPickOffense();
    state.phase  = 'playerDefend';
    render();
  }, 900);
}

// ── Render ─────────────────────────────────────────────────────────────────

function buildGrid() {
  const field = $('field');
  field.innerHTML = '';
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.id = `c${x}${y}`;
      if (y === 5)               cell.classList.add('midfield');
      if (y === 0 || y === GRID_H - 1) cell.classList.add('goal-row');
      field.appendChild(cell);
    }
  }
}

function diffClass(diff) {
  if (diff <= 5)  return 'diff-easy';
  if (diff <= 10) return 'diff-medium';
  if (diff <= 15) return 'diff-hard';
  return 'diff-vhard';
}

function updateGrid() {
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const cell = $(`c${x}${y}`);
      cell.className = cell.className
        .replace(/\b(has-ball|diff-\w+|no-shot)\b/g, '').trim();

      if (state.ball.x === x && state.ball.y === y) {
        cell.textContent = '⚽';
        cell.classList.add('has-ball');
      } else {
        const diff = cellDifficulty(x, y);
        if (diff === null) {
          cell.textContent = '';
          cell.classList.add('no-shot');
        } else {
          cell.textContent = diff;
          cell.classList.add(diffClass(diff));
        }
      }
    }
  }
}

function updateUI() {
  $('score-player').textContent = state.scores.player;
  $('score-ai').textContent     = state.scores.ai;

  const possEl = $('poss-label');
  if (state.possession === 'player') {
    possEl.textContent = '🔴 YOU';
    possEl.className   = 'poss-you';
  } else {
    possEl.textContent = '🔵 AI';
    possEl.className   = 'poss-ai';
  }

  const phaseEl = $('phase-label');
  switch (state.phase) {
    case 'selectCard':
      phaseEl.textContent = state.possession === 'player' ? 'Pick your play' : 'AI thinking...';
      break;
    case 'aiThink':
      phaseEl.textContent = 'AI choosing...';
      break;
    case 'playerDefend':
      phaseEl.textContent = 'Guess their play';
      break;
    case 'resolving':
      phaseEl.textContent = 'Resolving...';
      break;
    case 'gameOver':
      phaseEl.textContent = state.winner === 'player' ? 'YOU WIN!' : 'AI WINS!';
      break;
  }

  const offEl = $('btns-offense');
  const defEl = $('btns-defense');
  offEl.classList.add('hidden');
  defEl.classList.add('hidden');

  if (state.phase === 'selectCard' && state.possession === 'player') {
    offEl.classList.remove('hidden');
    document.querySelectorAll('.card-btn').forEach(btn => {
      btn.disabled = btn.dataset.card === 'Shoot' && !canShoot();
    });
  } else if (state.phase === 'playerDefend') {
    defEl.classList.remove('hidden');
    document.querySelectorAll('.def-btn').forEach(btn => {
      btn.disabled = btn.dataset.card === 'Shoot' && !canShoot();
    });
  }

  const logEl = $('log-area');
  logEl.innerHTML = state.history.slice(-3).map(m =>
    `<div class="log-entry">${m}</div>`
  ).join('');
}

function render() {
  updateGrid();
  updateUI();
}

// ── Game over ──────────────────────────────────────────────────────────────

function showGameOver() {
  const { player, ai } = state.scores;
  const win = state.winner === 'player';

  $('gameover-icon').textContent = win ? '🏆' : '😤';
  const title = $('gameover-title');
  title.textContent = win ? 'YOU WIN!' : 'AI WINS!';
  title.className = win ? '' : 'cpu-win';

  $('final-scores').innerHTML = `
    <div class="final-score-row">
      <span class="you-label">YOU</span>
      <span class="score you-score">${player}</span>
      <span class="sep">–</span>
      <span class="score ai-score">${ai}</span>
      <span class="ai-label">AI</span>
    </div>
  `;

  showScreen('screen-gameover');
}

// ── Init ───────────────────────────────────────────────────────────────────

$('btn-start').addEventListener('click', () => {
  state = newState();
  buildGrid();
  render();
  showScreen('screen-game');
});

$('btn-restart').addEventListener('click', () => showScreen('screen-title'));

document.querySelectorAll('.card-btn').forEach(btn =>
  btn.addEventListener('click', () => onPlayerOffense(btn.dataset.card))
);

document.querySelectorAll('.def-btn').forEach(btn =>
  btn.addEventListener('click', () => onPlayerDefense(btn.dataset.card))
);

showScreen('screen-title');
