'use strict';

// ═══════════════════════════════════════════
// КОНСТАНТЫ
// ═══════════════════════════════════════════
const SIZE  = 10;
const FLEET = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1];
const FLEET_COUNTS = { 4: 1, 3: 2, 2: 3, 1: 4 };

// ═══════════════════════════════════════════
// СОСТОЯНИЕ
// ═══════════════════════════════════════════
let state = {};

function resetState() {
  state = {
    phase: 'placement',
    orientation: 'h',
    shipQueue: [...FLEET],

    playerGrid: makeGrid(),   // [r][c] → shipId или null
    enemyGrid:  makeGrid(),

    playerShips: [],  // { id, size, cells[[r,c]], hits:Set, sunk }
    enemyShips:  [],

    playerShotSet: new Set(),  // 'r,c' — куда стрелял игрок
    enemyShotSet:  new Set(),  // 'r,c' — куда стрелял компьютер

    playerEnchantix: true,
    enemyEnchantix:  true,
    enchantixMode:   false,    // следующий клик — Enchantix

    enemyEnchantixAt: randInt(4, 14), // через сколько ходов ПК применит Enchantix
    enemyMoveCount:   0,

    // ИИ компьютера: режим добивания
    enemyPendingHits: [],  // клетки попаданий по ещё не потопленному кораблю
    enemyTargetStack: [],  // кандидаты для следующего выстрела

    turn:     'player',
    gameOver: false,
  };
}

function makeGrid() {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ═══════════════════════════════════════════
// DOM
// ═══════════════════════════════════════════
const screens = {
  rules:     document.getElementById('screen-rules'),
  placement: document.getElementById('screen-placement'),
  game:      document.getElementById('screen-game'),
  end:       document.getElementById('screen-end'),
};

const elBoards = {
  placement: document.getElementById('board-placement'),
  player:    document.getElementById('board-player'),
  enemy:     document.getElementById('board-enemy'),
};

const btnRotate    = document.getElementById('btn-rotate');
const btnUndo      = document.getElementById('btn-undo');
const btnStartGame = document.getElementById('btn-start-game');
const btnEnchantix = document.getElementById('btn-enchantix');
const btnRestart   = document.getElementById('btn-restart');

const elOriBadge   = document.getElementById('orientation-badge');
const elHint       = document.getElementById('placement-hint');
const elStatus        = document.getElementById('status-text');
const elToast         = document.getElementById('toast');
const elEnchantixFlash = document.getElementById('enchantix-flash');
const elScoreP        = document.getElementById('score-player');
const elScoreE     = document.getElementById('score-enemy');
const elEnchHint   = document.getElementById('enchantix-hint');

// ═══════════════════════════════════════════
// УТИЛИТЫ: СЕТКА
// ═══════════════════════════════════════════

// Список клеток [r,c] для корабля
function getCells(r, c, size, ori) {
  return Array.from({ length: size }, (_, i) =>
    ori === 'h' ? [r, c + i] : [r + i, c]
  );
}

// Все клетки вокруг корабля (включая сам корабль)
function getZone(cells) {
  const zone = new Set();
  for (const [r, c] of cells) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE) {
          zone.add(`${nr},${nc}`);
        }
      }
    }
  }
  return zone;
}

function inBounds(cells) {
  return cells.every(([r, c]) => r >= 0 && r < SIZE && c >= 0 && c < SIZE);
}

function isValidPlacement(grid, cells) {
  if (!inBounds(cells)) return false;
  for (const key of getZone(cells)) {
    const [r, c] = key.split(',').map(Number);
    if (grid[r][c] !== null) return false;
  }
  return true;
}

function placeShipOnGrid(grid, cells, shipId) {
  for (const [r, c] of cells) grid[r][c] = shipId;
}

// Автоматическая расстановка (для компьютера)
function autoPlace(grid, ships) {
  for (const size of FLEET) {
    let ok = false;
    while (!ok) {
      const r   = randInt(0, SIZE - 1);
      const c   = randInt(0, SIZE - 1);
      const ori = Math.random() < 0.5 ? 'h' : 'v';
      const cells = getCells(r, c, size, ori);
      if (isValidPlacement(grid, cells)) {
        const id = ships.length;
        ships.push({ id, size, cells, hits: new Set(), sunk: false });
        placeShipOnGrid(grid, cells, id);
        ok = true;
      }
    }
  }
}

