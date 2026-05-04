const express = require("express");
const fs = require("fs");
const path = require("path");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);

app.use(express.static("public"));
app.use("/assets", express.static("assets"));

const MUSIC_DIR = path.join(__dirname, "assets", "music");

app.get("/assets/music-list", (req, res) => {
  fs.readdir(MUSIC_DIR, { withFileTypes: true }, (err, entries) => {
    if (err) {
      res.json([]);
      return;
    }

    res.json(
      entries
        .filter(
          (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".mp3"),
        )
        .map((entry) => `/assets/music/${encodeURIComponent(entry.name)}`),
    );
  });
});

let gameState = "LOBBY"; // 'LOBBY' or 'PLAYING'
let isBattleMode = false;
const ROWS = 20;
const GARBAGE_COLOR_INDEX = 9;
let COLS = 10;
let board = [];
let globalLines = 0;

let players = {};
const MAX_PLAYERS = 8;
let startingLines = 0;
let walls = [];

function createMatrix(w, h) {
  const matrix = [];
  while (h--) {
    matrix.push(new Array(w).fill(0));
  }
  return matrix;
}

function broadcastLobbyState() {
  io.emit("lobby_state_update", {
    gameState: gameState,
    players: players,
    lines: globalLines,
    startingLines: startingLines,
    isBattleMode: isBattleMode,
  });
}

function checkStartCondition() {
  if (gameState !== "LOBBY") return;
  const playerVals = Object.values(players).filter((p) => !p.isSpectator);

  if (isBattleMode && playerVals.length !== 2) return;

  if (
    playerVals.length > 0 &&
    playerVals.every((p) => p.isReady && p.colorIndex !== null)
  ) {
    startGame();
  }
}

