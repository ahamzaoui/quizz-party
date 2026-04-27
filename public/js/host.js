/* ═══════════════════════════════════════════════════════════════════
   QUIZZ PARTY — Host Controller
   ═══════════════════════════════════════════════════════════════════ */

const socket = io();
let currentTheme = 'default';
let questionCount = 0;
let timerInterval = null;
let stopTension = null;

// ── Helpers ──
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
function show(id) { $$(`.container`).forEach(c => c.style.display = 'none'); $(id).style.display = ''; }
function setTheme(t) { document.body.setAttribute('data-theme', t); currentTheme = t; }

// ── Theme Picker ──
$$('.theme-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.theme-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    setTheme(btn.dataset.theme);
  });
});

// ── AI Generation ──
(async function checkKey() {
  try {
    const res = await fetch('/api/has-key');
    const { hasKey } = await res.json();
    if (hasKey) {
      $('#ai-key-row').style.display = 'none';
      $('#ai-key-status').textContent = '✅ Clé API configurée (variable d\'environnement)';
    }
  } catch(e) {}
})();

$('#btn-save-key').addEventListener('click', async () => {
  const key = $('#ai-key').value.trim();
  if (!key) return;
  try {
    const res = await fetch('/api/set-key', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key })
    });
    if (res.ok) {
      $('#ai-key-status').textContent = '✅ Clé enregistrée';
      $('#ai-key-status').className = 'ai-key-status';
      $('#ai-key').value = '';
      $('#ai-key-row').style.display = 'none';
    }
  } catch(e) {
    $('#ai-key-status').textContent = '❌ Erreur';
    $('#ai-key-status').className = 'ai-key-status error';
  }
});

// Theme preset / custom toggle
$('#ai-theme-preset').addEventListener('change', () => {
  const val = $('#ai-theme-preset').value;
  if (val === 'custom') {
    $('#ai-theme').style.display = '';
    $('#ai-theme').focus();
  } else {
    $('#ai-theme').style.display = 'none';
    $('#ai-theme').value = '';
  }
});

