const socket = io();
let socket2 = null;

const canvas = document.getElementById("tetris");
const ctx = canvas.getContext("2d");
const nextCanvas = document.getElementById("next-piece");
const nextCtx = nextCanvas.getContext("2d");

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
    [0, 0, 0],
  ],
  // 2: L-shape
  [
    [0, 1, 0],
    [0, 1, 1],
    [0, 0, 0],
  ],
  // 3: J-shape
  [
    [0, 1, 0],
    [1, 1, 0],
    [0, 0, 0],
  ],
];

const COLORS = [
  null,
  "#06b6d4", // 1: Cyan
  "#f97316", // 2: Orange
  "#d946ef", // 3: Fuchsia
  "#84cc16", // 4: Lime
  "#eab308", // 5: Yellow
  "#ef4444", // 6: Red
  "#3b82f6", // 7: Blue
  "#a855f7", // 8: Purple
  "#94a3b8", // 9: Garbage
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
  dropCounter: 0,
  lockCounter: 0,
  lockDuration: 0,
};

const player2 = {
  id: null,
  colorIndex: null,
  spawnX: 0,
  pos: { x: 0, y: 0 },
  matrix: null,
  next: null,
  isSpectator: false,
  active: false,
  dropCounter: 0,
  lockCounter: 0,
  lockDuration: 0,
};

const lockSound = new Audio("/assets/land.mp3");
const moveSound = new Audio("/assets/move.mp3");
lockSound.preload = "auto";
moveSound.preload = "auto";
let sfxVolume = 0.7;
let musicVolume = 0.35;
lockSound.volume = sfxVolume;
moveSound.volume = sfxVolume;
let musicTracks = [];
let musicQueue = [];
let currentMusic = null;
let musicEnabled = false;
let musicLoadPromise = null;
let musicStarting = false;

let remotePlayers = {};
let globalLines = 0;
let startingLines = 0;
let walls = [];
let gameState = "LOBBY";
let isJoined = false;
let isPlaying = false;
let isBattleMode = false;
let isRandomMode = false;
let randomSpeed = 160;

const userControls = {
  p1: {
    left: "KeyA",
    right: "KeyD",
    drop: "KeyS",
    rotate: "Space",
  },
  p2: {
    left: "ArrowLeft",
    right: "ArrowRight",
    drop: "ArrowDown",
    rotate: "ArrowUp",
  },
};
let activeRebindKey = null;
let activeRebindPlayer = null;

const inputState = {
  p1: {
    left: { active: false, timer: 0 },
    right: { active: false, timer: 0 },
    drop: { active: false, timer: 0 },
  },
  p2: {
    left: { active: false, timer: 0 },
    right: { active: false, timer: 0 },
    drop: { active: false, timer: 0 },
  },
};
const DAS = 120;
const ARR = 40;
let dropInterval = 1000;
const LOCK_DELAY = 300;
const MAX_LOCK_DELAY = 2000;
const MAX_FRAME_DELTA = 50;
const SPEED_CURVE = [
  850, 620, 460, 330, 230, 160, 90, 75, 50, 30, 25, 24, 23, 22, 21,
];
let lastTime = 0;
let animationFrameId = null;

// UI Elements
const scoreElement = document.getElementById("score");
const startScreen = document.getElementById("start-screen");
const connScreen = document.getElementById("connection-screen");
const lobbyScreen = document.getElementById("lobby-screen");
const colorPicker = document.getElementById("color-picker");
const readyBtn = document.getElementById("ready-btn");
const playersListUI = document.getElementById("players-list");
const speedSelect = document.getElementById("speed-select");
const gameOverScreen = document.getElementById("game-over-screen");
const returnLobbyBtn = document.getElementById("return-lobby-btn");
const lobbyStatus = document.getElementById("lobby-status");
const coOpModeBtn = document.getElementById("co-op-mode-btn");
const battleModeBtn = document.getElementById("battle-mode-btn");
const sfxVolumeSlider = document.getElementById("sfx-volume");
const musicVolumeSlider = document.getElementById("music-volume");
const randomModeCheckbox = document.getElementById("random-mode-checkbox");
const splitscreenCheckbox = document.getElementById("splitscreen-checkbox");
const p2ControlsContainer = document.getElementById("p2-controls-container");
const p1ControlsHeader = document.getElementById("p1-controls-header");

