const socket = io();

const canvas = document.getElementById('tetris');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-piece');
const nextCtx = nextCanvas.getContext('2d');

let COLS = 10;
const ROWS = 20;
const BLOCK_SIZE = 30;

ctx.scale(BLOCK_SIZE, BLOCK_SIZE);
nextCtx.scale(BLOCK_SIZE, BLOCK_SIZE);

const BaseShapes = [
    null,
    // 1: Line
    [
        [0, 0, 0],
        [1, 1, 1],
        [0, 0, 0]
    ],
    // 2: L-shape
    [
        [0, 1, 0],
        [0, 1, 1],
        [0, 0, 0]
    ],
    // 3: J-shape
    [
        [0, 1, 0],
        [1, 1, 0],
        [0, 0, 0]
    ]
];

const COLORS = [
    null,
    '#06b6d4', // 1: Cyan
    '#f97316', // 2: Orange
    '#d946ef', // 3: Fuchsia
    '#84cc16', // 4: Lime
    '#eab308', // 5: Yellow
    '#ef4444', // 6: Red
    '#3b82f6', // 7: Blue
    '#a855f7', // 8: Purple
    '#94a3b8'  // 9: Garbage
];
const PLAYER_COLOR_COUNT = 8;

let board = [];
const player = {
    id: null,
    colorIndex: null,
    spawnX: 0,
    pos: { x: 0, y: 0 },
    matrix: null,
    next: null,
    isSpectator: false,
};

let remotePlayers = {};
let globalLines = 0;
let walls = [];
let gameState = 'LOBBY';
let isJoined = false;
let isPlaying = false;
let isBattleMode = false;

const userControls = { left: 'KeyA', right: 'KeyD', drop: 'KeyS', rotate: 'Space' };
let activeRebindKey = null;

const inputState = { left: { active: false, timer: 0 }, right: { active: false, timer: 0 }, drop: { active: false, timer: 0 } };
const DAS = 120;
const ARR = 40;
let dropCounter = 0;
let dropInterval = 1000;
let lockCounter = 0;
let lockDuration = 0;
const LOCK_DELAY = 300;
const MAX_LOCK_DELAY = 2000;
let lastTime = 0;

// UI Elements
const scoreElement = document.getElementById('score');
const startScreen = document.getElementById('start-screen');
const connScreen = document.getElementById('connection-screen');
const lobbyScreen = document.getElementById('lobby-screen');
const colorPicker = document.getElementById('color-picker');
const readyBtn = document.getElementById('ready-btn');
const playersListUI = document.getElementById('players-list');
const speedSelect = document.getElementById('speed-select');
const gameOverScreen = document.getElementById('game-over-screen');
const returnLobbyBtn = document.getElementById('return-lobby-btn');
const lobbyStatus = document.getElementById('lobby-status');
const coOpModeBtn = document.getElementById('co-op-mode-btn');
const battleModeBtn = document.getElementById('battle-mode-btn');

returnLobbyBtn.addEventListener('click', () => {
    gameOverScreen.classList.add('hidden');
    if (isJoined && !player.isSpectator) {
        lobbyScreen.classList.remove('hidden');
    }
});

// Rebind Logic
document.getElementById('rebind-btn').addEventListener('click', () => {
    document.getElementById('rebind-modal').classList.toggle('hidden');
});
document.querySelectorAll('.rebind-action-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        activeRebindKey = btn.dataset.action;
        document.getElementById('rebind-inst').innerText = `Press any key to map '${activeRebindKey.toUpperCase()}'...`;
    });
});

speedSelect.addEventListener('change', (e) => {
    socket.emit('change_speed', parseInt(e.target.value));
});

coOpModeBtn.addEventListener('click', () => {
    socket.emit('toggle_battle_mode', false);
});

battleModeBtn.addEventListener('click', () => {
    socket.emit('toggle_battle_mode', true);
});