$('#btn-ai-generate').addEventListener('click', async () => {
  const preset = $('#ai-theme-preset').value;
  const custom = $('#ai-theme').value.trim();
  const theme = (preset === 'custom' || preset === '') ? custom : preset;
  if (!theme) { $('#ai-error').textContent = 'Choisis ou écris un thème pour générer les questions !'; return; }

  const btn = $('#btn-ai-generate');
  const btnText = btn.querySelector('.ai-btn-text');
  const btnLoading = btn.querySelector('.ai-btn-loading');
  btn.disabled = true;
  btnText.style.display = 'none';
  btnLoading.style.display = '';
  $('#ai-error').textContent = '';

  try {
    const res = await fetch('/api/generate-questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        theme,
        count: parseInt($('#ai-count').value),
        difficulty: $('#ai-difficulty').value,
        model: $('#ai-model').value,
        language: $('#ai-language').value
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur serveur');

    // Clear existing questions and add generated ones
    $('#questions-list').innerHTML = '';
    questionCount = 0;
    data.questions.forEach(q => addQuestion(q));
    updateQuestionCount();

    // Auto-fill quiz title if empty
    if (!$('#quiz-title').value.trim()) {
      $('#quiz-title').value = theme;
    }

    SoundFX.correct();
  } catch(e) {
    $('#ai-error').textContent = e.message;
    SoundFX.wrong();
  } finally {
    btn.disabled = false;
    btnText.style.display = '';
    btnLoading.style.display = 'none';
  }
});

function updateQuestionCount() {
  const count = $$('.question-card').length;
  const el = $('#q-total-count');
  if (el) el.textContent = count;
}

// ── Question Builder ──
function addQuestion(data) {
  questionCount++;
  const num = questionCount;
  const div = document.createElement('div');
  div.className = 'question-card';
  div.dataset.num = num;
  const colors = ['#e74c3c', '#3498db', '#f39c12', '#2ecc71'];
  div.innerHTML = `
    <span class="q-number">Question ${num}</span>
    <button class="btn-remove-q" onclick="this.parentElement.remove(); updateQuestionCount()">&times;</button>
    <input type="text" class="q-text" placeholder="Tapez votre question..." value="${data?.question || ''}">
    <div class="options-editor">
      ${[0,1,2,3].map(i => `
        <div class="option-row">
          <span class="color-dot" style="background:${colors[i]}"></span>
          <input type="radio" name="correct-${num}" value="${i}" ${(data?.answer === i || (!data && i === 0)) ? 'checked' : ''}>
          <input type="text" class="q-opt" data-idx="${i}" placeholder="Réponse ${i+1}" value="${data?.options?.[i] || ''}">
        </div>
      `).join('')}
    </div>
  `;
  $('#questions-list').appendChild(div);
}

$('#btn-add-question').addEventListener('click', () => { addQuestion(); updateQuestionCount(); });

// Add 3 starter questions
addQuestion({ question: 'Quelle est la capitale de la France ?', options: ['Londres', 'Paris', 'Berlin', 'Madrid'], answer: 1 });
addQuestion({ question: 'Combien y a-t-il de continents ?', options: ['5', '6', '7', '8'], answer: 2 });
addQuestion({ question: 'Quel est le plus grand océan ?', options: ['Atlantique', 'Indien', 'Arctique', 'Pacifique'], answer: 3 });
updateQuestionCount();

// ── Create Room ──
$('#btn-create-room').addEventListener('click', () => {
  const title = $('#quiz-title').value.trim() || 'Quiz sans titre';
  const themeSelect = $('#quiz-theme-select').value;
  const defaultTime = parseInt($('#default-time').value) || 20;

  // Collect questions
  const cards = $$('.question-card');
  if (cards.length === 0) return alert('Ajoute au moins une question !');

  const questions = [];
  for (const card of cards) {
    const q = card.querySelector('.q-text').value.trim();
    if (!q) { alert('Une question est vide !'); return; }
    const opts = Array.from(card.querySelectorAll('.q-opt')).map(i => i.value.trim());
    if (opts.some(o => !o)) { alert(`Remplis toutes les réponses pour "${q}"`); return; }
    const answer = parseInt(card.querySelector('input[type="radio"]:checked').value);
    questions.push({ question: q, options: opts, answer, timeLimit: defaultTime });
  }

  const quiz = { title, theme: themeSelect, questions };
  socket.emit('host:create', { quiz, theme: currentTheme }, ({ pin }) => {
    $('#lobby-pin').textContent = pin;
    // Load QR code
    fetch(`/api/qrcode/${pin}`).then(r => r.text()).then(svg => {
      $('#lobby-qr').innerHTML = svg;
    });
    fetch('/api/ip').then(r => r.json()).then(info => {
      $('#lobby-url').textContent = `${info.base}/play.html?pin=${pin}`;
    });
    show('#step-lobby');
  });
});

// ── Lobby Events ──
socket.on('host:playerJoined', ({ players }) => {
  SoundFX.join();
  $('#player-count').textContent = players.length;
  $('#players-grid').innerHTML = players.map(p =>
    `<div class="player-chip">${escHtml(p.name)}</div>`
  ).join('');
  $('#btn-start-game').disabled = players.length < 1;
});

socket.on('host:playerLeft', ({ name, players }) => {
  $('#player-count').textContent = players.length;
  $('#players-grid').innerHTML = players.map(p =>
    `<div class="player-chip">${escHtml(p.name)}</div>`
  ).join('');
});

$('#btn-start-game').addEventListener('click', () => {
  socket.emit('host:start');
});

// ── Game Events ──
socket.on('game:started', () => {
  show('#step-game');
});

socket.on('game:question', ({ index, total, question, options, timeLimit }) => {
  SoundFX.whoosh();
  show('#step-game');
  $('#game-q-counter').textContent = `${index + 1} / ${total}`;
  $('#game-question').textContent = question;
  $('#game-options').innerHTML = options.map((o, i) =>
    `<div class="option-btn">${escHtml(o)}</div>`
  ).join('');
  $('#game-answer-count').textContent = `0 / ?`;

  // Timer ring
  startTimer(timeLimit);
});

socket.on('host:answerCount', ({ count, total }) => {
  $('#game-answer-count').textContent = `${count} / ${total}`;
});

socket.on('game:roundResults', ({ correctAnswer, correctText, leaderboard, isLast }) => {
  clearTimer();
  show('#step-results');
  $('#correct-answer').innerHTML = `✅ Bonne réponse : <strong>${escHtml(correctText)}</strong>`;
  renderLeaderboard('#leaderboard', leaderboard);

  if (isLast) {
    $('#btn-next-q').style.display = 'none';
  } else {
    $('#btn-next-q').style.display = '';
  }
});

$('#btn-next-q').addEventListener('click', () => {
  socket.emit('host:next');
});

socket.on('game:finished', ({ leaderboard }) => {
  SoundFX.victory();
  show('#step-final');
  renderPodium(leaderboard);
  renderLeaderboard('#final-leaderboard', leaderboard);
});

// ── Timer ──
function startTimer(seconds) {
  clearTimer();
  let remaining = seconds;
  const circle = $('#timer-circle');
  const circumference = 2 * Math.PI * 45; // r=45
  circle.style.strokeDasharray = circumference;
  circle.style.strokeDashoffset = 0;
  $('#timer-text').textContent = remaining;

  stopTension = SoundFX.startTension(100);

  timerInterval = setInterval(() => {
    remaining--;
    if (remaining < 0) { clearTimer(); return; }
    $('#timer-text').textContent = remaining;
    const offset = circumference * (1 - remaining / seconds);
    circle.style.strokeDashoffset = offset;
    if (remaining <= 5) {
      circle.style.stroke = 'var(--danger)';
      SoundFX.countdown();
    }
  }, 1000);
}

function clearTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  if (stopTension) { stopTension(); stopTension = null; }
}

// ── Rendering ──
function renderLeaderboard(sel, lb) {
  $(sel).innerHTML = lb.map((p, i) => `
    <div class="lb-row ${i < 3 ? 'top-' + (i+1) : ''}" style="animation-delay:${i*0.1}s">
      <span class="lb-rank">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : p.rank}</span>
      <span class="lb-name">${escHtml(p.name)}</span>
      <span class="lb-score">${p.score.toLocaleString()} pts</span>
    </div>
  `).join('');
}

function renderPodium(lb) {
  const medals = ['🥇', '🥈', '🥉'];
  const order = [1, 0, 2]; // display order: 2nd, 1st, 3rd
  let html = '';
  order.forEach(idx => {
    if (lb[idx]) {
      html += `
        <div class="podium-slot podium-${idx + 1}">
          <div class="podium-bar">
            <span class="podium-medal">${medals[idx]}</span>
            <span class="podium-name">${escHtml(lb[idx].name)}</span>
            <span class="podium-score">${lb[idx].score.toLocaleString()} pts</span>
          </div>
        </div>`;
    }
  });
  $('#final-podium').innerHTML = html;
}

function escHtml(s) {
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}