splitscreenCheckbox.addEventListener("change", (e) => {
  const enabled = e.target.checked;
  player2.active = enabled;
  p2ControlsContainer.style.display = enabled ? "block" : "none";
  p1ControlsHeader.innerText = enabled ? "P1 Controls" : "Controls";

  if (enabled) {
    if (!socket2) {
      initSocket2();
    } else {
      socket2.emit("join_lobby");
    }
  } else {
    if (socket2) {
      socket2.disconnect();
      socket2 = null;
      player2.id = null;
    }
  }
});

function initSocket2() {
  socket2 = io();

  socket2.on("initial_sync", (data) => {
    if (!player2.id) {
      socket2.emit("join_lobby");
    }
  });

  socket2.on("joined_successfully", (selfData) => {
    player2.id = selfData.id;
    player2.isSpectator = selfData.isSpectator;
  });

  socket2.on("lobby_state_update", (data) => {
    if (data.players[player2.id]) {
      player2.isSpectator = data.players[player2.id].isSpectator;
    }
    // Most UI updates are handled by the main socket
  });

  socket2.on("game_start", (data) => {
    if (player2.active && !player2.isSpectator) {
      const myData = data.players[player2.id];
      if (myData) {
        player2.colorIndex = myData.colorIndex;
        player2.spawnX = myData.spawnX;
        playerReset(player2, socket2);
        player2.dropCounter = 0;
        player2.lockCounter = 0;
        player2.lockDuration = 0;
      }
    }
  });

  socket2.on("piece_locked_ack", () => {
    playLockSound();
    playerReset(player2, socket2);
  });

  socket2.on("try_revive", () => {
    if (player2.active && !player2.isSpectator) {
      playerReset(player2, socket2);
    }
  });

  socket2.on("game_over_state", () => {
    player2.matrix = null;
  });
}

returnLobbyBtn.addEventListener("click", () => {
  gameOverScreen.classList.add("hidden");
  if (isJoined && !player.isSpectator) {
    lobbyScreen.classList.remove("hidden");
  }
});

// Rebind Logic
document.querySelectorAll(".rebind-action-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    activeRebindKey = btn.dataset.action;
    activeRebindPlayer = btn.dataset.player;
    document.getElementById("rebind-inst").style.display = "block";
    document.getElementById("rebind-inst").innerText =
      `Press any key to map P${activeRebindPlayer} '${activeRebindKey.toUpperCase()}'...`;
  });
});

speedSelect.addEventListener("change", (e) => {
  socket.emit("change_speed", parseInt(e.target.value));
});

randomModeCheckbox.addEventListener("change", (e) => {
  socket.emit("toggle_random_mode", e.target.checked);
});

coOpModeBtn.addEventListener("click", () => {
  socket.emit("toggle_battle_mode", false);
});

battleModeBtn.addEventListener("click", () => {
  socket.emit("toggle_battle_mode", true);
});

sfxVolumeSlider.addEventListener("input", (event) => {
  sfxVolume = Number(event.target.value) / 100;
  lockSound.volume = sfxVolume;
  moveSound.volume = sfxVolume;
});

musicVolumeSlider.addEventListener("input", (event) => {
  musicVolume = Number(event.target.value) / 100;
  if (currentMusic) {
    currentMusic.volume = musicVolume;
  }
});