// Generate color picker
for (let i = 1; i <= PLAYER_COLOR_COUNT; i++) {
    const btn = document.createElement('button');
    btn.className = 'color-btn';
    btn.style.backgroundColor = COLORS[i];
    btn.dataset.index = i;
    btn.onclick = () => {
        socket.emit('select_color', i);
    };
    colorPicker.appendChild(btn);
}

function updateModeButtons() {
    coOpModeBtn.classList.toggle('selected', !isBattleMode);
    battleModeBtn.classList.toggle('selected', isBattleMode);
}

socket.on('initial_sync', (data) => {
    gameState = data.gameState;
    updateBoard(data.board);
    globalLines = data.lines;
    walls = data.walls || [];
    isBattleMode = !!data.isBattleMode;
    updateModeButtons();
    if (data.startingLines !== undefined) {
        speedSelect.value = data.startingLines;
    }
    remotePlayers = data.players;
    scoreElement.innerText = globalLines;
    connScreen.classList.add('hidden');

    if (!isJoined) {
        socket.emit('join_lobby');
    }
});



readyBtn.addEventListener('click', () => {
    const p = remotePlayers[player.id];
    if (p) {
        socket.emit('toggle_ready', !p.isReady);
    }
});

socket.on('joined_successfully', (selfData) => {
    player.id = selfData.id;
    player.isSpectator = selfData.isSpectator;
    isJoined = true;
    if (startScreen) startScreen.remove();

    if (!player.isSpectator && gameState === 'LOBBY') {
        lobbyScreen.classList.remove('hidden');
    }
});

socket.on('lobby_state_update', (data) => {
    gameState = data.gameState;
    remotePlayers = data.players;
    if (remotePlayers[player.id]) {
        player.isSpectator = remotePlayers[player.id].isSpectator;
    }
    globalLines = data.lines;
    isBattleMode = !!data.isBattleMode;
    updateModeButtons();
    if (data.startingLines !== undefined) {
        speedSelect.value = data.startingLines;
    }
    scoreElement.innerText = globalLines;

    // Build Player List UI
    playersListUI.innerHTML = '';
    for (let id in remotePlayers) {
        const p = remotePlayers[id];
        const li = document.createElement('li');

        let cDot = `<span class="player-color-dot" style="background: ${p.colorIndex ? COLORS[p.colorIndex] : '#444'}"></span>`;
        let text = p.id === player.id ? "You" : "Player";
        if (p.isSpectator) text += " (Spectating)";
        else if (p.isReady) text += " [READY]";

        li.innerHTML = `${cDot} ${text}`;
        playersListUI.appendChild(li);
    }

    if (gameState === 'LOBBY' && player.isSpectator) {
        lobbyScreen.classList.add('hidden');
    }

    if (gameState === 'LOBBY' && !player.isSpectator && player.id) {
        lobbyScreen.classList.remove('hidden');

        const myData = remotePlayers[player.id];

        // Update color picker
        const btns = colorPicker.querySelectorAll('.color-btn');
        btns.forEach(btn => {
            const idx = parseInt(btn.dataset.index);
            // Check if another player has this color
            const taken = Object.values(remotePlayers).find(rp => rp.colorIndex === idx && rp.id !== player.id);
            btn.disabled = !!taken;

            if (myData && myData.colorIndex === idx) {
                btn.classList.add('selected');
            } else {
                btn.classList.remove('selected');
            }
        });

        const activePlayerCount = Object.values(remotePlayers).filter(p => !p.isSpectator).length;
        if (isBattleMode && activePlayerCount !== 2) {
            lobbyStatus.innerText = 'Battle mode needs exactly 2 players';
        } else {
            lobbyStatus.innerText = 'Pick your color';
        }

        if (myData && myData.colorIndex !== null) {
            readyBtn.disabled = false;
            readyBtn.innerText = myData.isReady ? "Cancel Ready" : "Ready up!";
            readyBtn.style.background = myData.isReady ? "#10b981" : "";
        } else {
            readyBtn.disabled = true;
        }
    }
});

