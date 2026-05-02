const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const os = require('os');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));
app.use(express.json({ limit: '10kb' }));

const stats = require('./stats');
let apiKey = process.env.OPENROUTER_API_KEY || '';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
let cfApiToken = process.env.CF_API_TOKEN || '';
let cfAccountId = process.env.CF_ACCOUNT_ID || '';
let geminiApiKey = process.env.GEMINI_API_KEY || '';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const rooms = new Map();

// Crypto-random admin session tokens (CRITICAL fix #2)
const adminTokens = new Set();

// Simple rate limiter (HIGH fix #2)
const rateLimits = new Map();
function rateLimit(key, maxPerMinute) {
  var now = Date.now();
  var entry = rateLimits.get(key);
  if (!entry || now - entry.start > 60000) {
    rateLimits.set(key, { start: now, count: 1 });
    return false;
  }
  entry.count++;
  return entry.count > maxPerMinute;
}

function requireAdmin(req, res) {
  var token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token || !adminTokens.has(token)) {
    res.status(401).json({ error: 'Non autorise' });
    return false;
  }
  return true;
}

if (ADMIN_PASSWORD === 'admin123') {
  console.warn('⚠  ATTENTION: Mot de passe admin par defaut! Definissez ADMIN_PASSWORD en variable d\'environnement.');
}

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
  if (!requireAdmin(req, res)) return;
  if (!req.body.key) return res.status(400).json({ error: 'Cle manquante' });
  apiKey = req.body.key;
  res.json({ ok: true });
});

app.get('/api/has-key', (req, res) => {
  res.json({ hasKey: !!apiKey, hasCfKey: !!(cfApiToken && cfAccountId), hasGeminiKey: !!geminiApiKey });
});

// Models config
app.get('/api/models', (req, res) => {
  try {
    var modelsData = JSON.parse(fs.readFileSync(path.join(__dirname, 'models.json'), 'utf-8'));
    res.json(modelsData);
  } catch(e) { res.status(500).json({ error: 'models.json introuvable' }); }
});

// Track visits
app.get('/api/track-visit', (req, res) => {
  var ip = req.ip || 'unknown';
  if (rateLimit('visit:' + ip, 30)) return res.status(429).json({ error: 'Rate limit' });
  stats.trackVisit();
  res.json({ ok: true });
});

// Admin stats API
app.post('/api/admin/login', (req, res) => {
  var ip = req.ip || 'unknown';
  if (rateLimit('login:' + ip, 5)) return res.status(429).json({ error: 'Trop de tentatives. Reessayez dans 1 minute.' });
  if (req.body.password === ADMIN_PASSWORD) {
    var t = crypto.randomUUID();
    adminTokens.add(t);
    res.json({ ok: true, token: t });
  } else {
    res.status(401).json({ error: 'Mot de passe incorrect' });
  }
});

app.get('/api/admin/stats', (req, res) => {
  if (!requireAdmin(req, res)) return;
  var s = stats.getStats();
  s.activeRooms = rooms.size;
  var activePlayers = 0;
  rooms.forEach(function(r) { activePlayers += r.players.size; });
  s.activePlayers = activePlayers;
  res.json(s);
});