// Generate color picker
for (let i = 1; i <= PLAYER_COLOR_COUNT; i++) {
  const btn = document.createElement("button");
  btn.className = "color-btn";
  btn.style.backgroundColor = COLORS[i];
  btn.dataset.index = i;
  btn.onclick = () => {
    const myData = remotePlayers[player.id];
    const myData2 =
      player2.active && player2.id ? remotePlayers[player2.id] : null;

    if (
      player2.active &&
      myData &&
      myData.colorIndex !== null &&
      ((myData2 && myData2.colorIndex === null) || myData.colorIndex === i)
    ) {
      // If P1 has a color and P2 doesn't, or P1 is clicking their own color (to change it?), give to P2
      socket2.emit("select_color", i);
    } else {
      socket.emit("select_color", i);
    }
  };
  colorPicker.appendChild(btn);
}

function updateModeButtons() {
  coOpModeBtn.classList.toggle("selected", !isBattleMode);
  battleModeBtn.classList.toggle("selected", isBattleMode);
}

socket.on("initial_sync", (data) => {
  gameState = data.gameState;
  updateBoard(data.board);
  globalLines = data.lines;
  walls = data.walls || [];
  isBattleMode = !!data.isBattleMode;
  isRandomMode = !!data.isRandomMode;
  randomSpeed = data.randomSpeed !== undefined ? data.randomSpeed : null;
  randomModeCheckbox.checked = isRandomMode;
  updateModeButtons();
  if (data.startingLines !== undefined) {
    startingLines = data.startingLines;
    speedSelect.value = data.startingLines;
  }
  remotePlayers = data.players;
  scoreElement.innerText = globalLines;
  connScreen.classList.add("hidden");

  if (!isJoined) {
    socket.emit("join_lobby");
  }
});

readyBtn.addEventListener("click", () => {
  const p = remotePlayers[player.id];
  if (p) {
    socket.emit("toggle_ready", !p.isReady);
  }
  if (player2.active && player2.id) {
    const p2 = remotePlayers[player2.id];
    if (p2) {
      socket2.emit("toggle_ready", !p2.isReady);
    }
  }
});

socket.on("joined_successfully", (selfData) => {
  player.id = selfData.id;
  player.isSpectator = selfData.isSpectator;
  isJoined = true;
  if (startScreen) startScreen.remove();

  if (!player.isSpectator && gameState === "LOBBY") {
    lobbyScreen.classList.remove("hidden");
  }
});