socket.on('game_start', (data) => {
    gameState = 'PLAYING';
    lobbyScreen.classList.add('hidden');

    remotePlayers = data.players;
    updateBoard(data.board);
    globalLines = data.lines;
    walls = data.walls || [];
    isBattleMode = !!data.isBattleMode;
    updateModeButtons();
    scoreElement.innerText = globalLines;

    if (isJoined && !player.isSpectator) {
        const myData = remotePlayers[player.id];
        if (myData) {
            player.colorIndex = myData.colorIndex;
            player.spawnX = myData.spawnX;
            isPlaying = true;
            playerReset();
            lastTime = performance.now();
            update(0);
        }
    }
});

socket.on('board_update', (data) => {
    updateBoard(data.board);
    globalLines = data.lines;
    walls = data.walls || walls;
    isBattleMode = data.isBattleMode !== undefined ? !!data.isBattleMode : isBattleMode;
    scoreElement.innerText = globalLines;
});

socket.on('players_update', (data) => {
    remotePlayers = data;
    if (remotePlayers[player.id]) {
        player.isSpectator = remotePlayers[player.id].isSpectator;
    }
});

socket.on('game_over_state', (data = {}) => {
    gameState = 'LOBBY';
    isPlaying = false;
    player.matrix = null;
    lobbyScreen.classList.add('hidden');
    const heading = gameOverScreen.querySelector('h2');
    const message = gameOverScreen.querySelector('p');
    if (isBattleMode && data.winnerId) {
        const youWon = data.winnerId === player.id;
        heading.innerText = youWon ? 'YOU WIN' : 'GAME OVER';
        heading.style.color = youWon ? '#10b981' : '#ef4444';
        message.innerText = youWon ? 'Your opponent topped out.' : 'Your tower reached the top.';
    } else {
        heading.innerText = 'GAME OVER';
        heading.style.color = '#ef4444';
        message.innerText = 'The pieces reached the top!';
    }
    gameOverScreen.classList.remove('hidden');
});

socket.on('piece_locked_ack', () => {
    playerReset();
});

socket.on('try_revive', () => {
    if (isJoined && !player.isSpectator) {
        lobbyScreen.classList.add('hidden');
        playerReset();
    }
});

function updateBoard(newBoard) {
    if (!newBoard || !newBoard.length) return;
    board = newBoard;
    let newCols = board[0].length;
    if (newCols !== COLS) {
        COLS = newCols;
        canvas.width = COLS * BLOCK_SIZE;
        canvas.height = ROWS * BLOCK_SIZE;
        ctx.scale(BLOCK_SIZE, BLOCK_SIZE);
    }
}

function createPiece() {
    const type = Math.floor(Math.random() * 3) + 1;
    return BaseShapes[type].map(row =>
        row.map(cell => cell ? player.colorIndex : 0)
    );
}

function drawMatrix(matrix, offset, context = ctx) {
    if (!matrix) return;
    matrix.forEach((row, y) => {
        row.forEach((value, x) => {
            if (value !== 0) {
                context.fillStyle = COLORS[value];
                context.fillRect(x + offset.x, y + offset.y, 1, 1);

                context.fillStyle = 'rgba(255, 255, 255, 0.2)';
                context.fillRect(x + offset.x, y + offset.y, 1, 0.1);
                context.fillRect(x + offset.x, y + offset.y, 0.1, 1);
                context.fillStyle = 'rgba(0, 0, 0, 0.2)';
                context.fillRect(x + offset.x, y + offset.y + 0.9, 1, 0.1);
                context.fillRect(x + offset.x + 0.9, y + offset.y, 0.1, 1);
            }
        });
    });
}

