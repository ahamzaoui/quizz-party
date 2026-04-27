const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));
app.use(express.json());

let apiKey = process.env.OPENROUTER_API_KEY || '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';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const rooms = new Map();

function generatePIN() {
  let pin;
  do { pin = String(Math.floor(1000 + Math.random() * 9000)); } while (rooms.has(pin));
  return pin;
}

function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

function getBaseUrl(req) {
  var proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  var host = req.headers['x-forwarded-host'] || req.headers.host;
  return proto + '://' + host;
}

app.get('/api/qrcode/:pin', async (req, res) => {
  var base = getBaseUrl(req);
  var url = base + '/play.html?pin=' + req.params.pin;
  try {
    const svg = await QRCode.toString(url, { type: 'svg', margin: 1 });
    res.type('image/svg+xml').send(svg);
  } catch (e) { res.status(500).send('QR error'); }
});

app.get('/api/ip', (req, res) => {
  var base = getBaseUrl(req);
  res.json({ base: base });
});

app.post('/api/set-key', (req, res) => {
  if (!req.body.key) return res.status(400).json({ error: 'Cle manquante' });
  apiKey = req.body.key;
  res.json({ ok: true });
});

app.get('/api/has-key', (req, res) => {
  res.json({ hasKey: !!apiKey });
});

app.post('/api/generate-questions', async (req, res) => {
  const { theme, count = 10, difficulty = 'moyen', model = 'google/gemma-4-31b-it', language = 'francais' } = req.body;
  if (!theme) return res.status(400).json({ error: 'Theme manquant' });
  if (!apiKey) return res.status(400).json({ error: 'Cle API non configuree.' });

  try {
    const prompt = [
      'Genere exactement ' + count + ' questions de quiz QCM sur le theme : "' + theme + '".',
      'Difficulte : ' + difficulty + '.',
      'Reponds UNIQUEMENT avec un tableau JSON valide, sans texte avant ou apres.',
      'Format: [{"question":"...","options":["A","B","C","D"],"answer":0}]',
      'answer = index 0-3 de la bonne reponse. 4 options par question.',
      'Mauvaises reponses plausibles. Varie la position. Questions variees. Pas de doublons.',
      'Langue des questions et reponses : ' + language + '. Ecris TOUT dans cette langue.'
    ].join('\n');

    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'Quizz Party'
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    if (!response.ok) {
      var errMsg = (data.error && data.error.message) || 'Erreur OpenRouter';
      throw { status: response.status, message: errMsg };
    }

    const text = data.choices[0].message.content.trim();
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('Reponse IA invalide');
    const questions = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(questions) || questions.length === 0) throw new Error('Aucune question');
    for (const q of questions) {
      if (!q.question || !Array.isArray(q.options) || q.options.length !== 4 ||
          typeof q.answer !== 'number' || q.answer < 0 || q.answer > 3) {
        throw new Error('Format invalide');
      }
    }
    res.json({ questions });
  } catch (err) {
    console.error('AI error:', err.message);
    if (err.status === 401) return res.status(401).json({ error: 'Cle API invalide.' });
    if (err.status === 429) return res.status(429).json({ error: 'Trop de requetes.' });
    res.status(500).json({ error: err.message || 'Erreur generation' });
  }
});

