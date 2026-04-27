var socket = io();
var currentTheme = 'default';
var questionCount = 0;
var timerInterval = null;
var stopTension = null;
var hostSeeAnswer = true;
var userApiKey = '';

var $ = function(sel) { return document.querySelector(sel); };
var $$ = function(sel) { return document.querySelectorAll(sel); };
function show(id) { $$('.container').forEach(function(c) { c.style.display = 'none'; }); $(id).style.display = ''; }
function setTheme(t) { document.body.setAttribute('data-theme', t); currentTheme = t; }

$$('.theme-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    $$('.theme-btn').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    setTheme(btn.dataset.theme);
  });
});

(async function() {
  try {
    var res = await fetch('/api/has-key');
    var d = await res.json();
    if (d.hasKey) {
      $('#ai-key-row').style.display = 'none';
      $('#ai-key-status').textContent = 'Cle API configuree';
    }
  } catch(e) {}
})();

$('#btn-save-key').addEventListener('click', function() {
  var key = $('#ai-key').value.trim();
  if (!key) return;
  userApiKey = key;
  $('#ai-key-status').textContent = 'Cle enregistree pour cette session';
  $('#ai-key-status').className = 'ai-key-status';
  $('#ai-key').value = '';
  $('#ai-key-row').style.display = 'none';
});

$('#ai-theme-preset').addEventListener('change', function() {
  var val = $('#ai-theme-preset').value;
  if (val === 'custom') { $('#ai-theme').style.display = ''; $('#ai-theme').focus(); }
  else { $('#ai-theme').style.display = 'none'; $('#ai-theme').value = ''; }
});

