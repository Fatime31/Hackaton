# Watch Together

Salle de projection virtuelle pour démos produit, formations et lancements.
Un présentateur pilote la lecture (play / pause / seek / vitesse), tous les
invités voient exactement la même chose au même moment.

- **Frontend** : React 18 + Vite (`/client`)
- **Serveur de synchro** : Node.js + Express + Socket.IO (`/server`)
- **Persistance** : SQLite via le module intégré `node:sqlite` (`/server/db.js`)
- **Protocole** : voir [`PROTOCOL.md`](./PROTOCOL.md)

Le frontend est le livrable demandé par le sujet ; le petit serveur
Socket.IO est nécessaire pour que plusieurs postes sur le réseau local
voient réellement la même chose — c'est lui qui fait office d'horloge de
référence et de relais des commandes (voir `PROTOCOL.md` pour le détail).

> **Prérequis** : Node.js **22.5+** (pour `node:sqlite`, encore marqué
> expérimental par Node mais pleinement fonctionnel — voir la section
> Base de données ci-dessous).

## Base de données

L'état de lecture en temps réel (position vidéo, lecture/pause, dérive de
chaque invité) reste **en mémoire** côté serveur (`server/rooms.js`) : il
change des dizaines de fois par minute et doit être lu/écrit sans latence
pour que la synchro reste instantanée.

Ce qui doit survivre et être interrogé ensuite est en revanche persisté
dans un fichier **SQLite** (`server/data/watch-together.db`, créé
automatiquement au premier démarrage) :

| Table | Contenu |
|---|---|
| `rooms` | code, vidéo, nom du présentateur, date de création/fermeture |
| `participants` | chaque présentateur/invité d'une salle, avec heure d'arrivée et de départ |
| `messages` | chat et réactions, horodatés |

Deux routes REST permettent de lire cet historique sans toucher au
fichier `.db` directement — pratique pour une intégration externe :

```
GET /api/rooms              → liste des salles récentes
GET /api/rooms/:code        → détail d'une salle (participants + messages)
```

Le fichier `.db` est un fichier SQLite standard : n'importe quel outil ou
langage (DB Browser for SQLite, Python, un autre service Node…) peut le
lire directement si besoin, sans passer par l'API.

## Export vers une autre équipe (analytics)

En plus des trois tables ci-dessus, une table `event_logs` enregistre
chaque action de lecture (play/pause/seek/vitesse côté présentateur, ping
de position côté invité) avec sa position vidéo et son horodatage — le
détail fin qu'une équipe d'analyse externe voudrait exploiter (courbes de
dérive, temps de visionnage réel, etc.), distinct du `participants`/`messages`
qui sert plutôt à l'historique fonctionnel.

**Récupération à la demande** :

```
GET /api/analytics/:code   → { metadata, participants, messages, logs }
```

**Envoi automatique** : si la variable d'environnement
`ANALYTICS_WEBHOOK_URL` est définie, le serveur POST ce même payload JSON
vers cette adresse dès qu'une salle se ferme (présentateur parti). Si elle
n'est pas définie, ce comportement est simplement désactivé (aucune erreur).

```bash
ANALYTICS_WEBHOOK_URL=https://exemple.com/webhook \
ANALYTICS_WEBHOOK_SECRET=un-secret-partagé \
npm start
```

`ANALYTICS_WEBHOOK_SECRET`, si défini, est envoyé dans l'en-tête
`X-Webhook-Secret` — à l'autre équipe de vérifier cet en-tête côté
réception pour s'assurer que les données viennent bien de ce serveur.
L'envoi a un délai d'expiration de 8 secondes et n'empêche jamais la salle
de se fermer normalement même si l'autre équipe est injoignable : les
données restent de toute façon dans SQLite et peuvent être récupérées plus
tard via la route `GET /api/analytics/:code` ci-dessus.


## Installation

```bash
# 1) Serveur
cd server
npm install

# 2) Client
cd ../client
npm install
```

## Lancer en développement (2 ports)

```bash
# Terminal 1
cd server
npm run dev        # http://localhost:4000

# Terminal 2
cd client
npm run dev        # http://localhost:5173
```

