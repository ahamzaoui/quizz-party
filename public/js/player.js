/* ═══════════════════════════════════════════════════════════════════
   QUIZZ PARTY — Player Controller
   ═══════════════════════════════════════════════════════════════════ */

const socket = io();
let myScore = 0;
let timerBarInterval = null;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
function show(id) { $$('.container').forEach(c => c.style.display = 'none'); $(id).style.display = ''; }

// ── Auto-fill PIN from URL ──
const urlPin = new URLSearchParams(window.location.search).get('pin');
if (urlPin) $('#join-pin').value = urlPin;

// ── Join ──
$('#btn-join').addEventListener('click', () => {
  const pin = $('#join-pin').value.trim();
  const name = $('#join-name').value.trim();
  $('#join-error').textContent = '';

  if (!pin || pin.length !== 4) { $('#join-error').textContent = 'Entre un code PIN à 4 chiffres'; return; }
  if (!name) { $('#join-error').textContent = 'Choisis un pseudo !'; return; }

  socket.emit('player:join', { pin, name }, (res) => {
    if (res.error) { $('#join-error').textContent = res.error; return; }
    // Apply theme from host
    if (res.theme) document.body.setAttribute('data-theme', res.theme);
    $('#waiting-quiz-title').textContent = res.quizTitle || 'Quizz Party';
    $('#waiting-name').textContent = name;
    show('#step-waiting');
  });
});

// Enter key on inputs
$('#join-pin').addEventListener('keydown', e => { if (e.key === 'Enter') $('#join-name').focus(); });
$('#join-name').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btn-join').click(); });

// ── Game Started ──
socket.on('game:started', () => {
  SoundFX.whoosh();
});

// ── Question ──
socket.on('game:question', ({ index, total, question, options, timeLimit }) => {
  SoundFX.whoosh();
  show('#step-play');
  $('#play-q-counter').textContent = `${index + 1} / ${total}`;
  $('#play-score').textContent = `${myScore.toLocaleString()} pts`;
  $('#play-question').textContent = question;

  const grid = $('#play-options');
  grid.innerHTML = options.map((o, i) =>
    `<button class="option-btn" data-idx="${i}">${escHtml(o)}</button>`
  ).join('');

  // Click handlers
  grid.querySelectorAll('.option-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      // Disable all
      grid.querySelectorAll('.option-btn').forEach(b => { b.disabled = true; });
      btn.classList.add('selected');
      socket.emit('player:answer', { answerIndex: parseInt(btn.dataset.idx) });
    });
  });

  // Timer bar
  startTimerBar(timeLimit);
});

// ── Answer Result ──
socket.on('player:result', ({ correct, score, streak }) => {
  clearTimerBar();
  myScore = score;
  show('#step-feedback');
  const screen = $('#feedback-screen');
  screen.className = `feedback-screen ${correct ? 'correct' : 'wrong'}`;
  $('#feedback-icon').textContent = correct ? '✅' : '❌';
  $('#feedback-text').textContent = correct ? 'Bonne réponse !' : 'Mauvaise réponse...';
  $('#feedback-score').textContent = `Score : ${score.toLocaleString()} pts`;
  $('#feedback-streak').textContent = streak > 1 ? `🔥 Série de ${streak} !` : '';

  if (correct) SoundFX.correct(); else SoundFX.wrong();
});

// ── Round Results ──
socket.on('game:roundResults', ({ correctAnswer, correctText, leaderboard }) => {
  clearTimerBar();
  show('#step-player-results');
  $('#player-correct-answer').innerHTML = `✅ Bonne réponse : <strong>${escHtml(correctText)}</strong>`;
  renderLeaderboard('#player-leaderboard', leaderboard);
});

// ── Game Finished ──
socket.on('game:finished', ({ leaderboard }) => {
  SoundFX.victory();
  show('#step-player-final');
  const myName = $('#join-name').value.trim();
  const me = leaderboard.find(p => p.name === myName);
  if (me) {
    const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
    const medal = medals[me.rank] || '';
    $('#player-final-rank').innerHTML = `${medal} Tu es <strong>${me.rank}${me.rank === 1 ? 'er' : 'ème'}</strong> avec <strong>${me.score.toLocaleString()} pts</strong>`;
  }
  renderLeaderboard('#player-final-leaderboard', leaderboard);
});

// ── Disconnected ──
socket.on('game:ended', ({ reason }) => {
  show('#step-disconnected');
  $('#disconnect-reason').textContent = reason;
});

// ── Timer Bar ──
function startTimerBar(seconds) {
  clearTimerBar();
  const bar = $('#play-timer-bar');
  bar.style.width = '100%';
  bar.classList.remove('urgent');
  let remaining = seconds;

  timerBarInterval = setInterval(() => {
    remaining -= 0.05;
    if (remaining <= 0) { clearTimerBar(); return; }
    const pct = (remaining / seconds) * 100;
    bar.style.width = pct + '%';
    if (pct < 25) bar.classList.add('urgent');
    if (remaining <= 5 && remaining % 1 < 0.05) SoundFX.countdown();
  }, 50);
}

function clearTimerBar() {
  if (timerBarInterval) { clearInterval(timerBarInterval); timerBarInterval = null; }
}

// ── Rendering ──
function renderLeaderboard(sel, lb) {
  const myName = $('#join-name').value.trim();
  $(sel).innerHTML = lb.map((p, i) => `
    <div class="lb-row ${i < 3 ? 'top-' + (i+1) : ''} ${p.name === myName ? 'highlight' : ''}" style="animation-delay:${i*0.1}s">
      <span class="lb-rank">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : p.rank}</span>
      <span class="lb-name">${escHtml(p.name)} ${p.name === myName ? '(toi)' : ''}</span>
      <span class="lb-score">${p.score.toLocaleString()} pts</span>
    </div>
  `).join('');
}

function escHtml(s) {
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}