socket.on("lobby_state_update", (data) => {
  gameState = data.gameState;
  remotePlayers = data.players;
  if (remotePlayers[player.id]) {
    player.isSpectator = remotePlayers[player.id].isSpectator;
  }
  if (player2.id && remotePlayers[player2.id]) {
    player2.isSpectator = remotePlayers[player2.id].isSpectator;
  }
  globalLines = data.lines;
  isBattleMode = !!data.isBattleMode;
  isRandomMode = !!data.isRandomMode;
  randomSpeed = data.randomSpeed !== undefined ? data.randomSpeed : null;
  randomModeCheckbox.checked = isRandomMode;
  updateModeButtons();
  if (data.startingLines !== undefined) {
    startingLines = data.startingLines;
    speedSelect.value = data.startingLines;
  }
  scoreElement.innerText = globalLines;

  // Build Player List UI
  playersListUI.innerHTML = "";
  for (let id in remotePlayers) {
    const p = remotePlayers[id];
    const li = document.createElement("li");

    let cDot = `<span class="player-color-dot" style="background: ${p.colorIndex ? COLORS[p.colorIndex] : "#444"}"></span>`;
    let text = "Player";
    if (p.id === player.id) text = "You (P1)";
    else if (player2.active && p.id === player2.id) text = "You (P2)";

    if (p.isSpectator) text += " (Spectating)";
    else if (p.isReady) text += " [READY]";

    li.innerHTML = `${cDot} ${text}`;
    playersListUI.appendChild(li);
  }

  if (
    gameState === "LOBBY" &&
    player.isSpectator &&
    (!player2.active || player2.isSpectator)
  ) {
    lobbyScreen.classList.add("hidden");
  }

  if (
    gameState === "LOBBY" &&
    (!player.isSpectator || (player2.active && !player2.isSpectator)) &&
    player.id
  ) {
    lobbyScreen.classList.remove("hidden");

    const myData = remotePlayers[player.id];
    const myData2 =
      player2.active && player2.id ? remotePlayers[player2.id] : null;

    // Update color picker
    const btns = colorPicker.querySelectorAll(".color-btn");
    btns.forEach((btn) => {
      const idx = parseInt(btn.dataset.index);
      // Check if another player (not us) has this color
      const taken = Object.values(remotePlayers).find(
        (rp) =>
          rp.colorIndex === idx &&
          rp.id !== player.id &&
          (!player2.active || rp.id !== player2.id),
      );
      btn.disabled = !!taken;

      if (myData && myData.colorIndex === idx) {
        btn.classList.add("selected");
        btn.style.border = "3px solid white";
      } else if (myData2 && myData2.colorIndex === idx) {
        btn.classList.add("selected");
        btn.style.border = "3px solid #ec4899"; // Accent color for P2
      } else {
        btn.classList.remove("selected");
        btn.style.border = "";
      }
    });

    const activePlayerCount = Object.values(remotePlayers).filter(
      (p) => !p.isSpectator,
    ).length;
    if (isBattleMode && activePlayerCount !== 2) {
      lobbyStatus.innerText = "Battle mode needs exactly 2 players";
    } else {
      lobbyStatus.innerText = player2.active
        ? "Pick colors for both"
        : "Pick your color";
    }

    const p1CanReady = myData && myData.colorIndex !== null;
    const p2CanReady =
      !player2.active || (myData2 && myData2.colorIndex !== null);

    if (p1CanReady && p2CanReady) {
      readyBtn.disabled = false;
      const bothReady = myData.isReady && (!myData2 || myData2.isReady);
      readyBtn.innerText = bothReady ? "Cancel Ready" : "Ready up!";
      readyBtn.style.background = bothReady ? "#10b981" : "";
    } else {
      readyBtn.disabled = true;
    }
  }
});

socket.on("game_start", (data) => {
  gameState = "PLAYING";
  lobbyScreen.classList.add("hidden");

  remotePlayers = data.players;
  updateBoard(data.board);
  globalLines = data.lines;
  walls = data.walls || [];
  isBattleMode = !!data.isBattleMode;
  isRandomMode = !!data.isRandomMode;
  randomSpeed = data.randomSpeed !== undefined ? data.randomSpeed : null;
  if (data.startingLines !== undefined) {
    startingLines = data.startingLines;
  }
  updateModeButtons();
  scoreElement.innerText = globalLines;

  if (isJoined && !player.isSpectator) {
    const myData = remotePlayers[player.id];
    if (myData) {
      player.colorIndex = myData.colorIndex;
      player.spawnX = myData.spawnX;
      isPlaying = true;
      playerReset();
      player.dropCounter = 0;
      player.lockCounter = 0;
      player.lockDuration = 0;
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
      }
      animationFrameId = requestAnimationFrame(update);
      startGameMusic();
    }
  }
});

socket.on("board_update", (data) => {
  updateBoard(data.board);
  globalLines = data.lines;
  walls = data.walls || walls;
  isBattleMode =
    data.isBattleMode !== undefined ? !!data.isBattleMode : isBattleMode;
  isRandomMode =
    data.isRandomMode !== undefined ? !!data.isRandomMode : isRandomMode;
  randomSpeed = data.randomSpeed !== undefined ? data.randomSpeed : randomSpeed;
  scoreElement.innerText = globalLines;
});

socket.on("players_update", (data) => {
  remotePlayers = data;
  if (remotePlayers[player.id]) {
    player.isSpectator = remotePlayers[player.id].isSpectator;
  }
});

