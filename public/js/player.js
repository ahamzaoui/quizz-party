var socket = io();
var myScore = 0;
var timerBarInterval = null;

var $ = function(sel) { return document.querySelector(sel); };
var $$ = function(sel) { return document.querySelectorAll(sel); };
function show(id) { $$('.container').forEach(function(c) { c.style.display = 'none'; }); $(id).style.display = ''; }

// Auto-fill PIN from URL
var urlPin = new URLSearchParams(window.location.search).get('pin');
if (urlPin) $('#join-pin').value = urlPin;

// ═══ JOIN ═══
$('#btn-join').addEventListener('click', function() {
  var pin = $('#join-pin').value.trim();
  var name = $('#join-name').value.trim();
  $('#join-error').textContent = '';
  if (!pin || pin.length !== 4) { $('#join-error').textContent = 'Entre un code PIN à 4 chiffres'; return; }
  if (!name) { $('#join-error').textContent = 'Choisis un pseudo !'; return; }
  socket.emit('player:join', { pin: pin, name: name }, function(res) {
    if (res.error) { $('#join-error').textContent = res.error; return; }
    if (res.theme) document.body.setAttribute('data-theme', res.theme);
    $('#waiting-quiz-title').textContent = res.quizTitle || 'Quizz Party';
    $('#waiting-name').textContent = name;
    show('#step-waiting');
  });
});

$('#join-pin').addEventListener('keydown', function(e) { if (e.key === 'Enter') $('#join-name').focus(); });
$('#join-name').addEventListener('keydown', function(e) { if (e.key === 'Enter') $('#btn-join').click(); });

// ═══ GAME STARTED ═══
socket.on('game:started', function() {
  SoundFX.whoosh();
});

// ═══ QUESTION ═══
socket.on('game:question', function(data) {
  SoundFX.whoosh();
  show('#step-play');
  $('#play-q-counter').textContent = (data.index + 1) + ' / ' + data.total;
  $('#play-score').textContent = myScore.toLocaleString() + ' pts';
  $('#play-question').textContent = data.question;

  var grid = $('#play-options');
  grid.innerHTML = data.options.map(function(o, i) {
    return '<button class="option-btn" data-idx="' + i + '">' + escHtml(o) + '</button>';
  }).join('');

  grid.querySelectorAll('.option-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      grid.querySelectorAll('.option-btn').forEach(function(b) { b.disabled = true; });
      btn.classList.add('selected');
      socket.emit('player:answer', { answerIndex: parseInt(btn.dataset.idx) });
    });
  });

  startTimerBar(data.timeLimit);
});

// ═══ ANSWER RESULT ═══
socket.on('player:result', function(data) {
  clearTimerBar();
  myScore = data.score;
  show('#step-feedback');
  var screen = $('#feedback-screen');
  screen.className = 'feedback-screen ' + (data.correct ? 'correct' : 'wrong');
  $('#feedback-icon').textContent = data.correct ? '✅' : '❌';
  $('#feedback-text').textContent = data.correct ? 'Bonne réponse !' : 'Mauvaise réponse...';
  $('#feedback-score').textContent = 'Score : ' + data.score.toLocaleString() + ' pts';
  $('#feedback-streak').textContent = data.streak > 1 ? '🔥 Série de ' + data.streak + ' !' : '';
  if (data.correct) SoundFX.correct(); else SoundFX.wrong();
});

// ═══ PAUSE / RESUME ═══
socket.on('game:paused', function() {
  clearTimerBar();
  var overlay = document.getElementById('player-pause-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'player-pause-overlay';
    overlay.className = 'pause-overlay';
    overlay.innerHTML = '<div class="pause-box"><span class="pause-icon">⏸</span><h2>Partie en pause</h2><p>L\'hôte a mis la partie en pause...</p></div>';
    document.body.appendChild(overlay);
  }
  overlay.style.display = '';
});

socket.on('game:resumed', function(data) {
  var overlay = document.getElementById('player-pause-overlay');
  if (overlay) overlay.style.display = 'none';
  startTimerBar(data.remaining);
});

// ═══ ROUND RESULTS ═══
socket.on('game:roundResults', function(data) {
  clearTimerBar();
  show('#step-player-results');
  $('#player-correct-answer').innerHTML = '✅ Bonne réponse : <strong>' + escHtml(data.correctText) + '</strong>';
  renderLeaderboard('#player-leaderboard', data.leaderboard);
});

// ═══ GAME FINISHED ═══
socket.on('game:finished', function(data) {
  SoundFX.victory();
  show('#step-player-final');
  var myName = $('#join-name').value.trim();
  var me = data.leaderboard.find(function(p) { return p.name === myName; });
  if (me) {
    var medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
    var medal = medals[me.rank] || '';
    var suffix = me.rank === 1 ? 'er' : 'ème';
    $('#player-final-rank').innerHTML = medal + ' Tu es <strong>' + me.rank + suffix + '</strong> avec <strong>' + me.score.toLocaleString() + ' pts</strong>';
  }
  renderLeaderboard('#player-final-leaderboard', data.leaderboard);
});

// ═══ DISCONNECTED ═══
socket.on('game:ended', function(data) {
  show('#step-disconnected');
  $('#disconnect-reason').textContent = data.reason;
});

// ═══ TIMER BAR ═══
function startTimerBar(seconds) {
  clearTimerBar();
  var bar = $('#play-timer-bar');
  bar.style.width = '100%';
  bar.classList.remove('urgent');
  var remaining = seconds;
  timerBarInterval = setInterval(function() {
    remaining -= 0.05;
    if (remaining <= 0) { clearTimerBar(); return; }
    var pct = (remaining / seconds) * 100;
    bar.style.width = pct + '%';
    if (pct < 25) bar.classList.add('urgent');
    if (remaining <= 5 && remaining % 1 < 0.05) SoundFX.countdown();
  }, 50);
}

function clearTimerBar() {
  if (timerBarInterval) { clearInterval(timerBarInterval); timerBarInterval = null; }
}

// ═══ RENDERING ═══
function renderLeaderboard(sel, lb) {
  var myName = $('#join-name').value.trim();
  $(sel).innerHTML = lb.map(function(p, i) {
    return '<div class="lb-row ' + (i < 3 ? 'top-' + (i+1) : '') + ' ' + (p.name === myName ? 'highlight' : '') + '" style="animation-delay:' + (i*0.1) + 's">' +
      '<span class="lb-rank">' + (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : p.rank) + '</span>' +
      '<span class="lb-name">' + escHtml(p.name) + (p.name === myName ? ' (toi)' : '') + '</span>' +
      '<span class="lb-score">' + p.score.toLocaleString() + ' pts</span></div>';
  }).join('');
}

function escHtml(s) {
  if (!s) return '';
  var d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}