function startGame() {
  gameState = "PLAYING";
  globalLines = 0;

  const activePlayers = Object.values(players).filter((p) => !p.isSpectator);
  const numPlayers = activePlayers.length;
  if (isBattleMode && numPlayers !== 2) {
    gameState = "LOBBY";
    broadcastLobbyState();
    return;
  }

  // Dynamic Columns Allocation with Walls
  walls = [];
  if (isBattleMode) {
    COLS = 21;
    walls.push(10);
  } else if (numPlayers <= 1) {
    COLS = 10;
  } else {
    COLS = numPlayers * 7 - 1;
    for (let i = 1; i < numPlayers; i++) {
      walls.push(i * 7 - 1);
    }
  }
  board = createMatrix(COLS, ROWS);

  // Compute distinct spawn points
  activePlayers.forEach((p, index) => {
    if (isBattleMode) {
      p.spawnX = index === 0 ? 3 : 14;
    } else if (numPlayers <= 1) {
      p.spawnX = 3;
    } else {
      p.spawnX = index * 7 + 1; // Center-ish of the 6-wide lane
    }
    p.pos = { x: p.spawnX, y: 0 };
    p.matrix = null; // reset their piece
    p.isDead = false;
    p.playerIndex = index;
  });

  io.emit("game_start", {
    board: board,
    players: players,
    cols: COLS,
    lines: globalLines,
    startingLines: startingLines,
    walls: walls,
    isBattleMode: isBattleMode,
  });
}

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // Initially send the client what state we're in
  socket.emit("initial_sync", {
    gameState: gameState,
    board: board,
    lines: globalLines,
    players: players,
    startingLines: startingLines,
    walls: walls,
    isBattleMode: isBattleMode,
  });

  socket.on("change_speed", (lines) => {
    if (gameState !== "LOBBY") return;
    startingLines = typeof lines === "number" && !isNaN(lines) ? lines : 0;
    broadcastLobbyState();
  });

  socket.on("toggle_battle_mode", (enabled) => {
    if (gameState !== "LOBBY") return;
    isBattleMode = !!enabled;
    const lobbyPlayers = Object.values(players);
    if (isBattleMode) {
      lobbyPlayers.forEach((p, index) => {
        p.isReady = false;
        if (index >= 2) {
          p.isSpectator = true;
          p.colorIndex = null;
        }
      });
    } else {
      lobbyPlayers.forEach((p) => {
        p.isReady = false;
        p.isSpectator = false;
      });
    }
    broadcastLobbyState();
  });

  socket.on("join_lobby", () => {
    if (players[socket.id]) return;

    if (Object.keys(players).length >= MAX_PLAYERS) {
      socket.emit("error", "Game is full");
      return;
    }

    const activeLobbyPlayers = Object.values(players).filter(
      (p) => !p.isSpectator,
    ).length;
    const isSpectator =
      gameState === "PLAYING" || (isBattleMode && activeLobbyPlayers >= 2);

    players[socket.id] = {
      id: socket.id,
      colorIndex: null, // explicitly un-chosen
      isReady: false,
      isSpectator: isSpectator,
      isDead: false,
      matrix: null,
      pos: { x: 0, y: 0 },
      spawnX: 0,
    };

    socket.emit("joined_successfully", players[socket.id]);
    broadcastLobbyState();
  });

  socket.on("select_color", (colorIndex) => {
    if (
      !players[socket.id] ||
      players[socket.id].isSpectator ||
      gameState !== "LOBBY"
    )
      return;

    // Check if taken
    const taken = Object.values(players).some(
      (p) => p.colorIndex === colorIndex && p.id !== socket.id,
    );
    if (!taken) {
      players[socket.id].colorIndex = colorIndex;
      broadcastLobbyState();
    }
  });

  socket.on("toggle_ready", (isReady) => {
    if (
      !players[socket.id] ||
      players[socket.id].isSpectator ||
      gameState !== "LOBBY"
    )
      return;
    if (players[socket.id].colorIndex === null) return; // Must pick color first

    players[socket.id].isReady = isReady;
    broadcastLobbyState();

    // Timeout prevents instant start jumps, makes it feel smoother
    setTimeout(checkStartCondition, 300);
  });

  socket.on("update_piece", (data) => {
    if (!players[socket.id] || gameState !== "PLAYING") return;
    players[socket.id].matrix = data.matrix;
    players[socket.id].pos = data.pos;

    socket.broadcast.emit("players_update", players);
  });

  socket.on("lock_piece", (data) => {
    if (!players[socket.id] || gameState !== "PLAYING") return;

    const m = data.matrix;
    const o = data.pos;
    if (!m) return;

    // Apply gravity correction to prevent floating pieces if the board shifted
    o.y++;
    while (!serverCollide(board, m, o)) {
      o.y++;
    }
    o.y--;

    // Merge
    m.forEach((row, y) => {
      row.forEach((value, x) => {
        if (value !== 0) {
          if (
            y + o.y >= 0 &&
            y + o.y < ROWS &&
            x + o.x >= 0 &&
            x + o.x < COLS
          ) {
            board[y + o.y][x + o.x] = value;
          }
        }
      });
    });

    // Arena sweep
    let linesCleared = 0;
    if (isBattleMode) {
      const lane = getBattleLane(players[socket.id]);
      for (let y = board.length - 1; y >= 0; --y) {
        let full = true;
        for (let x = lane.start; x < lane.end; x++) {
          if (board[y][x] === 0) {
            full = false;
            break;
          }
        }
        if (!full) continue;

        for (let yy = y; yy > 0; yy--) {
          for (let x = lane.start; x < lane.end; x++) {
            board[yy][x] = board[yy - 1][x];
          }
        }
        for (let x = lane.start; x < lane.end; x++) {
          board[0][x] = 0;
        }
        ++y;
        linesCleared++;
      }
    } else {
      outer: for (let y = board.length - 1; y >= 0; --y) {
        for (let x = 0; x < board[y].length; ++x) {
          if (board[y][x] === 0) {
            continue outer;
          }
        }
        const row = board.splice(y, 1)[0].fill(0);
        board.unshift(row);
        ++y;
        linesCleared++;
      }
    }

    globalLines += linesCleared;

    // Battle Mode Logic
    if (isBattleMode && linesCleared >= 3) {
      const activePlayers = Object.values(players).filter(
        (p) => !p.isSpectator && !p.isDead,
      );
      if (activePlayers.length === 2) {
        const attacker = players[socket.id];
        const victim = activePlayers.find((p) => p.id !== socket.id);
        if (victim) {
          const victimToppedOut = addBattleGarbage(victim);

          if (victimToppedOut) {
            victim.isDead = true;
            finishGame(attacker.id);
          }
        }
      }
    }

    io.emit("board_update", {
      board,
      lines: globalLines,
      walls,
      isBattleMode,
    });
    if (gameState === "PLAYING") socket.emit("piece_locked_ack");

    if (!isBattleMode && linesCleared > 0) {
      Object.values(players).forEach((p) => {
        if (p.isDead) {
          p.isDead = false;
          io.to(p.id).emit("try_revive");
        }
      });
      io.emit("players_update", players);
    }
  });

  socket.on("player_dead", () => {
    if (gameState !== "PLAYING" || !players[socket.id]) return;
    players[socket.id].isDead = true;

    const activePlayers = Object.values(players).filter((p) => !p.isSpectator);
    if (isBattleMode) {
      const winner = activePlayers.find((p) => !p.isDead);
      finishGame(winner ? winner.id : null);
      return;
    }

    const allDead =
      activePlayers.length > 0 && activePlayers.every((p) => p.isDead);

    if (allDead) {
      finishGame(null);
    } else {
      // Re-sync player states to show they are dead (if client wants)
      io.emit("players_update", players);
    }
  });

  socket.on("disconnect", () => {
    if (players[socket.id]) {
      delete players[socket.id];

      // If all active players left mid-game or all remaining are dead
      const activePlayers = Object.values(players).filter(
        (p) => !p.isSpectator,
      );
      if (gameState === "PLAYING") {
        if (
          activePlayers.length === 0 ||
          activePlayers.every((p) => p.isDead) ||
          (isBattleMode && activePlayers.length < 2)
        ) {
          const winner =
            isBattleMode && activePlayers.length === 1 ? activePlayers[0].id : null;
          finishGame(winner);
        } else {
          io.emit("players_update", players);
        }
      } else {
        broadcastLobbyState();
      }
    }
    console.log("Client disconnected:", socket.id);
  });
});