socket.on("game_over_state", (data = {}) => {
  gameState = "LOBBY";
  isPlaying = false;
  player.matrix = null;
  stopGameMusic();
  lobbyScreen.classList.add("hidden");
  const heading = gameOverScreen.querySelector("h2");
  const message = gameOverScreen.querySelector("p");
  if (isBattleMode && data.winnerId) {
    const youWon = data.winnerId === player.id;
    heading.innerText = youWon ? "YOU WIN" : "GAME OVER";
    heading.style.color = youWon ? "#10b981" : "#ef4444";
    message.innerText = youWon
      ? "Your opponent topped out."
      : "Your tower reached the top.";
  } else {
    heading.innerText = "GAME OVER";
    heading.style.color = "#ef4444";
    message.innerText = "The pieces reached the top!";
  }
  gameOverScreen.classList.remove("hidden");
});

socket.on("piece_locked_ack", () => {
  playLockSound();
  playerReset();
});

socket.on("try_revive", () => {
  if (isJoined && !player.isSpectator) {
    lobbyScreen.classList.add("hidden");
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

function createPiece(colorIndex) {
  const type = Math.floor(Math.random() * 3) + 1;
  return BaseShapes[type].map((row) =>
    row.map((cell) => (cell ? colorIndex : 0)),
  );
}

function drawMatrix(matrix, offset, context = ctx) {
  if (!matrix) return;
  matrix.forEach((row, y) => {
    row.forEach((value, x) => {
      if (value !== 0) {
        context.fillStyle = COLORS[value];
        context.fillRect(x + offset.x, y + offset.y, 1, 1);

        context.fillStyle = "rgba(255, 255, 255, 0.2)";
        context.fillRect(x + offset.x, y + offset.y, 1, 0.1);
        context.fillRect(x + offset.x, y + offset.y, 0.1, 1);
        context.fillStyle = "rgba(0, 0, 0, 0.2)";
        context.fillRect(x + offset.x, y + offset.y + 0.9, 1, 0.1);
        context.fillRect(x + offset.x + 0.9, y + offset.y, 0.1, 1);
      }
    });
  });
}

function draw() {
  ctx.fillStyle = "rgba(15, 23, 42, 0.8)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawMatrix(board, { x: 0, y: 0 });

  // Draw walls
  ctx.fillStyle = "#ea580c";
  walls.forEach((wx) => {
    const wallHeight = isBattleMode ? ROWS : 4;
    for (let wy = 0; wy < wallHeight; wy++) {
      ctx.fillRect(wx, wy, 1, 1);
      ctx.fillStyle = "rgba(255, 255, 255, 0.2)";
      ctx.fillRect(wx, wy, 1, 0.1);
      ctx.fillRect(wx, wy, 0.1, 1);
      ctx.fillStyle = "rgba(0, 0, 0, 0.2)";
      ctx.fillRect(wx, wy + 0.9, 1, 0.1);
      ctx.fillRect(wx + 0.9, wy, 0.1, 1);
      ctx.fillStyle = "#ea580c";
    }
  });

  for (let id in remotePlayers) {
    if (id === player.id || id === player2.id) continue;
    const p = remotePlayers[id];
    if (p.matrix) {
      drawMatrix(p.matrix, p.pos);
    }
  }

  if (player.matrix) {
    drawMatrix(player.matrix, player.pos);
  }
  if (player2.active && player2.matrix) {
    drawMatrix(player2.matrix, player2.pos);
  }
}

function drawNext() {
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  if (player.next) {
    drawMatrix(player.next, { x: 0.5, y: 0.5 }, nextCtx);
  }
  // Optional: show player2 next piece too? User didn't ask but might be nice.
  // For now I'll stick to what's there.
}

function collide(board, playerObj, includePlayers = true) {
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

        if (includePlayers) {
          for (let id in remotePlayers) {
            if (id === playerObj.id) continue;
            const rp = remotePlayers[id];
            if (!rp.matrix || rp.isSpectator || rp.isDead) continue;

            const rpLocalX = globalX - rp.pos.x;
            const rpLocalY = globalY - rp.pos.y;

            if (
              rpLocalY >= 0 &&
              rpLocalY < rp.matrix.length &&
              rpLocalX >= 0 &&
              rpLocalX < rp.matrix[rpLocalY].length
            ) {
              if (rp.matrix[rpLocalY][rpLocalX] !== 0) {
                return true;
              }
            }
          }
        }
      }
    }
  }
  return false;
}