io.on('connection', function(socket) {

  socket.on('host:create', function(data, cb) {
    var pin = generatePIN();
    var room = {
      pin: pin, hostId: socket.id, quiz: data.quiz,
      theme: data.theme || 'default', players: new Map(),
      state: 'lobby', currentQ: -1, timer: null,
      answersThisRound: new Set(), questionStartTime: 0
    };
    rooms.set(pin, room);
    socket.join(pin);
    socket.data.role = 'host';
    socket.data.pin = pin;
    cb({ pin: pin });
  });

  socket.on('player:join', function(data, cb) {
    var pin = data.pin, name = data.name;
    var room = rooms.get(pin);
    if (!room) return cb({ error: 'Partie introuvable.' });
    if (room.state !== 'lobby') return cb({ error: 'La partie a deja commence !' });
    for (var entry of room.players.values()) {
      if (entry.name.toLowerCase() === name.toLowerCase()) return cb({ error: 'Pseudo deja pris !' });
    }
    socket.join(pin);
    socket.data.role = 'player';
    socket.data.pin = pin;
    socket.data.name = name;
    room.players.set(socket.id, { name: name, score: 0, streak: 0 });
    cb({ ok: true, theme: room.theme, quizTitle: room.quiz.title });
    io.to(room.hostId).emit('host:playerJoined', {
      players: Array.from(room.players.values()).map(function(p) { return { name: p.name, score: p.score }; })
    });
  });

  socket.on('host:start', function() {
    var room = rooms.get(socket.data.pin);
    if (!room || room.hostId !== socket.id) return;
    room.state = 'playing';
    room.currentQ = -1;
    io.to(room.pin).emit('game:started', { totalQuestions: room.quiz.questions.length });
    nextQuestion(room);
  });

  socket.on('player:answer', function(data) {
    var room = rooms.get(socket.data.pin);
    if (!room || room.state !== 'playing') return;
    if (room.answersThisRound.has(socket.id)) return;
    room.answersThisRound.add(socket.id);
    var q = room.quiz.questions[room.currentQ];
    var player = room.players.get(socket.id);
    var correct = data.answerIndex === q.answer;
    var timeLimit = q.timeLimit || 20;
    if (correct) {
      var elapsed = (Date.now() - room.questionStartTime) / 1000;
      var speedBonus = Math.round(Math.max(0, (1 - elapsed / timeLimit)) * 500);
      player.streak++;
      var streakBonus = Math.min(player.streak, 5) * 50;
      player.score += 1000 + speedBonus + streakBonus;
    } else {
      player.streak = 0;
    }
    socket.emit('player:result', { correct: correct, score: player.score, streak: player.streak });
    io.to(room.hostId).emit('host:answerCount', { count: room.answersThisRound.size, total: room.players.size });
    if (room.answersThisRound.size >= room.players.size) {
      clearTimeout(room.timer);
      setTimeout(function() { showResults(room); }, 500);
    }
  });

  socket.on('host:next', function() {
    var room = rooms.get(socket.data.pin);
    if (!room || room.hostId !== socket.id) return;
    if (room.currentQ < room.quiz.questions.length - 1) nextQuestion(room);
  });

  socket.on('disconnect', function() {
    var room = rooms.get(socket.data.pin);
    if (!room) return;
    if (socket.data.role === 'host') {
      io.to(room.pin).emit('game:ended', { reason: "L'hote a quitte la partie." });
      clearTimeout(room.timer);
      rooms.delete(room.pin);
    } else if (socket.data.role === 'player') {
      room.players.delete(socket.id);
      io.to(room.hostId).emit('host:playerLeft', {
        name: socket.data.name,
        players: Array.from(room.players.values()).map(function(p) { return { name: p.name, score: p.score }; })
      });
    }
  });
});

function nextQuestion(room) {
  room.currentQ++;
  room.answersThisRound = new Set();
  var q = room.quiz.questions[room.currentQ];
  var timeLimit = q.timeLimit || 20;
  room.questionStartTime = Date.now();
  io.to(room.pin).emit('game:question', {
    index: room.currentQ, total: room.quiz.questions.length,
    question: q.question, options: q.options, timeLimit: timeLimit
  });
  room.timer = setTimeout(function() { showResults(room); }, timeLimit * 1000 + 500);
}

function showResults(room) {
  clearTimeout(room.timer);
  var q = room.quiz.questions[room.currentQ];
  var leaderboard = Array.from(room.players.values())
    .sort(function(a, b) { return b.score - a.score; })
    .map(function(p, i) { return { rank: i + 1, name: p.name, score: p.score }; });
  io.to(room.pin).emit('game:roundResults', {
    correctAnswer: q.answer, correctText: q.options[q.answer],
    leaderboard: leaderboard, isLast: room.currentQ >= room.quiz.questions.length - 1
  });
  if (room.currentQ >= room.quiz.questions.length - 1) {
    room.state = 'results';
    io.to(room.pin).emit('game:finished', { leaderboard: leaderboard });
  }
}

var PORT = process.env.PORT || 3000;

var PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', function() {
  var ip = getLocalIP();
  console.log('Quizz Party est lance !');
  console.log('  Local :  http://localhost:' + PORT);
  console.log('  Reseau : http://' + ip + ':' + PORT);
});