function getBattleLane(player) {
  return player.playerIndex === 0
    ? { start: 0, end: 10 }
    : { start: 11, end: 21 };
}

function addBattleGarbage(player) {
  const lane = getBattleLane(player);
  let toppedOut = false;

  for (let y = 0; y <= 1; y++) {
    for (let x = lane.start; x < lane.end; x++) {
      if (board[y][x] !== 0) {
        toppedOut = true;
        break;
      }
    }
    if (toppedOut) break;
  }

  for (let y = 0; y < ROWS - 1; y++) {
    for (let x = lane.start; x < lane.end; x++) {
      board[y][x] = board[y + 1][x];
    }
  }

  const gapX = lane.start + Math.floor(Math.random() * (lane.end - lane.start));
  for (let x = lane.start; x < lane.end; x++) {
    board[ROWS - 1][x] = x === gapX ? 0 : GARBAGE_COLOR_INDEX;
  }

  return toppedOut;
}

function finishGame(winnerId) {
  gameState = "LOBBY";
  Object.values(players).forEach((p) => {
    p.isReady = false;
    p.isDead = false;
    p.matrix = null;
  });
  broadcastLobbyState();
  io.emit("game_over_state", { winnerId });
}

function serverCollide(board, m, o) {
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
      }
    }
  }
  return false;
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
