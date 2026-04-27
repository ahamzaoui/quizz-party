const fs = require('fs');
const path = require('path');
const STATS_FILE = path.join(__dirname, 'stats.json');

var defaultStats = {
  totalVisits: 0, totalGamesCreated: 0, totalGamesCompleted: 0,
  totalPlayersJoined: 0, totalQuestionsGenerated: 0, totalAIGenerations: 0,
  totalKicks: 0, themes: {}, aiThemes: {}, models: {}, languages: {},
  difficulties: {}, dailyVisits: {}, dailyGames: {}, peakPlayers: 0,
  averagePlayersPerGame: 0, gamesPlayerCount: [], quizHistory: [], gameHistory: []
};

var stats = null;

function load() {
  try {
    if (fs.existsSync(STATS_FILE)) {
      stats = Object.assign({}, defaultStats, JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8')));
    } else { stats = Object.assign({}, defaultStats); }
  } catch(e) { stats = Object.assign({}, defaultStats); }
}

function save() {
  try { fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2)); } catch(e) {}
}

function getToday() { return new Date().toISOString().slice(0, 10); }
function inc(obj, key) { if (!obj[key]) obj[key] = 0; obj[key]++; }

function trackVisit() { stats.totalVisits++; inc(stats.dailyVisits, getToday()); save(); }

function trackGameCreated(pin, title, qCount, theme) {
  stats.totalGamesCreated++;
  inc(stats.dailyGames, getToday());
  if (title) inc(stats.themes, title);
  if (!stats.quizHistory) stats.quizHistory = [];
  stats.quizHistory.push({ pin: pin, title: title || 'Sans titre', questions: qCount || 0, theme: theme || 'default', createdAt: new Date().toISOString() });
  if (stats.quizHistory.length > 500) stats.quizHistory = stats.quizHistory.slice(-300);
  save();
}

function trackGameStarted(pin, playerCount) {
  if (!stats.gameHistory) stats.gameHistory = [];
  stats.gameHistory.push({ pin: pin, players: playerCount, startedAt: new Date().toISOString(), endedAt: null, status: 'en cours' });
  if (stats.gameHistory.length > 500) stats.gameHistory = stats.gameHistory.slice(-300);
  save();
}

function trackGameCompleted(pin, playerCount) {
  stats.totalGamesCompleted++;
  if (playerCount > stats.peakPlayers) stats.peakPlayers = playerCount;
  stats.gamesPlayerCount.push(playerCount);
  if (stats.gamesPlayerCount.length > 1000) stats.gamesPlayerCount = stats.gamesPlayerCount.slice(-500);
  var sum = 0;
  for (var i = 0; i < stats.gamesPlayerCount.length; i++) sum += stats.gamesPlayerCount[i];
  stats.averagePlayersPerGame = Math.round((sum / stats.gamesPlayerCount.length) * 10) / 10;
  if (stats.gameHistory) {
    for (var i = stats.gameHistory.length - 1; i >= 0; i--) {
      if (stats.gameHistory[i].pin === pin) {
        stats.gameHistory[i].endedAt = new Date().toISOString();
        stats.gameHistory[i].players = playerCount;
        stats.gameHistory[i].status = 'terminee';
        break;
      }
    }
  }
  save();
}

function trackPlayerJoined() { stats.totalPlayersJoined++; save(); }

function trackAIGeneration(theme, count, model, language, difficulty) {
  stats.totalAIGenerations++;
  stats.totalQuestionsGenerated += (count || 0);
  if (theme) inc(stats.aiThemes, theme);
  if (model) inc(stats.models, model);
  if (language) inc(stats.languages, language);
  if (difficulty) inc(stats.difficulties, difficulty);
  save();
}

function trackKick() { stats.totalKicks++; save(); }

function sortTop(obj, n) {
  return Object.entries(obj).sort(function(a, b) { return b[1] - a[1]; }).slice(0, n).map(function(e) { return { name: e[0], count: e[1] }; });
}

function getLast30Days(obj) {
  var result = [];
  var now = new Date();
  for (var i = 29; i >= 0; i--) {
    var d = new Date(now); d.setDate(d.getDate() - i);
    var key = d.toISOString().slice(0, 10);
    result.push({ date: key, count: obj[key] || 0 });
  }
  return result;
}

function getStats() {
  return {
    totalVisits: stats.totalVisits, totalGamesCreated: stats.totalGamesCreated,
    totalGamesCompleted: stats.totalGamesCompleted, totalPlayersJoined: stats.totalPlayersJoined,
    totalQuestionsGenerated: stats.totalQuestionsGenerated, totalAIGenerations: stats.totalAIGenerations,
    totalKicks: stats.totalKicks, peakPlayers: stats.peakPlayers,
    averagePlayersPerGame: stats.averagePlayersPerGame,
    topThemes: sortTop(stats.themes, 10), topAIThemes: sortTop(stats.aiThemes, 10),
    models: stats.models, languages: stats.languages, difficulties: stats.difficulties,
    dailyVisits: getLast30Days(stats.dailyVisits), dailyGames: getLast30Days(stats.dailyGames),
    quizHistory: (stats.quizHistory || []).slice(-50).reverse(),
    gameHistory: (stats.gameHistory || []).slice(-50).reverse()
  };
}

load();

module.exports = {
  trackVisit: trackVisit, trackGameCreated: trackGameCreated,
  trackGameStarted: trackGameStarted, trackGameCompleted: trackGameCompleted,
  trackPlayerJoined: trackPlayerJoined, trackAIGeneration: trackAIGeneration,
  trackKick: trackKick, getStats: getStats
};
