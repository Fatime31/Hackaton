# Protocole d'échange — Watch Together

Ce document décrit le protocole temps réel (Socket.IO) échangé entre le client
React et le serveur de synchro. Il répond au critère du sujet *« un protocole
d'échange documenté (les événements et leur sens) »*.

## Principe général

Le **serveur est la seule horloge de référence**. Il conserve pour chaque
salle un état autoritaire :

```
{ videoUrl, isPlaying, position, rate, lastUpdate, presenterId }
```

`position` est la position vidéo (en secondes) telle qu'elle était au moment
`lastUpdate` (horodatage serveur). La position "actuelle" est donc toujours
**calculée**, jamais stockée telle quelle :

```
expectedPosition = isPlaying
  ? position + (Date.now() - lastUpdate) / 1000 * rate
  : position
```

Cette fonction (`expectedPosition`, voir `server/rooms.js`) est le cœur de
toute la synchronisation : c'est elle qui permet à un retardataire de
rattraper exactement le bon point, et au serveur d'évaluer la dérive de
chaque invité sans avoir besoin d'horloges synchronisées entre machines.

## Rôles et autorité

| Rôle | Peut émettre des commandes (play/pause/seek/vitesse) | Émet de la télémétrie |
|---|---|---|
| **Présentateur** | ✅ seul à pouvoir le faire | — |
| **Invité** | ❌ jamais, même si le serveur reçoit l'événement (rejeté si `socket.id !== room.presenterId`) | ✅ ping de position toutes les 2s |

C'est cette asymétrie stricte — **un seul émetteur de commandes par salle** —
qui supprime structurellement toute possibilité de boucle d'écho : un invité
ne peut jamais, ni par erreur ni par un bug client, faire bouger la lecture
des autres invités.

## Catalogue des événements

### Connexion / cycle de vie d'une salle