// Reusable AI call function
async function callAI(aiModel, aiProvider, aiKey, aiCfAccount, messages) {
  var text = '';
  var maxTokens = aiProvider === 'cloudflare' ? 16384 : 4096;
  if (aiProvider === 'gemini') {
    var gemVersion = aiModel.indexOf('preview') !== -1 ? 'v1alpha' : 'v1beta';
    var gemUrl = 'https://generativelanguage.googleapis.com/' + gemVersion + '/models/' + aiModel + ':generateContent?key=' + aiKey;
    var userText = messages.map(function(m) { return m.content; }).join('\n');
    var resp0 = await fetch(gemUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: userText }] }], generationConfig: { maxOutputTokens: 8192 } })
    });
    var d0 = await resp0.json();
    if (!resp0.ok) {
      var gemErr = (d0.error && d0.error.message) || 'Erreur Gemini';
      throw { status: resp0.status, message: gemErr };
    }
    if (d0.candidates && d0.candidates[0] && d0.candidates[0].content && d0.candidates[0].content.parts) {
      text = d0.candidates[0].content.parts.map(function(p) { return p.text || ''; }).join('').trim();
    }
    if (!text) throw new Error('Gemini n\'a pas genere de contenu.');
  } else if (aiProvider === 'cloudflare') {
    var cfUrl = 'https://api.cloudflare.com/client/v4/accounts/' + aiCfAccount + '/ai/run/' + aiModel;
    var resp = await fetch(cfUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + aiKey },
      body: JSON.stringify({ messages: messages, max_tokens: maxTokens })
    });
    var d = await resp.json();
    if (!resp.ok || !d.success) {
      var cfErr = (d.errors && d.errors[0] && d.errors[0].message) || 'Erreur Cloudflare';
      throw { status: resp.status, message: cfErr };
    }
    var cfResult = d.result;
    if (typeof cfResult === 'string') { text = cfResult.trim(); }
    else if (cfResult && typeof cfResult.response === 'string') { text = cfResult.response.trim(); }
    else if (cfResult && cfResult.choices && cfResult.choices[0]) {
      var msg = cfResult.choices[0].message;
      if (msg && msg.content) text = String(msg.content).trim();
      if (!text && msg && msg.reasoning_content) {
        var rc = String(msg.reasoning_content);
        var rcM = rc.match(/\[[\s\S]*\]/);
        if (rcM) text = rcM[0];
      }
    }
    if (!text) {
      if (cfResult && cfResult.choices && cfResult.choices[0] && cfResult.choices[0].finish_reason === 'length') {
        throw new Error('Le modele a depasse la limite de tokens.');
      }
      throw new Error('Le modele n\'a pas genere de contenu.');
    }
  } else {
    var resp2 = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + aiKey, 'HTTP-Referer': 'http://localhost:3000', 'X-Title': 'Quizz Party' },
      body: JSON.stringify({ model: aiModel, max_tokens: maxTokens, messages: messages })
    });
    var d2 = await resp2.json();
    if (!resp2.ok) {
      var errMsg = (d2.error && d2.error.message) || 'Erreur OpenRouter';
      throw { status: resp2.status, message: errMsg };
    }
    var msg2 = d2.choices[0].message;
    if (msg2 && msg2.content) {
      text = String(msg2.content).trim();
    }
    if (!text && msg2 && msg2.reasoning_content) {
      var rc2 = String(msg2.reasoning_content);
      var rcM2 = rc2.match(/\[[\s\S]*\]/);
      if (rcM2) text = rcM2[0];
    }
    if (!text) throw new Error('Le modele n\'a pas genere de contenu.');
  }
  return text;
}

function parseJSON(text) {
  text = text.replace(/```(?:json)?\s*/gi, '').replace(/```\s*/g, '');
  var jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    var objMatch = text.match(/\{[\s\S]*\}/);
    if (objMatch) jsonMatch = ['[' + objMatch[0] + ']'];
  }
  if (!jsonMatch) return null;
  var jsonStr = jsonMatch[0];
  jsonStr = jsonStr.replace(/,\s*]/g, ']').replace(/,\s*}/g, '}');
  jsonStr = jsonStr.replace(/[\x00-\x1F\x7F]/g, function(c) { return c === '\n' || c === '\r' || c === '\t' ? c : ''; });
  jsonStr = jsonStr.replace(/\/\/[^\n]*/g, '');
  try { return JSON.parse(jsonStr); } catch(e) {
    var lastBracket = jsonStr.lastIndexOf('}');
    if (lastBracket > 0) {
      jsonStr = jsonStr.substring(0, lastBracket + 1) + ']';
      return JSON.parse(jsonStr);
    }
    throw e;
  }
}