function draw() {
    ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    drawMatrix(board, { x: 0, y: 0 });

    // Draw walls
    ctx.fillStyle = '#ea580c';
    walls.forEach(wx => {
        const wallHeight = isBattleMode ? ROWS : 4;
        for (let wy = 0; wy < wallHeight; wy++) {
            ctx.fillRect(wx, wy, 1, 1);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.fillRect(wx, wy, 1, 0.1);
            ctx.fillRect(wx, wy, 0.1, 1);
            ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
            ctx.fillRect(wx, wy + 0.9, 1, 0.1);
            ctx.fillRect(wx + 0.9, wy, 0.1, 1);
            ctx.fillStyle = '#ea580c';
        }
    });

    for (let id in remotePlayers) {
        if (id === player.id) continue;
        const p = remotePlayers[id];
        if (p.matrix) {
            drawMatrix(p.matrix, p.pos);
        }
    }

    if (player.matrix) {
        drawMatrix(player.matrix, player.pos);
    }
}

function drawNext() {
    nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
    if (player.next) {
        drawMatrix(player.next, { x: 0.5, y: 0.5 }, nextCtx);
    }
}

function collide(board, playerObj) {
    const m = playerObj.matrix;
    const o = playerObj.pos;
    if (!m || !board || !board.length) return false;

    for (let y = 0; y < m.length; ++y) {
        for (let x = 0; x < m[y].length; ++x) {
            if (m[y][x] !== 0) {
                const globalX = o.x + x;
                const globalY = o.y + y;

                if (globalY >= ROWS || globalX < 0 || globalX >= COLS) {
                    return true;
                }
                if (walls.includes(globalX) && (isBattleMode || globalY < 4)) {
                    return true;
                }
                if (board[globalY] && board[globalY][globalX] !== 0) {
                    return true;
                }

                for (let id in remotePlayers) {
                    if (id === playerObj.id) continue;
                    const rp = remotePlayers[id];
                    if (!rp.matrix || rp.isSpectator || rp.isDead) continue;

                    const rpLocalX = globalX - rp.pos.x;
                    const rpLocalY = globalY - rp.pos.y;

                    if (rpLocalY >= 0 && rpLocalY < rp.matrix.length &&
                        rpLocalX >= 0 && rpLocalX < rp.matrix[rpLocalY].length) {
                        if (rp.matrix[rpLocalY][rpLocalX] !== 0) {
                            return true;
                        }
                    }
                }
            }
        }
    }
    return false;
}

function emitUpdate() {
    socket.emit('update_piece', {
        matrix: player.matrix,
        pos: player.pos
    });
}

function lockPiece() {
    isPlaying = false; // block inputs till ack
    socket.emit('lock_piece', {
        matrix: player.matrix,
        pos: player.pos
    });
}

function playerDrop() {
    if (!isPlaying) return;
    player.pos.y++;
    if (collide(board, player)) {
        player.pos.y--;
        // Delay locking to the update loop
    } else {
        emitUpdate();
        dropCounter = 0;
    }
}

function playerMove(offset) {
    if (!isPlaying) return;
    player.pos.x += offset;
    if (collide(board, player)) {
        player.pos.x -= offset;
    } else {
        emitUpdate();
        lockCounter = 0;
    }
}

function rotate(matrix, dir) {
    for (let y = 0; y < matrix.length; ++y) {
        for (let x = 0; x < y; ++x) {
            [matrix[x][y], matrix[y][x]] = [matrix[y][x], matrix[x][y]];
        }
    }
    if (dir > 0) matrix.forEach(row => row.reverse());
    else matrix.reverse();
}

function playerRotate(dir) {
    if (!isPlaying) return;
    const pos = player.pos.x;
    let offset = 1;
    rotate(player.matrix, dir);
    while (collide(board, player)) {
        player.pos.x += offset;
        offset = -(offset + (offset > 0 ? 1 : -1));
        if (offset > player.matrix[0].length) {
            rotate(player.matrix, -dir);
            player.pos.x = pos;
            return;
        }
    }
    emitUpdate();
    lockCounter = 0;
}