Le client détecte automatiquement l'adresse du serveur (même machine, port
4000). Un invité qui ouvre `http://<ip-du-présentateur>:5173` depuis un
autre poste du réseau local n'a rien à configurer.

## Lancer en mode "un seul port" (recommandé pour la démo / le test multi-postes)

```bash
cd client
npm run build       # génère client/dist

cd ../server
npm start            # sert l'app ET l'API/Socket.IO sur le port 4000
```

Le serveur affiche au démarrage les adresses à partager :

```
Local   → http://localhost:4000
Réseau  → http://192.168.1.23:4000
```

Partagez l'adresse **Réseau** : présentateur et invités ouvrent la même URL
depuis leurs navigateurs respectifs, sur le même Wi-Fi/LAN.

## Tester avec 1 présentateur + 2 invités

1. Sur le poste A : ouvrir l'app, **Créer une salle**, donner un nom,
   importer un fichier vidéo (ou coller une URL), valider. Un code de
   salle (ex. `V32WX`) s'affiche.
2. Sur les postes B et C (même réseau) : ouvrir l'app, **Rejoindre une
   salle**, entrer le code et un nom.
3. Sur le poste A, jouer avec play / pause / la barre de progression / la
   vitesse de lecture : B et C doivent suivre en quelques centaines de
   millisecondes.
4. Pour observer le rattrapage d'un retardataire : faire rejoindre un
   4ᵉ poste en cours de lecture — il doit démarrer directement à la bonne
   position.
5. Pour observer la dérive et le recalage : couper le Wi-Fi d'un invité
   quelques secondes puis le rétablir — son badge de synchro passe à
   « Recalage… » puis revient à « Synchronisé · Xms ».

## Fonctionnalités

- Salons avec rôles présentateur / invité, code de salle court.
- Play / pause / seek / vitesse du présentateur répercutés à tous les
  invités.
- Resynchronisation automatique d'un retardataire (état complet appliqué
  dès la connexion).
- Gestion de la dérive à deux niveaux (ajustement doux de `playbackRate`,
  puis recalage direct au-delà de 300ms) — voir `PROTOCOL.md`.
- Liste des participants connectés avec statut de synchro en direct.
- Aucun contrôle de lecture côté invité, en toutes circonstances (pas de
  bouton play/pause/seek, pas d'option pour les activer).
- Chat et réactions emoji.
- Import de fichier vidéo (servi par le serveur) ou URL externe.

## Limites connues (hackathon — pistes d'amélioration)

- L'état de lecture **en temps réel** (position, isPlaying, dérive) reste en
  mémoire : un redémarrage du serveur ferme les salles actives. L'historique
  (salles, participants, chat), lui, survit puisqu'il est en SQLite.
- Si le présentateur rafraîchit sa page, la salle se ferme (son `socket.id`
  change). Une reconnexion par jeton de session serait la suite logique.
- Pas de TURN/STUN ni de streaming adaptatif : chaque client charge le
  fichier vidéo intégralement depuis le serveur (ou l'URL fournie), ce qui
  convient bien à un usage interne sur réseau local.
- `node:sqlite` est expérimental côté Node.js. Pour un usage en production
  avec un volume important, `better-sqlite3` (même API quasi identique) ou
  une vraie base serveur (PostgreSQL) seraient les étapes suivantes
  naturelles — la couche `db.js` est isolée du reste du code précisément
  pour rendre ce remplacement simple.
- L'export vers l'autre équipe retente une fois en cas d'échec, puis
  abandonne (les données restent récupérables via `GET /api/analytics/:code`
  ou `POST /api/analytics/:code/resend`). Pas de file d'attente persistante :
  si le serveur redémarre entre les deux tentatives, le retry est perdu (la
  donnée, elle, ne l'est pas).
- `event_logs` n'est pas purgée automatiquement : pour un usage prolongé,
  prévoir une politique de rétention (ex. suppression après export confirmé,
  ou après N jours).
- Les payloads envoyés à l'autre équipe contiennent les noms saisis par les
  participants tels quels (pas d'anonymisation). À évaluer selon ce que
  l'autre équipe doit réellement analyser.