// ═══════════════════════════════════════════
// РЕНДЕР ПОЛЯ
// ═══════════════════════════════════════════

// Строит клетки поля. options:
//   showShips  — рисовать корабли
//   isEnemy    — добавляет класс enemy + обработчик выстрела
//   shots      — Set ключей 'r,c' (попадания/промахи)
//   ships      — массив кораблей (для пометки потопленных)
function buildBoard(boardEl, grid, ships, opts = {}) {
  boardEl.innerHTML = '';
  if (opts.isEnemy) boardEl.classList.add('enemy');

  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.r = r;
      cell.dataset.c = c;

      const shipId = grid[r][c];
      const key    = `${r},${c}`;
      const wasShot = opts.shots && opts.shots.has(key);

      if (wasShot) {
        if (shipId !== null) {
          const ship = ships[shipId];
          cell.classList.add(ship.sunk ? 'sunk' : 'hit');
        } else {
          cell.classList.add('miss');
        }
      } else if (!opts.isEnemy && opts.showShips && shipId !== null) {
        cell.classList.add('ship');
      }

      boardEl.appendChild(cell);
    }
  }
}

// ═══════════════════════════════════════════
// РАССТАНОВКА: ЛОГИКА
// ═══════════════════════════════════════════

function renderPlacementBoard() {
  buildBoard(elBoards.placement, state.playerGrid, state.playerShips, { showShips: true });

  elBoards.placement.querySelectorAll('.cell').forEach(cell => {
    cell.addEventListener('mouseenter', onPlacementEnter);
    cell.addEventListener('mouseleave', onPlacementLeave);
    cell.addEventListener('click',      onPlacementClick);
  });
}

function clearPreview() {
  elBoards.placement.querySelectorAll('.preview-valid, .preview-invalid').forEach(el => {
    el.classList.remove('preview-valid', 'preview-invalid');
  });
}

function onPlacementEnter(e) {
  if (!state.shipQueue.length) return;
  const r = +e.currentTarget.dataset.r;
  const c = +e.currentTarget.dataset.c;

  const cells = getCells(r, c, state.shipQueue[0], state.orientation);
  const valid = isValidPlacement(state.playerGrid, cells);

  clearPreview();
  for (const [pr, pc] of cells) {
    const el = elBoards.placement.querySelector(`[data-r="${pr}"][data-c="${pc}"]`);
    if (el) el.classList.add(valid ? 'preview-valid' : 'preview-invalid');
  }
}

function onPlacementLeave() {
  clearPreview();
}

function onPlacementClick(e) {
  if (!state.shipQueue.length) return;

  const r     = +e.currentTarget.dataset.r;
  const c     = +e.currentTarget.dataset.c;
  const size  = state.shipQueue[0];
  const cells = getCells(r, c, size, state.orientation);

  if (!isValidPlacement(state.playerGrid, cells)) return;

  const id = state.playerShips.length;
  state.playerShips.push({ id, size, cells, hits: new Set(), sunk: false });
  placeShipOnGrid(state.playerGrid, cells, id);
  state.shipQueue.shift();

  updateShipSidebar();
  renderPlacementBoard();
  updatePlacementButtons();

  if (state.shipQueue.length === 0) {
    elHint.textContent = 'Все корабли расставлены! Нажми «Начать игру»';
  } else {
    elHint.textContent = `Следующий корабль: ${state.shipQueue[0]} клетки`;
  }
}

function undoLastShip() {
  if (!state.playerShips.length) return;

  const ship = state.playerShips.pop();

  // Стираем корабль с сетки
  for (const [r, c] of ship.cells) state.playerGrid[r][c] = null;

  // Возвращаем размер в начало очереди
  state.shipQueue.unshift(ship.size);

  updateShipSidebar();
  renderPlacementBoard();
  updatePlacementButtons();

  elHint.textContent = `Следующий корабль: ${state.shipQueue[0]} клетки`;
}

function updatePlacementButtons() {
  btnUndo.disabled      = state.playerShips.length === 0;
  btnStartGame.disabled = state.shipQueue.length > 0;
  btnRotate.disabled    = state.shipQueue.length === 0;
}