function playerReset() {
    if (!player.next) player.next = createPiece();
    player.matrix = player.next;
    player.next = createPiece();

    player.pos.y = 0;
    // Dynamic spawn point assignment based on Server's designated spawnX
    player.pos.x = player.spawnX;

    lockDuration = 0;

    if (collide(board, player)) {
        socket.emit('player_dead');
        isPlaying = false;
        player.matrix = null;
        emitUpdate();
        return;
    }

    isPlaying = true;
    emitUpdate();
    drawNext();
}

function handleInputs(deltaTime) {
    if (inputState.left.active) {
        inputState.left.timer += deltaTime;
        if (inputState.left.timer > ARR) {
            playerMove(-1);
            inputState.left.timer = 0;
        }
    }
    if (inputState.right.active) {
        inputState.right.timer += deltaTime;
        if (inputState.right.timer > ARR) {
            playerMove(1);
            inputState.right.timer = 0;
        }
    }
    if (inputState.drop.active) {
        inputState.drop.timer += deltaTime;
        if (inputState.drop.timer > ARR) {
            playerDrop();
            inputState.drop.timer = 0;
        }
    }
}

function update(time = 0) {
    if (!isJoined || gameState !== 'PLAYING') return;

    const deltaTime = time - lastTime;
    lastTime = time;

    if (isPlaying) {
        handleInputs(deltaTime);

        player.pos.y++;
        const grounded = collide(board, player);
        player.pos.y--;

        if (grounded) {
            lockCounter += deltaTime;
            lockDuration += deltaTime;
            if (lockCounter > LOCK_DELAY || lockDuration > MAX_LOCK_DELAY) {
                lockPiece();
            }
        } else {
            lockCounter = 0;
            dropCounter += deltaTime;

            let level = Math.min(10, Math.floor(globalLines / 10));
            // Speeds per 10 lines: 0, 10, 20, 30, 40, 50, 60 (jump), 70, 80, 90, 100+
            const SPEED_CURVE = [400, 360, 320, 280, 240, 200, 110, 90, 75, 60, 30];
            dropInterval = SPEED_CURVE[level];

            if (dropCounter > dropInterval) {
                playerDrop();
            }
        }
    }

    draw();
    requestAnimationFrame(update);
}

document.addEventListener('keydown', event => {
    // If waiting for a keybind
    if (activeRebindKey) {
        event.preventDefault();
        userControls[activeRebindKey] = event.code;
        document.getElementById('key-' + activeRebindKey).innerText = event.code;
        document.getElementById('rebind-inst').innerText = `Saved [${event.code}]. Click another to rebind:`;
        activeRebindKey = null;
        return;
    }

    if (!isPlaying) return;
    switch (event.code) {
        case userControls.left:
            if (!inputState.left.active) { playerMove(-1); inputState.left.active = true; inputState.left.timer = -DAS; }
            break;
        case userControls.right:
            if (!inputState.right.active) { playerMove(1); inputState.right.active = true; inputState.right.timer = -DAS; }
            break;
        case userControls.drop:
            if (!inputState.drop.active) { playerDrop(); inputState.drop.active = true; inputState.drop.timer = -DAS; }
            break;
        case userControls.rotate:
            event.preventDefault(); // Prevents spacebar scrolling
            playerRotate(1);
            break;
        case 'Space':
            event.preventDefault();
            break;
    }
});

document.addEventListener('keyup', event => {
    switch (event.code) {
        case userControls.left: inputState.left.active = false; break;
        case userControls.right: inputState.right.active = false; break;
        case userControls.drop: inputState.drop.active = false; break;
    }
});

// Initially render something if spectator
setInterval(() => {
    if (gameState === 'PLAYING') draw();
}, 1000 / 60);
