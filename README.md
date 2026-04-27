# 🎯 Quizz Party

Quiz multijoueur en temps réel — Jouez entre amis !

## Lancer le jeu

```bash
cd quizz-party
npm install
npm start
```

Ouvre http://localhost:3000 dans ton navigateur.

## Générer des questions par IA

Tu peux générer automatiquement des questions sur n'importe quel thème grâce à l'API Claude.

**Option 1 :** Variable d'environnement
```bash
ANTHROPIC_API_KEY=sk-ant-xxx npm start
```

**Option 2 :** Directement dans l'interface (champ "Clé API Anthropic" sur la page de création)

Ensuite, tape un thème (ex: "Le cinéma des années 80", "La physique quantique", "Les capitales du monde"), choisis le nombre de questions et la difficulté, puis clique sur "Générer les questions".

## Comment jouer

1. **L'hôte** va sur "Créer un Quiz", génère des questions par IA ou les crée manuellement, choisit un thème et lance la partie
2. Un **code PIN** et un **QR code** s'affichent
3. Les **joueurs** ouvrent l'adresse affichée sur leur téléphone (même réseau WiFi) et entrent le PIN ou scannent le QR
4. L'hôte lance la partie quand tout le monde est connecté
5. Les joueurs répondent aux questions en temps réel — plus vite = plus de points !
6. Le classement s'affiche entre chaque question

## Fonctionnalités

- Génération de questions par IA (Claude) sur n'importe quel thème
- QCM avec 4 choix de réponse
- Timer par question (configurable)
- Score basé sur la rapidité + bonus de série
- Classement en direct
- 6 thèmes visuels
- Effets sonores synthétisés (pas de fichiers audio nécessaires)
- PIN + QR code pour rejoindre
- Mobile-friendly