function updateShipSidebar() {
  const placed = {};
  for (const s of state.playerShips) placed[s.size] = (placed[s.size] || 0) + 1;

  const currentSize = state.shipQueue[0] ?? null;

  // Находим первый ещё не полностью размещённый элемент нужного размера
  let currentMarked = false;
  document.querySelectorAll('.ship-item').forEach(item => {
    const size = +item.dataset.size;
    const isPlaced = (placed[size] || 0) >= FLEET_COUNTS[size];
    item.classList.toggle('placed', isPlaced);

    const isCurrent = !isPlaced && size === currentSize && !currentMarked;
    item.classList.toggle('current', isCurrent);
    if (isCurrent) currentMarked = true;
  });
}

// ═══════════════════════════════════════════
// КНОПКИ РАССТАНОВКИ
// ═══════════════════════════════════════════

document.getElementById('btn-to-placement').addEventListener('click', () => {
  showScreen('placement');
});

btnRotate.addEventListener('click', () => {
  state.orientation = state.orientation === 'h' ? 'v' : 'h';
  elOriBadge.textContent = state.orientation === 'h' ? '→ Горизонтально' : '↓ Вертикально';
  clearPreview();
});

btnUndo.addEventListener('click', undoLastShip);

btnStartGame.addEventListener('click', () => {
  autoPlace(state.enemyGrid, state.enemyShips);
  state.phase = 'game';
  showScreen('game');
  initGameScreen();
});

// ═══════════════════════════════════════════
// ИГРОВОЙ ЭКРАН
// ═══════════════════════════════════════════

function initGameScreen() {

  buildBoard(elBoards.player, state.playerGrid, state.playerShips,
    { showShips: true, shots: state.enemyShotSet });

  buildBoard(elBoards.enemy, state.enemyGrid, state.enemyShips,
    { isEnemy: true, shots: state.playerShotSet });

  elBoards.enemy.querySelectorAll('.cell').forEach(cell => {
    cell.addEventListener('click',      onEnemyCellClick);
    cell.addEventListener('mouseenter', onEnemyCellEnter);
    cell.addEventListener('mouseleave', onEnemyCellLeave);
  });

  btnEnchantix.disabled = false;

  updateScores();
  setStatus('Твой ход!');
  addLog('Игра началась. Твой ход!', 'important');
}

// ── Утилиты выстрела ──────────────────────

function enchantixZone(r, c) {
  const cells = [];
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++)
      cells.push([r + dr, c + dc]);
  return cells;
}

function randomUnshot(shotSet) {
  const pool = [];
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++)
      if (!shotSet.has(`${r},${c}`)) pool.push([r, c]);
  return pool[randInt(0, pool.length - 1)];
}

function allSunk(ships) {
  return ships.every(s => s.sunk);
}

// ── Обработка одного выстрела ─────────────
// Возвращает 'hit' | 'miss' | 'sunk'
function applyShot(grid, ships, shotSet, boardEl, r, c, showShips) {
  const key = `${r},${c}`;
  if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return null;
  if (shotSet.has(key)) return null;

  shotSet.add(key);
  const shipId = grid[r][c];
  const cellEl = boardEl.querySelector(`[data-r="${r}"][data-c="${c}"]`);

  if (shipId !== null) {
    const ship = ships[shipId];
    ship.hits.add(key);

    if (ship.hits.size === ship.size) {
      ship.sunk = true;
      // Красим все клетки потопленного корабля
      for (const [sr, sc] of ship.cells) {
        const el = boardEl.querySelector(`[data-r="${sr}"][data-c="${sc}"]`);
        if (el) el.className = 'cell sunk';
      }
      return 'sunk';
    } else {
      if (cellEl) cellEl.className = 'cell hit';
      return 'hit';
    }
  } else {
    if (cellEl) cellEl.className = 'cell miss';
    return 'miss';
  }
}

// ── Ход игрока ────────────────────────────

function onEnemyCellClick(e) {
  if (state.turn !== 'player' || state.gameOver) return;

  const r = +e.currentTarget.dataset.r;
  const c = +e.currentTarget.dataset.c;

  clearEnchantixPreview();

  if (state.enchantixMode) {
    fireEnchantix(r, c);
  } else {
    if (state.playerShotSet.has(`${r},${c}`)) return;
    fireSingle(r, c, 'player');
  }
}

