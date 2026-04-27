# 🎯 Quizz Party

Quiz multijoueur en temps réel — Jouez entre amis, en famille ou entre collègues !

## Lancer le jeu en local

```bash
cd quizz-party
npm install
node server.js
```

Ouvre http://localhost:3000 dans ton navigateur.

## Déploiement sur Render

Le projet est configuré pour un déploiement sur [Render](https://render.com) via le fichier `render.yaml`.

Variables d'environnement à configurer sur Render :
- `OPENROUTER_API_KEY` — clé API OpenRouter pour la génération IA
- `ADMIN_PASSWORD` — mot de passe du dashboard admin (défaut : `admin123`)

## Générer des questions par IA

Les questions peuvent être générées automatiquement via l'API OpenRouter sur n'importe quel thème.

**Option 1 :** Variable d'environnement
```bash
OPENROUTER_API_KEY=sk-or-xxx node server.js
```

**Option 2 :** Directement dans l'interface (champ "Clé API OpenRouter" sur la page de création)

Modèles disponibles : Google Gemma 4 31B (rapide), GPT OSS 120B (puissant).

Langues supportées : Français, English, العربية, Español, Português, Русский.

## Comment jouer

1. **L'hôte** va sur "Créer un Quiz", génère des questions par IA ou les crée manuellement
2. Il choisit un thème visuel, le temps par question, et si la bonne réponse est visible côté hôte
3. Un **code PIN** et un **QR code** s'affichent
4. Les **joueurs** ouvrent le lien sur leur téléphone et entrent le PIN ou scannent le QR — aucun compte requis
5. L'hôte lance la partie quand tout le monde est connecté
6. Les joueurs répondent en temps réel — plus vite = plus de points !
7. Le classement s'affiche entre chaque question

## Cas d'utilisation

- **Soirée entre amis** — Quiz cinéma, musique, culture pop
- **En famille** — Questions adaptées à tous les âges, idéal pour les réunions ou vacances
- **Pause entre collègues** — Transformez la pause café en défi
- **Événement d'association** — Quiz interactif sur grand écran pour animer vos événements

## Fonctionnalités

- Génération de questions par IA (OpenRouter) sur n'importe quel thème
- 15 thématiques prédéfinies + thème personnalisé
- QCM avec 4 choix de réponse
- Timer par question (configurable de 5 à 120 secondes)
- Score basé sur la rapidité + bonus de série
- Classement en direct avec podium
- 6 thèmes visuels (Default, Ocean, Sunset, Forest, Neon, Dark)
- Effets sonores synthétisés (Web Audio API, aucun fichier nécessaire)
- PIN + QR code pour rejoindre facilement
- Contrôles hôte : pause, reprendre, terminer, quitter
- Exclusion de joueurs par l'hôte
- Option : l'hôte voit (ou non) la bonne réponse pendant la question
- Dashboard admin avec statistiques complètes
- Mobile-friendly

## Dashboard Admin

Accessible sur `/admin.html` (mot de passe par défaut : `admin123`).

Statistiques disponibles : visites, parties créées/terminées, joueurs, générations IA, thèmes populaires, modèles et langues utilisés, historique des quiz générés, historique des parties avec timestamps et durée.

## Stack technique

- **Backend** : Node.js, Express, Socket.IO
- **Frontend** : HTML, CSS (custom properties), JavaScript vanilla
- **IA** : OpenRouter API (format OpenAI-compatible)
- **QR Code** : npm `qrcode`
- **Hébergement** : Render
