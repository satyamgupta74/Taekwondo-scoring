// backend/server.js
import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

const matches = {};

function newScoreCounts() {
  return { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "-1": 0 };
}

function initMatch(matchId) {
  matches[matchId] = {
    scores: { chong: 0, hong: 0 },
    roundWins: { chong: 0, hong: 0 },
    refereeVotes: { chong: {}, hong: {} },
    currentRound: 1,
    scoreCounts: { chong: newScoreCounts(), hong: newScoreCounts() },
  };
}

function emitState(matchId) {
  const m = matches[matchId];
  if (!m) return;
  io.to(matchId).emit("updateScore", {
    scores: m.scores,
    roundWins: m.roundWins,
    currentRound: m.currentRound,
    scoreCounts: m.scoreCounts,
  });
}

app.use(express.static(path.join(__dirname, "../frontend")));

io.on("connection", (socket) => {
  socket.on("joinMatch", (matchId, role) => {
    if (!matchId) return;
    if (!matches[matchId] && role === "scoreboard") initMatch(matchId);
    socket.join(matchId);
    if (matches[matchId] && role === "scoreboard") emitState(matchId);
  });

  socket.on("giveScore", ({ matchId, refereeId, player, points }) => {
    const m = matches[matchId];
    if (!m) return;
    if (!["chong", "hong"].includes(player)) return;
    const p = String(points);
    if (m.scoreCounts[player][p] !== undefined) m.scoreCounts[player][p] += 1;

    if (!m.refereeVotes[player][refereeId]) m.refereeVotes[player][refereeId] = [];
    m.refereeVotes[player][refereeId].push(points);

    const votesCount = {};
    Object.values(m.refereeVotes[player]).forEach((votes) => {
      if (votes.length > 0) {
        const last = votes[votes.length - 1];
        votesCount[last] = (votesCount[last] || 0) + 1;
      }
    });

    for (const [scoreValue, count] of Object.entries(votesCount)) {
      if (count >= 2) {
        const intScore = parseInt(scoreValue, 10);
        if (intScore === -1) {
          const opponent = player === "chong" ? "hong" : "chong";
          m.scores[opponent] += 1;
        } else {
          m.scores[player] += intScore;
        }
        break;
      }
    }
    emitState(matchId);
  });

  socket.on("updateTimer", ({ matchId, time }) => {
    io.to(matchId).emit("timerUpdate", time);
  });

  socket.on("endRound", (matchId) => {
    const m = matches[matchId];
    if (!m) return;

    const winner =
      m.scores.chong > m.scores.hong ? "chong" :
      m.scores.hong > m.scores.chong ? "hong" : null;
    if (winner) m.roundWins[winner] += 1;

    io.to(matchId).emit("roundEnd", { winner, roundWins: m.roundWins });

    if (m.roundWins.chong === 2 || m.roundWins.hong === 2 || m.currentRound === 3) {
      const matchWinner = m.roundWins.chong > m.roundWins.hong ? "chong" : "hong";
      io.to(matchId).emit("matchEnd", matchWinner);
      delete matches[matchId];
    } else {
      m.currentRound += 1;
      m.scores = { chong: 0, hong: 0 };
      m.refereeVotes = { chong: {}, hong: {} };
      m.scoreCounts = { chong: newScoreCounts(), hong: newScoreCounts() };
      emitState(matchId);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