function fireSingle(r, c, who) {
  if (who === 'player') {
    const result = applyShot(
      state.enemyGrid, state.enemyShips, state.playerShotSet,
      elBoards.enemy, r, c, false
    );
    if (result === null) return;

    if      (result === 'sunk') addLog(`Ты потопил корабль!`, 'sunk');
    else if (result === 'hit')  addLog('Попадание!', 'hit');
    else                        addLog('Промах.', 'miss');

    updateScores();
    if (allSunk(state.enemyShips)) { endGame('player'); return; }
    handOffToEnemy();

  } else {
    const result = applyShot(
      state.playerGrid, state.playerShips, state.enemyShotSet,
      elBoards.player, r, c, true
    );
    if (result === null) return;

    updateEnemyAI(r, c, result);

    if      (result === 'sunk') addLog('Противник потопил твой корабль!', 'sunk');
    else if (result === 'hit')  addLog('Противник попал!', 'hit');
    else                        addLog('Противник промахнулся.', 'miss');

    updateScores();
    if (allSunk(state.playerShips)) { endGame('enemy'); return; }
    handOffToPlayer();
  }
}

function fireEnchantix(r, c) {
  state.enchantixMode   = false;
  state.playerEnchantix = false;
  btnEnchantix.disabled = true;
  btnEnchantix.classList.remove('active');
  elEnchHint.textContent = 'удар 3×3 · один раз';
  playEnchantixSound();
  triggerScreenFlash();
  addLog('✨ Энчантикс! Магия накрыла зону!', 'enchantix');
  spawnZoneBurst(elBoards.enemy, r, c);

  const zone = enchantixZone(r, c);
  let hitCount  = 0;
  let sunkCount = 0;

  for (const [zr, zc] of zone) {
    if (zr < 0 || zr >= SIZE || zc < 0 || zc >= SIZE) continue;
    if (state.playerShotSet.has(`${zr},${zc}`)) continue;

    const result = applyShot(
      state.enemyGrid, state.enemyShips, state.playerShotSet,
      elBoards.enemy, zr, zc, false
    );

    const cellEl = elBoards.enemy.querySelector(`[data-r="${zr}"][data-c="${zc}"]`);
    if (cellEl) {
      cellEl.classList.add('enchantix-fired');
      spawnParticle(cellEl);
      setTimeout(() => cellEl.classList.remove('enchantix-fired'), 900);
    }

    if (result === 'sunk') { sunkCount++; hitCount++; }
    else if (result === 'hit') hitCount++;
  }

  if (sunkCount)   addLog(`Потоплено кораблей: ${sunkCount}`, 'sunk');
  else if (hitCount) addLog(`Попаданий в зоне: ${hitCount}`, 'hit');
  else               addLog('Зона чиста — ни одного попадания.', 'miss');

  updateScores();
  if (allSunk(state.enemyShips)) { endGame('player'); return; }
  handOffToEnemy();
}

// ── ИИ компьютера ─────────────────────────

// Возвращает следующую клетку для выстрела
function getEnemyShot() {
  // Убираем из стека уже отстрелянные или запрещённые клетки
  const forbidden = getEnemyForbidden();
  state.enemyTargetStack = state.enemyTargetStack.filter(
    ([r, c]) => r >= 0 && r < SIZE && c >= 0 && c < SIZE
                && !state.enemyShotSet.has(`${r},${c}`)
                && !forbidden.has(`${r},${c}`)
  );
  if (state.enemyTargetStack.length > 0) return state.enemyTargetStack.shift();

  // Охота: случайная клетка, исключая зоны вокруг потопленных кораблей
  const pool = [];
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++) {
      const key = `${r},${c}`;
      if (!state.enemyShotSet.has(key) && !forbidden.has(key)) pool.push([r, c]);
    }
  return pool.length ? pool[randInt(0, pool.length - 1)] : randomUnshot(state.enemyShotSet);
}

// Обновляет состояние ИИ после выстрела
function updateEnemyAI(r, c, result) {
  if (result === 'sunk') {
    // Корабль потоплен — сбрасываем всё
    state.enemyPendingHits = [];
    state.enemyTargetStack = [];
  } else if (result === 'hit') {
    state.enemyPendingHits.push([r, c]);
    state.enemyTargetStack = calcEnemyTargets();
  }
  // При промахе стек уже обновится в следующем getEnemyShot
}

// Все клетки вокруг потопленных кораблей — там точно ничего нет
function getEnemyForbidden() {
  const forbidden = new Set();
  for (const ship of state.playerShips) {
    if (ship.sunk) {
      for (const key of getZone(ship.cells)) forbidden.add(key);
    }
  }
  return forbidden;
}