app.post('/api/generate-questions', async (req, res) => {
  var ip = req.ip || 'unknown';
  if (rateLimit('gen:' + ip, 10)) return res.status(429).json({ error: 'Trop de requetes. Reessayez dans 1 minute.' });
  const { theme, count = 10, difficulty = 'moyen', model = 'google/gemma-4-31b-it', language = 'francais', provider = 'openrouter', userKey, cfAccount, validate = false, validatorModel } = req.body;
  if (!theme) return res.status(400).json({ error: 'Theme manquant' });

  var effectiveKey, effectiveCfAccount;
  if (provider === 'cloudflare') {
    effectiveKey = userKey || cfApiToken;
    effectiveCfAccount = cfAccount || cfAccountId;
    if (!effectiveKey) return res.status(400).json({ error: 'Token Cloudflare non configure.' });
    if (!effectiveCfAccount) return res.status(400).json({ error: 'Account ID Cloudflare requis.' });
  } else if (provider === 'gemini') {
    effectiveKey = userKey || geminiApiKey;
    if (!effectiveKey) return res.status(400).json({ error: 'Cle API Gemini non configuree.' });
  } else {
    effectiveKey = userKey || apiKey;
    if (!effectiveKey) return res.status(400).json({ error: 'Cle API non configuree.' });
  }

  try {
    const prompt = [
      'Tu es un expert en creation de quiz. Ta reputation depend de la FIABILITE de tes questions. Une seule erreur = echec total.',
      '',
      'Genere exactement ' + count + ' questions de quiz QCM sur le theme : "' + theme + '".',
      'Difficulte : ' + difficulty + '.',
      '',
      'PROCESSUS OBLIGATOIRE POUR CHAQUE QUESTION :',
      'Etape 1 - Choisis un fait CERTAIN et VERIFIABLE sur le theme.',
      'Etape 2 - Formule la question de facon claire et non ambigue.',
      'Etape 3 - Ecris la bonne reponse. Sois 100% SUR que c\'est correct.',
      'Etape 4 - Ecris 3 mauvaises reponses plausibles mais CLAIREMENT fausses.',
      'Etape 5 - RELIS la question : est-ce que la bonne reponse est bien a l\'index indique ? Verifie.',
      'Etape 6 - Verifie que la question est COMPLETE : elle doit se suffire a elle-meme, sans contexte manquant. Le lecteur doit pouvoir comprendre et repondre sans information supplementaire.',
      'Etape 7 - Si tu as le MOINDRE doute sur l\'exactitude ou la clarte, REMPLACE cette question par une autre.',
      '',
      'REGLES STRICTES :',
      '- CERTITUDE ABSOLUE requise. Prefere une question simple et correcte a une question impressionnante mais douteuse.',
      '- UNE SEULE bonne reponse, les 3 autres sont fausses. Pas de "toutes les reponses" ou "aucune".',
      '- INTERDIT : approximations ("environ"), opinions, sujets qui changent dans le temps (classements actuels, populations, prix).',
      '- PRIVILEGIER : faits historiques dates, capitales, decouvertes scientifiques, regles de grammaire, formules, records etablis.',
      '- Les 4 options doivent etre du meme type (toutes des nombres, ou toutes des noms, etc.).',
      '- Varie la position de la bonne reponse : repartis entre index 0, 1, 2 et 3.',
      '- La bonne reponse ne doit PAS toujours etre la plus longue ou la plus detaillee.',
      '- Pas de doublons. Couvre differents aspects du theme.',
      '',
      'FORMAT DE SORTIE :',
      'Reponds UNIQUEMENT avec un tableau JSON, sans aucun texte avant ou apres.',
      '[{"question":"...","options":["A","B","C","D"],"answer":0}]',
      'answer = index (0-3) de la bonne reponse.',
      'Langue : ' + language + '. Ecris TOUT (questions + reponses) dans cette langue.'
    ].join('\n');

    // Step 1: Generate questions
    var text = await callAI(model, provider, effectiveKey, effectiveCfAccount, [{ role: 'user', content: prompt }]);
    console.log('AI raw response (first 300 chars):', text.substring(0, 300));
    var questions = parseJSON(text);
    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      console.error('AI returned no valid JSON. Full response:', text);
      throw new Error('Reponse IA invalide: ' + text.substring(0, 200));
    }
    // Quality validation: filter out bad questions
    var seenQuestions = new Set();
    var validQuestions = [];
    for (var qi = 0; qi < questions.length; qi++) {
      var q = questions[qi];
      // Basic format check
      if (!q.question || !Array.isArray(q.options) || q.options.length !== 4 ||
          typeof q.answer !== 'number' || q.answer < 0 || q.answer > 3) continue;
      // Trim all strings
      q.question = String(q.question).trim();
      for (var oi = 0; oi < 4; oi++) q.options[oi] = String(q.options[oi]).trim();
      // Skip if question or any option is empty
      if (!q.question || q.options.some(function(o) { return !o; })) continue;
      // Skip duplicate questions
      var qKey = q.question.toLowerCase().replace(/\s+/g, ' ');
      if (seenQuestions.has(qKey)) continue;
      seenQuestions.add(qKey);
      // Skip if options have duplicates
      var uniqueOpts = new Set(q.options.map(function(o) { return o.toLowerCase(); }));
      if (uniqueOpts.size < 4) continue;
      // Skip if correct answer text is empty or same as question
      if (q.options[q.answer].toLowerCase() === q.question.toLowerCase()) continue;
      validQuestions.push(q);
    }
    if (validQuestions.length === 0) throw new Error('Aucune question valide generee. Reessayez.');
    if (validQuestions.length < questions.length) {
      console.log('Quality filter: kept ' + validQuestions.length + '/' + questions.length + ' questions');
    }
    // Step 3: AI Validation (if enabled)
    if (validate && validatorModel && validQuestions.length > 0) {
      console.log('Validation: sending ' + validQuestions.length + ' questions to ' + validatorModel);
      var valPrompt = [
        'Tu es un verificateur de quiz. Voici des questions QCM. Pour chaque question, verifie si la bonne reponse (indiquee par "answer") est CORRECTE et INCONTESTABLE.',
        '',
        'SUPPRIME toute question ou :',
        '- La bonne reponse indiquee est fausse ou douteuse',
        '- La question est ambigue ou subjective',
        '- Plusieurs reponses pourraient etre correctes',
        '- Les informations sont approximatives ou non verifiables',
        '',
        'Corrige l\'index "answer" si tu detectes que la bonne reponse est a un autre index.',
        '',
        'Retourne UNIQUEMENT le tableau JSON des questions validees (meme format). Si toutes sont bonnes, retourne-les toutes. Si aucune n\'est valide, retourne [].',
        'Aucun texte avant ou apres le JSON.',
        '',
        'Questions a verifier :',
        JSON.stringify(validQuestions)
      ].join('\n');
      try {
        var valText = await callAI(validatorModel, provider, effectiveKey, effectiveCfAccount, [{ role: 'user', content: valPrompt }]);
        console.log('Validator response (first 300 chars):', valText.substring(0, 300));
        var validated = parseJSON(valText);
        if (validated && Array.isArray(validated) && validated.length > 0) {
          // Re-filter validated questions
          var finalQuestions = [];
          for (var vi = 0; vi < validated.length; vi++) {
            var vq = validated[vi];
            if (vq.question && Array.isArray(vq.options) && vq.options.length === 4 &&
                typeof vq.answer === 'number' && vq.answer >= 0 && vq.answer <= 3) {
              finalQuestions.push(vq);
            }
          }
          console.log('Validation result: ' + finalQuestions.length + '/' + validQuestions.length + ' questions approved');
          if (finalQuestions.length > 0) validQuestions = finalQuestions;
        } else {
          console.log('Validator returned no valid data, keeping original questions');
        }
      } catch(valErr) {
        console.error('Validation error (keeping original):', valErr.message);
      }
    }

    stats.trackAIGeneration(theme, validQuestions.length, model, language, difficulty);
    res.json({ questions: validQuestions, validated: !!(validate && validatorModel) });
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
      theme: data.theme || 'default', hostSeeAnswer: data.hostSeeAnswer !== false,
      players: new Map(), state: 'lobby', currentQ: -1, timer: null,
      answersThisRound: new Set(), questionStartTime: 0
    };
    rooms.set(pin, room);
    socket.join(pin);
    socket.data.role = 'host';
    socket.data.pin = pin;
    stats.trackGameCreated(pin, data.quiz.title, data.quiz.questions.length, data.theme);
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
    stats.trackPlayerJoined();
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
    stats.trackGameStarted(room.pin, room.players.size);
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

  socket.on('host:pause', function() {
    var room = rooms.get(socket.data.pin);
    if (!room || room.hostId !== socket.id) return;
    clearTimeout(room.timer);
    room.pausedAt = Date.now();
    io.to(room.pin).emit('game:paused');
  });

  socket.on('host:resume', function() {
    var room = rooms.get(socket.data.pin);
    if (!room || room.hostId !== socket.id) return;
    var q = room.quiz.questions[room.currentQ];
    var timeLimit = q.timeLimit || 20;
    var elapsed = (room.pausedAt - room.questionStartTime) / 1000;
    var remaining = Math.max(1, timeLimit - elapsed);
    room.questionStartTime = Date.now() - (elapsed * 1000);
    room.pausedAt = null;
    io.to(room.pin).emit('game:resumed', { remaining: Math.round(remaining) });
    room.timer = setTimeout(function() { showResults(room); }, remaining * 1000 + 500);
  });

  socket.on('host:stop', function() {
    var room = rooms.get(socket.data.pin);
    if (!room || room.hostId !== socket.id) return;
    clearTimeout(room.timer);
    room.state = 'results';
    var leaderboard = Array.from(room.players.values())
      .sort(function(a, b) { return b.score - a.score; })
      .map(function(p, i) { return { rank: i + 1, name: p.name, score: p.score }; });
    stats.trackGameCompleted(room.pin, room.players.size);
    io.to(room.pin).emit('game:finished', { leaderboard: leaderboard });
  });

  socket.on('host:kick', function(data) {
    var room = rooms.get(socket.data.pin);
    if (!room || room.hostId !== socket.id) return;
    var kickName = data.name;
    var kickedId = null;
    room.players.forEach(function(p, sid) {
      if (p.name === kickName) kickedId = sid;
    });
    if (!kickedId) return;
    stats.trackKick();
    room.players.delete(kickedId);
    room.answersThisRound.delete(kickedId);
    io.to(kickedId).emit('game:ended', { reason: "Tu as ete exclu par l'hote." });
    var kickedSocket = io.sockets.sockets.get(kickedId);
    if (kickedSocket) { kickedSocket.leave(room.pin); kickedSocket.data.pin = null; }
    io.to(room.hostId).emit('host:playerLeft', {
      name: kickName,
      players: Array.from(room.players.values()).map(function(p) { return { name: p.name, score: p.score }; })
    });
  });

  socket.on('host:toggleSound', function(data) {
    var room = rooms.get(socket.data.pin);
    if (!room || room.hostId !== socket.id) return;
    room.players.forEach(function(p, sid) {
      io.to(sid).emit('sound:toggle', { enabled: !!data.enabled });
    });
  });

  socket.on('host:quit', function() {
    var room = rooms.get(socket.data.pin);
    if (!room || room.hostId !== socket.id) return;
    clearTimeout(room.timer);
    io.to(room.pin).emit('game:ended', { reason: "L'hote a quitte la partie." });
    rooms.delete(room.pin);
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
  var questionData = {
    index: room.currentQ, total: room.quiz.questions.length,
    question: q.question, options: q.options, timeLimit: timeLimit
  };
  if (room.hostSeeAnswer) questionData.answer = q.answer;
  io.to(room.hostId).emit('game:question', questionData);
  var playerData = {
    index: room.currentQ, total: room.quiz.questions.length,
    question: q.question, options: q.options, timeLimit: timeLimit
  };
  room.players.forEach(function(p, sid) { io.to(sid).emit('game:question', playerData); });
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
    stats.trackGameCompleted(room.pin, room.players.size);
    io.to(room.pin).emit('game:finished', { leaderboard: leaderboard });
  }
}

var PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', function() {
  var ip = getLocalIP();
  console.log('Quizz Party est lance !');
  console.log('  Local :  http://localhost:' + PORT);
  console.log('  Reseau : http://' + ip + ':' + PORT);
});