$('#btn-ai-generate').addEventListener('click', async function() {
  var preset = $('#ai-theme-preset').value;
  var custom = $('#ai-theme').value.trim();
  var theme = (preset === 'custom' || preset === '') ? custom : preset;
  if (!theme) { $('#ai-error').textContent = 'Choisis ou ecris un theme !'; return; }
  var btn = $('#btn-ai-generate');
  var btnText = btn.querySelector('.ai-btn-text');
  var btnLoading = btn.querySelector('.ai-btn-loading');
  btn.disabled = true; btnText.style.display = 'none'; btnLoading.style.display = '';
  $('#ai-error').textContent = '';
  try {
    var res = await fetch('/api/generate-questions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: theme, count: parseInt($('#ai-count').value), difficulty: $('#ai-difficulty').value, model: $('#ai-model').value, language: $('#ai-language').value, userKey: userApiKey || undefined })
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur serveur');
    $('#questions-list').innerHTML = ''; questionCount = 0;
    data.questions.forEach(function(q) { addQuestion(q); });
    updateQuestionCount();
    if (!$('#quiz-title').value.trim()) $('#quiz-title').value = theme;
    SoundFX.correct();
  } catch(e) { $('#ai-error').textContent = e.message; SoundFX.wrong(); }
  finally { btn.disabled = false; btnText.style.display = ''; btnLoading.style.display = 'none'; }
});

function updateQuestionCount() { var el = $('#q-total-count'); if (el) el.textContent = $$('.question-card').length; }

function addQuestion(data) {
  questionCount++;
  var num = questionCount;
  var div = document.createElement('div');
  div.className = 'question-card';
  var colors = ['#e74c3c', '#3498db', '#f39c12', '#2ecc71'];
  div.innerHTML = '<span class="q-number">Question ' + num + '</span>' +
    '<button class="btn-remove-q" onclick="this.parentElement.remove(); updateQuestionCount()">&times;</button>' +
    '<input type="text" class="q-text" placeholder="Tapez votre question..." value="' + escHtml(data && data.question || '') + '">' +
    '<div class="options-editor">' +
    [0,1,2,3].map(function(i) {
      return '<div class="option-row"><span class="color-dot" style="background:' + colors[i] + '"></span>' +
        '<input type="radio" name="correct-' + num + '" value="' + i + '"' + ((data && data.answer === i) || (!data && i === 0) ? ' checked' : '') + '>' +
        '<input type="text" class="q-opt" data-idx="' + i + '" placeholder="Reponse ' + (i+1) + '" value="' + escHtml(data && data.options && data.options[i] || '') + '"></div>';
    }).join('') + '</div>';
  $('#questions-list').appendChild(div);
}

$('#btn-add-question').addEventListener('click', function() { addQuestion(); updateQuestionCount(); });
addQuestion({ question: 'Quelle est la capitale de la France ?', options: ['Londres', 'Paris', 'Berlin', 'Madrid'], answer: 1 });
addQuestion({ question: 'Combien y a-t-il de continents ?', options: ['5', '6', '7', '8'], answer: 2 });
addQuestion({ question: 'Quel est le plus grand ocean ?', options: ['Atlantique', 'Indien', 'Arctique', 'Pacifique'], answer: 3 });
updateQuestionCount();

$('#btn-create-room').addEventListener('click', function() {
  var title = $('#quiz-title').value.trim() || 'Quiz sans titre';
  var defaultTime = parseInt($('#default-time').value) || 20;
  var cards = $$('.question-card');
  if (cards.length === 0) { alert('Ajoute au moins une question !'); return; }
  var questions = [];
  for (var c = 0; c < cards.length; c++) {
    var card = cards[c];
    var q = card.querySelector('.q-text').value.trim();
    if (!q) { alert('Une question est vide !'); return; }
    var opts = Array.from(card.querySelectorAll('.q-opt')).map(function(i) { return i.value.trim(); });
    if (opts.some(function(o) { return !o; })) { alert('Remplis toutes les reponses pour "' + q + '"'); return; }
    var answer = parseInt(card.querySelector('input[type="radio"]:checked').value);
    questions.push({ question: q, options: opts, answer: answer, timeLimit: defaultTime });
  }
  hostSeeAnswer = $('#host-see-answer').checked;
  var quiz = { title: title, questions: questions };
  socket.emit('host:create', { quiz: quiz, theme: currentTheme, hostSeeAnswer: hostSeeAnswer }, function(res) {
    $('#lobby-pin').textContent = res.pin;
    fetch('/api/qrcode/' + res.pin).then(function(r) { return r.text(); }).then(function(svg) { $('#lobby-qr').innerHTML = svg; });
    fetch('/api/ip').then(function(r) { return r.json(); }).then(function(info) { $('#lobby-url').textContent = info.base + '/play.html?pin=' + res.pin; });
    show('#step-lobby');
  });
});

function renderPlayers(players, animate) {
  var grid = $('#players-grid');
  grid.innerHTML = players.map(function(p) {
    return '<div class="player-card' + (animate ? ' fade-in' : '') + '">' +
      '<span class="player-avatar">' + p.name.charAt(0).toUpperCase() + '</span>' +
      '<span>' + escHtml(p.name) + '</span>' +
      '<button class="btn-kick" title="Exclure" data-name="' + escHtml(p.name) + '">&times;</button>' +
      '</div>';
  }).join('');
  $('#player-count').textContent = players.length;
  $('#btn-start-game').disabled = players.length < 1;
  grid.querySelectorAll('.btn-kick').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var name = btn.dataset.name;
      if (confirm('Exclure ' + name + ' de la partie ?')) {
        socket.emit('host:kick', { name: name });
      }
    });
  });
}

socket.on('host:playerJoined', function(data) { SoundFX.join(); renderPlayers(data.players, true); });
socket.on('host:playerLeft', function(data) { renderPlayers(data.players, false); });
$('#btn-start-game').addEventListener('click', function() { socket.emit('host:start'); });

socket.on('game:started', function() { SoundFX.whoosh(); });

socket.on('game:question', function(data) {
  SoundFX.whoosh();
  show('#step-game');
  $('#game-q-counter').textContent = (data.index + 1) + ' / ' + data.total;
  $('#game-question').textContent = data.question;
  $('#game-answer-count').textContent = '0 / 0';
  var grid = $('#game-options');
  var colors = ['#e74c3c', '#3498db', '#f39c12', '#2ecc71'];
  grid.innerHTML = data.options.map(function(o, i) {
    var isCorrect = hostSeeAnswer && data.answer === i;
    return '<div class="host-option' + (isCorrect ? ' host-correct' : '') + '" style="border-left: 4px solid ' + colors[i] + '">' + escHtml(o) + (isCorrect ? ' ✅' : '') + '</div>';
  }).join('');
  startTimer(data.timeLimit);
});

socket.on('host:answerCount', function(data) {
  $('#game-answer-count').textContent = data.count + ' / ' + data.total;
});