// Считает кандидатов для добивания на основе накопленных попаданий
function calcEnemyTargets() {
  const hits = state.enemyPendingHits;
  if (hits.length === 0) return [];

  const forbidden = getEnemyForbidden();
  const valid = ([r, c]) =>
    r >= 0 && r < SIZE && c >= 0 && c < SIZE
    && !state.enemyShotSet.has(`${r},${c}`)
    && !forbidden.has(`${r},${c}`);

  if (hits.length === 1) {
    const [r, c] = hits[0];
    return [[r-1,c],[r+1,c],[r,c-1],[r,c+1]].filter(valid);
  }

  // Определяем ось по двум+ попаданиям
  const sameRow = hits.every(([r]) => r === hits[0][0]);
  if (sameRow) {
    const row  = hits[0][0];
    const cols = hits.map(([,c]) => c).sort((a, b) => a - b);
    return [[row, cols[0] - 1], [row, cols.at(-1) + 1]].filter(valid);
  } else {
    const col  = hits[0][1];
    const rows = hits.map(([r]) => r).sort((a, b) => a - b);
    return [[rows[0] - 1, col], [rows.at(-1) + 1, col]].filter(valid);
  }
}

// После Enchantix — пересчитываем ИИ по текущему состоянию поля
function recalcEnemyAI() {
  state.enemyPendingHits = [];
  for (const ship of state.playerShips) {
    if (!ship.sunk && ship.hits.size > 0) {
      for (const key of ship.hits) {
        const [r, c] = key.split(',').map(Number);
        state.enemyPendingHits.push([r, c]);
      }
    }
  }
  state.enemyTargetStack = calcEnemyTargets();
}

// ── Ход компьютера ────────────────────────

function handOffToEnemy() {
  state.turn = 'enemy';
  setStatus('Ход противника...');
  disableEnemyBoard(true);
  setTimeout(enemyTurn, 900);
}

function handOffToPlayer() {
  state.turn = 'player';
  setStatus('Твой ход!');
  disableEnemyBoard(false);
}

function disableEnemyBoard(disabled) {
  elBoards.enemy.style.pointerEvents = disabled ? 'none' : '';
}

function enemyTurn() {
  if (state.gameOver) return;

  state.enemyMoveCount++;

  // Enchantix компьютера
  if (state.enemyEnchantix && state.enemyMoveCount >= state.enemyEnchantixAt) {
    state.enemyEnchantix = false;
    const [er, ec] = randomUnshot(state.enemyShotSet);
    playEnchantixSound();
    triggerScreenFlash();
    addLog('✨ Энчантикс противника! Магия накрыла зону!', 'enchantix');
    spawnZoneBurst(elBoards.player, er, ec);

    const zone = enchantixZone(er, ec);
    let hitCount = 0, sunkCount = 0;

    for (const [zr, zc] of zone) {
      if (zr < 0 || zr >= SIZE || zc < 0 || zc >= SIZE) continue;
      if (state.enemyShotSet.has(`${zr},${zc}`)) continue;

      const result = applyShot(
        state.playerGrid, state.playerShips, state.enemyShotSet,
        elBoards.player, zr, zc, true
      );

      const cellEl = elBoards.player.querySelector(`[data-r="${zr}"][data-c="${zc}"]`);
      if (cellEl) {
        cellEl.classList.add('enchantix-fired');
        spawnParticle(cellEl);
        setTimeout(() => cellEl.classList.remove('enchantix-fired'), 900);
      }

      if (result === 'sunk') { sunkCount++; hitCount++; }
      else if (result === 'hit') hitCount++;
    }

    if (sunkCount)     addLog(`Противник потопил кораблей: ${sunkCount}`, 'sunk');
    else if (hitCount) addLog(`Противник попал ${hitCount} раз!`, 'hit');
    else               addLog('Энчантикс противника — ни одного попадания.', 'miss');

    recalcEnemyAI();
    updateScores();
    if (allSunk(state.playerShips)) { endGame('enemy'); return; }
    handOffToPlayer();
    return;
  }

  // Умный выстрел: добивает раненый корабль или ищет новый
  const [r, c] = getEnemyShot();
  fireSingle(r, c, 'enemy');
}

// ── Enchantix: режим наведения ────────────