| Événement | Sens | Émetteur → Récepteur | Charge utile |
|---|---|---|---|
| `create-room` | Crée une salle, l'émetteur devient présentateur | Client → Serveur | `{ name, videoUrl, videoName }` |
| `join-room` | Rejoint une salle existante en tant qu'invité | Client → Serveur | `{ code, name }` |
| *(callback)* | Réponse immédiate à `create-room`/`join-room` : état complet de la salle | Serveur → Client | `{ ok, role, state }` — `state` = `ROOM_STATE` (voir plus bas) |
| `leave-room` | Quitte volontairement la salle | Client → Serveur | — |
| `disconnect` | Déconnexion (fermeture d'onglet, perte réseau…) — traité exactement comme `leave-room` | Client → Serveur | — |
| `room:closed` | La salle est fermée (le présentateur est parti) | Serveur → Tous | `{ reason }` |
| `participants:update` | Liste à jour des participants, avec statut de synchro | Serveur → Salle | `{ participants: [{ id, name, role, drift, status }] }` |

**ROOM_STATE** (renvoyé par le callback de `create-room`/`join-room`) :

```
{ code, videoUrl, videoName, isPlaying, position, rate,
  presenterId, participants[], chat[], createdAt }
```

C'est ce paquet qui permet à un **retardataire de se resynchroniser
instantanément** : `position` est déjà calculée par `expectedPosition()` au
moment de la requête, donc même si l'invité rejoint 10 minutes après le
début de la lecture, il reçoit la position exacte à appliquer — pas besoin
d'attendre le prochain tick.

### Pilotage par le présentateur

| Événement | Sens | Émetteur → Récepteur | Charge utile |
|---|---|---|---|
| `presenter:command` | Une action de lecture a eu lieu chez le présentateur | Client (présentateur) → Serveur | `{ type: 'play'\|'pause'\|'seek'\|'rate', position, rate? }` |
| `sync:command` | Cette action est répercutée à tous les invités | Serveur → Invités | `{ type, position, isPlaying, rate, seq, serverTime }` |

Le serveur **rejette silencieusement** tout `presenter:command` qui ne
vient pas du socket enregistré comme `presenterId` de la salle — défense
en profondeur en plus de l'asymétrie de rôle côté client.

Les invités n'ont, dans l'absolu, **aucun contrôle local** sur la lecture :
le lecteur vidéo affiché côté invité n'expose aucun bouton play/pause/seek
natif (`controls` n'est jamais activé pour `role === 'guest'`). C'est une
contrainte du client, pas un réglage qu'on pourrait activer/désactiver —
il n'existe donc aucun événement dans le protocole permettant de
"déverrouiller" un invité.

`seq` est un compteur monotone par salle, incrémenté à chaque commande
appliquée. Il permet à un client de détecter et ignorer un événement déjà
appliqué (rejeu après reconnexion) — idempotence simple sans avoir besoin
d'horloges synchronisées.

### Télémétrie et gestion de la dérive (côté invité uniquement)

| Événement | Sens | Émetteur → Récepteur | Charge utile |
|---|---|---|---|
| `guest:ping` | « Voici ma position locale actuelle » — **jamais une commande** | Client (invité) → Serveur | `{ position }` |
| `sync:ack` | Tout va bien, écart sous le seuil | Serveur → 1 invité (celui qui a pingué) | `{ driftMs }` |
| `sync:correction` | Écart au-delà d'un seuil : correction ciblée | Serveur → 1 invité (celui qui a pingué) | `{ mode: 'soft'\|'hard', position, isPlaying, rate, direction }` |

Le client envoie un `guest:ping` toutes les **2 secondes**
(`PING_INTERVAL_MS`). Le serveur compare la position reçue à
`expectedPosition()` et calcule l'écart signé :

```
drift = positionReçue − expectedPosition
```

| Écart absolu | Statut | Action |
|---|---|---|
| < 150ms (`SOFT_DRIFT_THRESHOLD`) | `synced` | Rien — tolérance naturelle de lecture |
| 150 – 300ms | `adjusting` | `sync:correction` en mode `soft` : le client nudge `playbackRate` (±3%) pendant 1,5s pour rattraper sans à-coup visible, puis revient au débit nominal |
| > 300ms (`HARD_DRIFT_THRESHOLD`) | `resyncing` | `sync:correction` en mode `hard` : saut direct (`video.currentTime = position`) |

**Important** : `sync:correction` n'est **jamais diffusé à la salle** —
il est émis uniquement vers le socket qui a envoyé le ping correspondant
(`socket.emit`, pas `io.to(room)`). C'est le deuxième verrou anti-écho :
même la correction d'un invité n'a aucun effet sur les autres.

### Chat & réactions (bonus)

| Événement | Sens | Émetteur → Récepteur | Charge utile |
|---|---|---|---|
| `chat:message` | Envoi d'un message | Client → Serveur → Salle entière | `{ text }` → `{ id, name, role, text, ts }` |
| `chat:system` | Message d'information (ex. arrivée d'un invité) | Serveur → Salle entière | `{ text }` |
| `chat:reaction` | Émoji de réaction | Client → Serveur → Salle entière | `{ emoji }` → `{ emoji, name }` |

Ces événements n'ont aucune incidence sur l'état de lecture : ils sont
purement informatifs et ne transitent jamais par la logique de
`applyPresenterCommand`.

## Pourquoi aucune boucle d'écho n'est possible

1. **Un seul émetteur de commandes.** Le client React n'attache les
   écouteurs `play`/`pause`/`seeked` (qui déclenchent `presenter:command`)
   que si `role === 'presenter'`. Un invité n'a tout simplement pas ce code
   dans son arbre de composants.
2. **Défense côté serveur.** Même si un client invité forgeait l'événement
   `presenter:command`, le serveur le rejette : `if (room.presenterId !==
   socket.id) return;`.
3. **La télémétrie ne redevient jamais une commande.** `guest:ping` ne fait
   que mettre à jour `participant.drift`/`participant.status` et,
   éventuellement, déclencher un `sync:correction` **ciblé** — jamais un
   `sync:command` diffusé à la salle.
4. **Idempotence.** Chaque commande porte un `seq` ; un client qui la
   reçoit deux fois (ex. après reconnexion) peut l'ignorer si elle est déjà
   appliquée.

## Retardataire (late joiner)

Quand un invité rejoint en cours de séance :

1. `join-room` → le serveur calcule `expectedPosition()` à l'instant T et
   le renvoie immédiatement dans le `ROOM_STATE` du callback.
2. Le client applique cet état dès que la vidéo a chargé ses métadonnées
   (`loadedmetadata`) : `currentTime = position`, `playbackRate = rate`,
   puis `play()` si `isPlaying`.
3. Le premier `guest:ping`, deux secondes plus tard, confirme (ou corrige)
   l'alignement — au cas où le chargement de la vidéo aurait pris du temps.

Aucune attente du prochain tick d'horloge n'est nécessaire : le rattrapage
est immédiat.

## Ce qui est persisté (et ce qui ne l'est pas)

Tous les événements ci-dessus circulent et sont appliqués via l'état **en
mémoire** décrit plus haut (`expectedPosition`, `room.position`, etc.) —
c'est ce qui garantit une latence quasi nulle.

En parallèle, certains événements déclenchent aussi une écriture dans
**SQLite** (`server/db.js`), à des fins d'historique, pas de synchro :
création/fermeture de salle, arrivée/départ d'un participant, messages de
chat et réactions. Chaque commande présentateur (`presenter:command`) et
chaque mesure de dérive (`guest:ping`) sont en plus journalisées dans la
table `event_logs`, avec position vidéo et horodatage — c'est ce flux
détaillé qui alimente l'export vers une équipe d'analyse externe (route
`GET /api/analytics/:code`, et webhook automatique à la fermeture d'une
salle si `ANALYTICS_WEBHOOK_URL` est configurée). Le détail de ce qui est
stocké et comment l'interroger est documenté dans le
[`README.md`](./README.md#base-de-données).