function emitUpdate(p = player, s = socket) {
  s.emit("update_piece", {
    matrix: p.matrix,
    pos: p.pos,
  });
}

function lockPiece(p = player, s = socket) {
  if (p === player) isPlaying = false; // block inputs till ack
  s.emit("lock_piece", {
    matrix: p.matrix,
    pos: p.pos,
  });
}

function playSound(sound) {
  const soundInstance = sound.cloneNode();
  soundInstance.volume = sfxVolume;
  soundInstance.play().catch(() => {});
}

function playLockSound() {
  playSound(lockSound);
}

function playMoveSound() {
  playSound(moveSound);
}

function shuffleTracks(tracks) {
  const shuffled = [...tracks];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

async function loadMusicTracks(forceRefresh = false) {
  if (forceRefresh) {
    musicLoadPromise = null;
  }

  if (!musicLoadPromise) {
    musicLoadPromise = fetch("/assets/music-list")
      .then((response) => (response.ok ? response.json() : []))
      .then((tracks) => {
        musicTracks = Array.isArray(tracks) ? tracks : [];
        musicQueue = [];
        return musicTracks;
      })
      .catch(() => {
        musicTracks = [];
        musicQueue = [];
        return musicTracks;
      });
  }
  return musicLoadPromise;
}

function getNextMusicTrack() {
  if (!musicTracks.length) return null;
  if (!musicQueue.length) {
    musicQueue = shuffleTracks(musicTracks);
  }
  return musicQueue.shift();
}

function playNextMusicTrack() {
  if (!musicEnabled) return;

  const nextTrack = getNextMusicTrack();
  if (!nextTrack) return;

  currentMusic = new Audio(nextTrack);
  currentMusic.volume = musicVolume;
  currentMusic.addEventListener("ended", playNextMusicTrack, { once: true });
  currentMusic.play().catch(() => {});
}

async function startGameMusic() {
  musicEnabled = true;
  if (musicStarting) return;

  if (currentMusic && !currentMusic.ended) {
    currentMusic.play().catch(() => {});
    return;
  }

  musicStarting = true;
  await loadMusicTracks(true);
  musicStarting = false;
  if (!musicEnabled) return;

  playNextMusicTrack();
}

function stopGameMusic() {
  musicEnabled = false;
  if (!currentMusic) return;
  currentMusic.pause();
  currentMusic.currentTime = 0;
  currentMusic = null;
}

function unlockAudio() {
  lockSound.load();
  moveSound.load();
  if (gameState === "PLAYING") {
    startGameMusic();
  }
}

function playerDrop(p = player, s = socket) {
  if (p === player && !isPlaying) return;
  p.pos.y++;
  if (collide(board, p, true)) {
    p.pos.y--;
    // Delay locking to the update loop
  } else {
    emitUpdate(p, s);
    p.dropCounter = 0;
  }
}

function playerMove(offset, p = player, s = socket) {
  if (p === player && !isPlaying) return;
  p.pos.x += offset;
  if (collide(board, p, true)) {
    p.pos.x -= offset;
  } else {
    playMoveSound();
    emitUpdate(p, s);
    p.lockCounter = 0;
  }
}

function rotate(matrix, dir) {
  for (let y = 0; y < matrix.length; ++y) {
    for (let x = 0; x < y; ++x) {
      [matrix[x][y], matrix[y][x]] = [matrix[y][x], matrix[x][y]];
    }
  }
  if (dir > 0) matrix.forEach((row) => row.reverse());
  else matrix.reverse();
}

function playerRotate(dir, p = player, s = socket) {
  if (p === player && !isPlaying) return;
  const pos = p.pos.x;
  let offset = 1;
  rotate(p.matrix, dir);
  while (collide(board, p, true)) {
    p.pos.x += offset;
    offset = -(offset + (offset > 0 ? 1 : -1));
    if (offset > p.matrix[0].length) {
      rotate(p.matrix, -dir);
      p.pos.x = pos;
      return;
    }
  }
  emitUpdate(p, s);
  p.lockCounter = 0;
}

function playerReset(p = player, s = socket) {
  if (!p.next) p.next = createPiece(p.colorIndex);
  p.matrix = p.next;
  p.next = createPiece(p.colorIndex);

  p.pos.y = 0;
  // Dynamic spawn point assignment based on Server's designated spawnX
  p.pos.x = p.spawnX;

  p.lockDuration = 0;

  if (collide(board, p, true)) {
    s.emit("player_dead");
    if (p === player) isPlaying = false;
    p.matrix = null;
    emitUpdate(p, s);
    return;
  }

  if (p === player) isPlaying = true;
  emitUpdate(p, s);
  if (p === player) drawNext();
}

function handleInputs(deltaTime) {
  // P1
  if (inputState.p1.left.active) {
    inputState.p1.left.timer += deltaTime;
    if (inputState.p1.left.timer > ARR) {
      playerMove(-1, player, socket);
      inputState.p1.left.timer = 0;
    }
  }
  if (inputState.p1.right.active) {
    inputState.p1.right.timer += deltaTime;
    if (inputState.p1.right.timer > ARR) {
      playerMove(1, player, socket);
      inputState.p1.right.timer = 0;
    }
  }
  if (inputState.p1.drop.active) {
    inputState.p1.drop.timer += deltaTime;
    if (inputState.p1.drop.timer > ARR) {
      playerDrop(player, socket);
      inputState.p1.drop.timer = 0;
    }
  }

  // P2
  if (player2.active && player2.id) {
    if (inputState.p2.left.active) {
      inputState.p2.left.timer += deltaTime;
      if (inputState.p2.left.timer > ARR) {
        playerMove(-1, player2, socket2);
        inputState.p2.left.timer = 0;
      }
    }
    if (inputState.p2.right.active) {
      inputState.p2.right.timer += deltaTime;
      if (inputState.p2.right.timer > ARR) {
        playerMove(1, player2, socket2);
        inputState.p2.right.timer = 0;
      }
    }
    if (inputState.p2.drop.active) {
      inputState.p2.drop.timer += deltaTime;
      if (inputState.p2.drop.timer > ARR) {
        playerDrop(player2, socket2);
        inputState.p2.drop.timer = 0;
      }
    }
  }
}

function getDropInterval() {
  if (isRandomMode && randomSpeed !== null) {
    return randomSpeed;
  }
  const speedLines = Math.max(globalLines, startingLines);
  const level = Math.min(SPEED_CURVE.length - 1, Math.floor(speedLines / 10));
  return SPEED_CURVE[level];
}

function update(time = 0) {
  animationFrameId = null;
  if (!isJoined || gameState !== "PLAYING") return;

  const deltaTime = Math.min(time - lastTime, MAX_FRAME_DELTA);
  lastTime = time;

  handleInputs(deltaTime);
  dropInterval = getDropInterval();

  const playersToUpdate = [
    { p: player, s: socket, active: isPlaying },
    {
      p: player2,
      s: socket2,
      active: player2.active && player2.id && gameState === "PLAYING",
    },
  ];

  playersToUpdate.forEach(({ p, s, active }) => {
    if (!active || !p.matrix) return;

    p.pos.y++;
    const grounded = collide(board, p, false);
    p.pos.y--;

    if (grounded) {
      p.lockCounter += deltaTime;
      p.lockDuration += deltaTime;
      if (p.lockCounter > LOCK_DELAY || p.lockDuration > MAX_LOCK_DELAY) {
        lockPiece(p, s);
      }
    } else {
      p.lockCounter = 0;
      p.dropCounter += deltaTime;

      if (p.dropCounter > dropInterval) {
        playerDrop(p, s);
      }
    }
  });

  draw();
  animationFrameId = requestAnimationFrame(update);
}

document.addEventListener("pointerdown", unlockAudio, { once: true });
document.addEventListener("keydown", unlockAudio, { once: true });

document.addEventListener("keydown", (event) => {
  // If waiting for a keybind
  if (activeRebindKey) {
    event.preventDefault();
    const playerKey = activeRebindPlayer === "1" ? "p1" : "p2";
    userControls[playerKey][activeRebindKey] = event.code;
    document.getElementById(
      `key-p${activeRebindPlayer}-${activeRebindKey}`,
    ).innerText = event.code;
    document.getElementById("rebind-inst").innerText =
      `Saved [${event.code}]. Click another to rebind:`;
    activeRebindKey = null;
    activeRebindPlayer = null;
    setTimeout(() => {
      document.getElementById("rebind-inst").style.display = "none";
    }, 1500);
    return;
  }

  // P1 controls
  if (isPlaying) {
    switch (event.code) {
      case userControls.p1.left:
        if (!inputState.p1.left.active) {
          playerMove(-1, player, socket);
          inputState.p1.left.active = true;
          inputState.p1.left.timer = -DAS;
        }
        break;
      case userControls.p1.right:
        if (!inputState.p1.right.active) {
          playerMove(1, player, socket);
          inputState.p1.right.active = true;
          inputState.p1.right.timer = -DAS;
        }
        break;
      case userControls.p1.drop:
        if (!inputState.p1.drop.active) {
          playerDrop(player, socket);
          inputState.p1.drop.active = true;
          inputState.p1.drop.timer = -DAS;
        }
        break;
      case userControls.p1.rotate:
        event.preventDefault(); // Prevents spacebar scrolling
        playerRotate(1, player, socket);
        break;
    }
  }

  // P2 controls
  if (player2.active && player2.id && gameState === "PLAYING") {
    switch (event.code) {
      case userControls.p2.left:
        if (!inputState.p2.left.active) {
          playerMove(-1, player2, socket2);
          inputState.p2.left.active = true;
          inputState.p2.left.timer = -DAS;
        }
        break;
      case userControls.p2.right:
        if (!inputState.p2.right.active) {
          playerMove(1, player2, socket2);
          inputState.p2.right.active = true;
          inputState.p2.right.timer = -DAS;
        }
        break;
      case userControls.p2.drop:
        if (!inputState.p2.drop.active) {
          playerDrop(player2, socket2);
          inputState.p2.drop.active = true;
          inputState.p2.drop.timer = -DAS;
        }
        break;
      case userControls.p2.rotate:
        event.preventDefault();
        playerRotate(1, player2, socket2);
        break;
    }
  }

  if (event.code === "Space") {
    event.preventDefault();
  }
});

document.addEventListener("keyup", (event) => {
  // P1
  if (event.code === userControls.p1.left) inputState.p1.left.active = false;
  if (event.code === userControls.p1.right) inputState.p1.right.active = false;
  if (event.code === userControls.p1.drop) inputState.p1.drop.active = false;

  // P2
  if (event.code === userControls.p2.left) inputState.p2.left.active = false;
  if (event.code === userControls.p2.right) inputState.p2.right.active = false;
  if (event.code === userControls.p2.drop) inputState.p2.drop.active = false;
});

// Initially render something if spectator
setInterval(() => {
  if (gameState === "PLAYING") draw();
}, 1000 / 60);