btnEnchantix.addEventListener('click', () => {
  if (!state.playerEnchantix || state.turn !== 'player' || state.gameOver) return;
  state.enchantixMode = !state.enchantixMode;
  if (state.enchantixMode) {
    btnEnchantix.classList.add('active');
    elEnchHint.textContent = 'выбери цель →';
  } else {
    btnEnchantix.classList.remove('active');
    elEnchHint.textContent = 'удар 3×3 · один раз';
  }
  btnEnchantix.style.outline = '';
});

function onEnemyCellEnter(e) {
  if (state.turn !== 'player' || !state.enchantixMode) return;
  const r = +e.currentTarget.dataset.r;
  const c = +e.currentTarget.dataset.c;
  for (const [zr, zc] of enchantixZone(r, c)) {
    if (zr < 0 || zr >= SIZE || zc < 0 || zc >= SIZE) continue;
    const el = elBoards.enemy.querySelector(`[data-r="${zr}"][data-c="${zc}"]`);
    if (el && !el.classList.contains('hit') && !el.classList.contains('miss') && !el.classList.contains('sunk'))
      el.classList.add('enchantix-zone');
  }
}

function onEnemyCellLeave() {
  clearEnchantixPreview();
}

function clearEnchantixPreview() {
  elBoards.enemy.querySelectorAll('.enchantix-zone').forEach(el => el.classList.remove('enchantix-zone'));
}

// ── Частицы и вспышка Enchantix ──────────

const PARTICLE_CHARS = ['✦', '✧', '·', '★', '✨', '✦', '·', '✧'];

function spawnParticle(cellEl) {
  const count = randInt(4, 6);
  for (let i = 0; i < count; i++) {
    const p = document.createElement('span');
    p.className = 'enchantix-particle';
    p.textContent = PARTICLE_CHARS[randInt(0, PARTICLE_CHARS.length - 1)];
    const angle = Math.random() * Math.PI * 2;
    const dist  = randInt(18, 40);
    p.style.setProperty('--dx', Math.round(Math.cos(angle) * dist) + 'px');
    p.style.setProperty('--dy', Math.round(Math.sin(angle) * dist - 10) + 'px');
    p.style.left  = randInt(20, 70) + '%';
    p.style.top   = randInt(20, 70) + '%';
    p.style.fontSize = randInt(10, 17) + 'px';
    p.style.color = Math.random() < 0.5 ? 'var(--enchantix-a)' : 'var(--enchantix-b)';
    p.style.animationDelay    = randInt(0, 120) + 'ms';
    p.style.animationDuration = randInt(700, 1050) + 'ms';
    cellEl.appendChild(p);
    setTimeout(() => p.remove(), 1200);
  }
}

function spawnZoneBurst(boardEl, r, c) {
  const centerEl = boardEl.querySelector(`[data-r="${r}"][data-c="${c}"]`);
  if (!centerEl) return;
  const count = 14;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('span');
    p.className = 'enchantix-particle';
    p.textContent = PARTICLE_CHARS[randInt(0, PARTICLE_CHARS.length - 1)];
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
    const dist  = randInt(28, 60);
    p.style.setProperty('--dx', Math.round(Math.cos(angle) * dist) + 'px');
    p.style.setProperty('--dy', Math.round(Math.sin(angle) * dist) + 'px');
    p.style.left  = '50%';
    p.style.top   = '50%';
    p.style.fontSize = randInt(12, 20) + 'px';
    p.style.color = Math.random() < 0.5 ? 'var(--enchantix-a)' : 'var(--enchantix-b)';
    p.style.animationDelay    = randInt(0, 80) + 'ms';
    p.style.animationDuration = randInt(650, 950) + 'ms';
    centerEl.appendChild(p);
    setTimeout(() => p.remove(), 1100);
  }
}

// ── Звук Энчантикс ────────────────────────