socket.on('game:roundResults', function(data) {
  clearTimer();
  SoundFX.correct();
  show('#step-results');
  $('#correct-answer').innerHTML = '✅ Bonne reponse : <strong>' + escHtml(data.correctText) + '</strong>';
  renderLeaderboard('#leaderboard', data.leaderboard);
  if (data.isLast) {
    $('#btn-next-q').style.display = 'none';
    $('#results-title').textContent = '🏆 Classement final';
  } else {
    $('#btn-next-q').style.display = '';
    $('#results-title').textContent = '🏆 Classement';
  }
});

socket.on('game:finished', function(data) {
  SoundFX.victory();
  show('#step-final');
  renderPodium('#final-podium', data.leaderboard);
  renderLeaderboard('#final-leaderboard', data.leaderboard);
});

socket.on('game:ended', function() { alert("La partie est terminee."); window.location.href = '/'; });

$('#btn-next-q').addEventListener('click', function() { socket.emit('host:next'); });

$('#btn-pause').addEventListener('click', function() {
  socket.emit('host:pause');
  $('#pause-overlay').style.display = '';
});
$('#btn-resume').addEventListener('click', function() {
  socket.emit('host:resume');
  $('#pause-overlay').style.display = 'none';
});
socket.on('game:paused', function() { clearTimer(); $('#pause-overlay').style.display = ''; });
socket.on('game:resumed', function(data) {
  $('#pause-overlay').style.display = 'none';
  if (data && data.remaining) startTimer(data.remaining);
});

$('#btn-stop').addEventListener('click', function() {
  if (confirm('Terminer la partie maintenant ?')) socket.emit('host:stop');
});
$('#btn-stop-results').addEventListener('click', function() {
  if (confirm('Terminer la partie maintenant ?')) socket.emit('host:stop');
});
$('#btn-quit').addEventListener('click', function() {
  if (confirm('Quitter ? Tous les joueurs seront deconnectes.')) { socket.emit('host:quit'); window.location.href = '/'; }
});
$('#btn-quit-results').addEventListener('click', function() {
  if (confirm('Quitter ? Tous les joueurs seront deconnectes.')) { socket.emit('host:quit'); window.location.href = '/'; }
});

function startTimer(seconds) {
  clearTimer();
  var circle = $('#timer-circle');
  var text = $('#timer-text');
  var circumference = 2 * Math.PI * 45;
  circle.style.strokeDasharray = circumference;
  circle.style.strokeDashoffset = '0';
  var remaining = seconds;
  text.textContent = Math.ceil(remaining);
  timerInterval = setInterval(function() {
    remaining -= 0.05;
    if (remaining <= 0) { clearTimer(); text.textContent = '0'; return; }
    var pct = 1 - (remaining / seconds);
    circle.style.strokeDashoffset = (pct * circumference).toFixed(1);
    text.textContent = Math.ceil(remaining);
    if (remaining <= 5 && remaining % 1 < 0.05) SoundFX.countdown();
  }, 50);
  stopTension = SoundFX.startTension ? SoundFX.startTension(seconds) : null;
}

function clearTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  if (stopTension) { stopTension(); stopTension = null; }
}

function renderLeaderboard(sel, lb) {
  var html = '';
  for (var i = 0; i < lb.length; i++) {
    var p = lb[i];
    var cls = i < 3 ? 'top-' + (i+1) : '';
    var icon = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : p.rank;
    html += '<div class="lb-row ' + cls + '" style="animation-delay:' + (i*0.1) + 's">';
    html += '<span class="lb-rank">' + icon + '</span>';
    html += '<span class="lb-name">' + escHtml(p.name) + '</span>';
    html += '<span class="lb-score">' + p.score.toLocaleString() + ' pts</span></div>';
  }
  $(sel).innerHTML = html;
}

function renderPodium(sel, lb) {
  var top3 = lb.slice(0, 3);
  var medals = ['🥇', '🥈', '🥉'];
  var html = '<div class="podium-row">';
  for (var i = 0; i < top3.length; i++) {
    html += '<div class="podium-item podium-' + (i+1) + '">';
    html += '<div class="podium-medal">' + medals[i] + '</div>';
    html += '<div class="podium-name">' + escHtml(top3[i].name) + '</div>';
    html += '<div class="podium-score">' + top3[i].score.toLocaleString() + ' pts</div>';
    html += '</div>';
  }
  html += '</div>';
  $(sel).innerHTML = html;
}

function escHtml(s) {
  if (!s) return '';
  var d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