function playEnchantixSound() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    // Мастер-громкость
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.55, now);
    master.connect(ctx.destination);

    // Восходящее арпеджио — колокольчики
    const arpNotes = [
      { freq: 523.25, t: 0.00, dur: 1.1 },  // C5
      { freq: 659.25, t: 0.12, dur: 1.0 },  // E5
      { freq: 783.99, t: 0.24, dur: 0.9 },  // G5
      { freq: 1046.5, t: 0.36, dur: 1.1 },  // C6
      { freq: 1318.5, t: 0.52, dur: 1.4 },  // E6 — финальная нота
    ];

    arpNotes.forEach(({ freq, t, dur }) => {
      // Основной тон
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + t);
      env.gain.setValueAtTime(0, now + t);
      env.gain.linearRampToValueAtTime(0.22, now + t + 0.018);
      env.gain.exponentialRampToValueAtTime(0.001, now + t + dur);
      osc.connect(env); env.connect(master);
      osc.start(now + t); osc.stop(now + t + dur + 0.05);

      // Обертон (×2) — придаёт блеск
      const osc2 = ctx.createOscillator();
      const env2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(freq * 2, now + t);
      env2.gain.setValueAtTime(0, now + t);
      env2.gain.linearRampToValueAtTime(0.07, now + t + 0.018);
      env2.gain.exponentialRampToValueAtTime(0.001, now + t + dur * 0.6);
      osc2.connect(env2); env2.connect(master);
      osc2.start(now + t); osc2.stop(now + t + dur);
    });

    // Блёстки — случайные высокие пики
    for (let i = 0; i < 16; i++) {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      const sparkT    = now + Math.random() * 0.9;
      const sparkFreq = 2200 + Math.random() * 3600;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(sparkFreq, sparkT);
      env.gain.setValueAtTime(0, sparkT);
      env.gain.linearRampToValueAtTime(0.055, sparkT + 0.008);
      env.gain.exponentialRampToValueAtTime(0.001, sparkT + 0.18);
      osc.connect(env); env.connect(master);
      osc.start(sparkT); osc.stop(sparkT + 0.2);
    }

  } catch (e) { /* AudioContext недоступен */ }
}

function triggerScreenFlash() {
  elEnchantixFlash.classList.remove('active');
  void elEnchantixFlash.offsetWidth; // reflow чтобы animation сработала заново
  elEnchantixFlash.classList.add('active');
  setTimeout(() => elEnchantixFlash.classList.remove('active'), 900);
}

// ── Счёт и статус ─────────────────────────

function updateScores() {
  elScoreP.textContent = state.playerShips.filter(s => !s.sunk).length;
  elScoreE.textContent = state.enemyShips.filter(s => !s.sunk).length;
}

function setStatus(text) { elStatus.textContent = text; }

let toastTimer = null;
function addLog(msg, cls = '') {
  if (toastTimer) clearTimeout(toastTimer);
  elToast.textContent = msg;
  elToast.className = 'toast show' + (cls ? ' ' + cls : '');
  toastTimer = setTimeout(() => {
    elToast.classList.remove('show');
  }, 2400);
}

// ── Конец игры ────────────────────────────

function endGame(winner) {
  state.gameOver = true;
  disableEnemyBoard(true);

  const isWin = winner === 'player';
  document.getElementById('end-icon').textContent    = isWin ? '🏆' : '💀';
  const endTitle = document.getElementById('end-title');
  endTitle.textContent = isWin ? 'ПОБЕДА!' : 'ПОРАЖЕНИЕ';
  endTitle.className   = 'end-title';
  document.getElementById('end-subtitle').textContent = isWin
    ? 'Ты потопил весь флот противника!'
    : 'Противник потопил весь твой флот.';

  setTimeout(() => showScreen('end'), 600);
}

// ═══════════════════════════════════════════
// ЭКРАНЫ
// ═══════════════════════════════════════════

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

// ═══════════════════════════════════════════
// КНОПКА РЕСТАРТА
// ═══════════════════════════════════════════
btnRestart.addEventListener('click', () => { init(); showScreen('placement'); });

// ═══════════════════════════════════════════
// СТАРТ
// ═══════════════════════════════════════════
function init() {
  resetState();

  // Сбросить сайдбар
  document.querySelectorAll('.ship-item').forEach(el => el.classList.remove('placed'));
  elOriBadge.textContent = '→ Горизонтально';
  elHint.textContent = `Ставим первый корабль: ${state.shipQueue[0]} клетки`;
  btnStartGame.disabled = true;
  btnUndo.disabled = true;

  // Сбросить Энчантикс
  btnEnchantix.disabled = false;
  btnEnchantix.classList.remove('active');
  elEnchHint.textContent = 'удар 3×3 · один раз';

  // Сбросить тост
  if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
  elToast.className = 'toast';

  renderPlacementBoard();
  updateShipSidebar();
  showScreen('rules');
}

init();
