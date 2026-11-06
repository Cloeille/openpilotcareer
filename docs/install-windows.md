# Install the bridge on Windows / Installer le pont sur Windows

- [English](#english)
- [Français](#français)

---

## English

The bridge (`opc-bridge-win-x64.exe`) is a single file for Windows 10/11 (64-bit). You do not need to install Node.js. It reads your
aircraft from Microsoft Flight Simulator 2020 or 2024 and reports the flight to your OpenPilotCareer server.

> **Status:** the exe is built on Linux by `npm run build:win -w @opc/bridge`. It has **not been run on Windows or against a real MSFS
> yet**. The logic behind it is tested on sample streams and against a stub server; the SimConnect link to the sim is untested.
> If something fails, run it from a terminal (below) and send the message it prints.

### 1. Download

Get `opc-bridge-win-x64.exe` from your server: `https://YOUR-SERVER/downloads/opc-bridge-win-x64.exe` (the onboarding step
"Simulator bridge" links to it). Put it in a folder you keep, for example `C:\OpenPilotCareer\`. Do not leave it in Downloads.

If the server says 404, its owner has not published the file (`OPC_DOWNLOADS`, see the README).

### 2. SmartScreen warning ("Windows protected your PC")

The exe is **not code-signed**: signing needs a paid certificate. Windows SmartScreen therefore warns about any unsigned program it
has not seen often. This does not mean the file is infected.

1. Click **More info**.
2. Click **Run anyway**.

You only do this once per file. If your browser also blocks the download, choose **Keep**. To check the file is the one the server
published, compare `Get-FileHash .\opc-bridge-win-x64.exe -Algorithm SHA256` with the hash given by whoever runs the server.
Antivirus tools sometimes flag packed Node programs: if yours quarantines it, add the folder to its exclusions.

### 3. First run: `setup`

You need your server URL and an API key (web app → Settings → API keys; the onboarding creates one for you).

Open a terminal in the folder (File Explorer → click the address bar, type `cmd`, Enter), then:

```
opc-bridge-win-x64.exe setup
```

It asks for the server URL (for example `https://opc.example.org`) and the key (typing is hidden), checks them against the server
and saves them in `%APPDATA%\OpenPilotCareer\config.json`. You can also pass them: `setup --server URL --key KEY`.

Double-clicking the exe before any setup does the same thing: it asks the two questions in its window.

### 4. Fly

1. Start MSFS and wait for the main menu (the bridge waits for the sim and reconnects by itself, but SimConnect only exists while MSFS runs).
2. In the web app, accept a job.
3. Start the bridge:
   - **Double-click the exe**, or run it with no argument: it follows your only active flight, or the one you accepted last when you
     have several. With no active flight it prints `waiting for a job accepted in the web app` and checks every 15 s.
   - Or choose the flight yourself: `opc-bridge-win-x64.exe flights` lists them, then `opc-bridge-win-x64.exe fly 42`.
4. Fly. When you park, the bridge sends the report and prints the verdict (verified or rejected, with the reason). Ctrl+C quits.

Leave the window open while you fly. If a report cannot be delivered (server down), it is kept and sent at the next start.

### Windows Firewall prompt

On first start Windows Defender Firewall may ask whether to allow the program on networks. The bridge only listens on
`127.0.0.1:7878` (your own PC, for the in-sim panel) and connects out to your server. **Cancel / "Private networks" only is fine**:
no inbound access from other machines is needed. Allowing it for public networks is not required.

### Start it with MSFS (optional)

MSFS can launch add-ons through `EXE.xml`. Put this file at `%APPDATA%\Microsoft Flight Simulator\EXE.xml` (Steam / standalone) or
`%LOCALAPPDATA%\Packages\Microsoft.FlightSimulator_8wekyb3d8bbwe\LocalCache\EXE.xml` (Microsoft Store), adding the `Launch.Addon`
block to the file if it already exists, with your real path:

```xml
<?xml version="1.0" encoding="Windows-1252"?>
<SimBase.Document Type="Launch" version="1,0">
  <Descr>Launch</Descr>
  <Filename>EXE.xml</Filename>
  <Disabled>False</Disabled>
  <Launch.ManualLoad>False</Launch.ManualLoad>
  <Launch.Addon>
    <Name>OpenPilotCareer bridge</Name>
    <Disabled>False</Disabled>
    <Path>C:\OpenPilotCareer\opc-bridge-win-x64.exe</Path>
    <NewConsole>True</NewConsole>
  </Launch.Addon>
</SimBase.Document>
```

Run `setup` once by hand first. MSFS then starts the bridge in its own window; with no argument it picks your flight by itself. (Not tested.)

### In-sim panel

Copy the `openpilotcareer-panel` folder into your Community folder (see [sim/msfs-package/README.md](../sim/msfs-package/README.md)).
It shows what the bridge reports, read from `http://127.0.0.1:7878/status`.

### Troubleshooting

| Message | Meaning |
| --- | --- |
| `not set up yet` | Run `setup` first. |
| `bad key` / `unauthorized` | The key was revoked or mistyped: create a new one and run `setup` again. |
| `cannot reach https://…` | Wrong URL, or no network. Check the address in a browser. |
| `waiting for the simulator` | MSFS is not running (or SimConnect is not reachable). Start the sim. |
| `port 7878 is in use` | Another bridge is already running (close its window). |
| `flight N is not among your active flights` | Accept the job in the web app first. |

`OPC_DEBUG=1` (set in the terminal with `set OPC_DEBUG=1`) prints stack traces. To remove everything: delete the exe and
`%APPDATA%\OpenPilotCareer`.

### Build it yourself

```
npm ci
npm run build:win -w @opc/bridge       # -> sim/bridge/dist/opc-bridge-win-x64.exe
```

The script bundles the TypeScript with esbuild, downloads the official `node.exe` of the running Node version, checks it against
nodejs.org's `SHASUMS256.txt`, and injects the bundle with Node's single-executable-application support (`node --build-sea`).
Serve the result with `OPC_DOWNLOADS=/path/to/dir` (the server exposes only `opc-bridge-win-x64.exe` and `openpilotcareer-panel.zip`).

---

## Français

Le pont (`opc-bridge-win-x64.exe`) est un fichier unique pour Windows 10/11 (64 bits). Pas besoin d'installer Node.js. Il lit ton
avion dans Microsoft Flight Simulator 2020 ou 2024 et envoie le vol à ton serveur OpenPilotCareer.

> **État :** l'exe est construit sous Linux par `npm run build:win -w @opc/bridge`. Il n'a **pas encore été lancé sous Windows ni
> avec un vrai MSFS**. La logique est testée sur des flux d'exemple et face à un faux serveur ; la liaison SimConnect avec le sim
> n'est pas testée. Si quelque chose échoue, lance-le depuis un terminal (ci-dessous) et envoie le message affiché.

### 1. Télécharger

Récupère `opc-bridge-win-x64.exe` sur ton serveur : `https://TON-SERVEUR/downloads/opc-bridge-win-x64.exe` (l'étape « Pont
simulateur » de l'onboarding y renvoie). Mets-le dans un dossier que tu gardes, par exemple `C:\OpenPilotCareer\`, pas dans Téléchargements.

Si le serveur répond 404, son propriétaire n'a pas publié le fichier (`OPC_DOWNLOADS`, voir le README).

### 2. Avertissement SmartScreen (« Windows a protégé votre ordinateur »)

L'exe **n'est pas signé** : une signature de code demande un certificat payant. SmartScreen prévient donc pour tout programme non
signé qu'il connaît peu. Cela ne veut pas dire que le fichier est infecté.

1. Clique sur **Informations complémentaires**.
2. Clique sur **Exécuter quand même**.

À faire une seule fois par fichier. Si ton navigateur bloque aussi le téléchargement, choisis **Conserver**. Pour vérifier que le
fichier est celui publié par le serveur, compare `Get-FileHash .\opc-bridge-win-x64.exe -Algorithm SHA256` avec l'empreinte donnée
par la personne qui gère le serveur. Un antivirus peut signaler un programme Node empaqueté : s'il le met en quarantaine, ajoute le
dossier à ses exclusions.

### 3. Premier lancement : `setup`

Il te faut l'adresse du serveur et une clé API (appli web → Réglages → Clés API ; l'onboarding en crée une pour toi).

Ouvre un terminal dans le dossier (Explorateur → clique dans la barre d'adresse, tape `cmd`, Entrée), puis :

```
opc-bridge-win-x64.exe setup
```

Il demande l'adresse du serveur (par exemple `https://opc.example.org`) et la clé (la saisie est masquée), les vérifie auprès du
serveur et les enregistre dans `%APPDATA%\OpenPilotCareer\config.json`. On peut aussi les passer : `setup --server URL --key CLÉ`.

Un double-clic sur l'exe avant tout `setup` fait la même chose : il pose les deux questions dans sa fenêtre.

### 4. Voler

1. Lance MSFS et attends le menu principal (le pont attend le sim et se reconnecte seul, mais SimConnect n'existe que pendant que MSFS tourne).
2. Dans l'appli web, accepte un job.
3. Lance le pont :
   - **Double-clic sur l'exe**, ou lancement sans argument : il suit ton seul vol actif, ou le dernier accepté si tu en as plusieurs.
     Sans vol actif il affiche `waiting for a job accepted in the web app` et revérifie toutes les 15 s.
   - Ou choisis le vol toi-même : `opc-bridge-win-x64.exe flights` les liste, puis `opc-bridge-win-x64.exe fly 42`.
4. Vole. Une fois garé, le pont envoie le rapport et affiche le verdict (vérifié ou refusé, avec la raison). Ctrl+C pour quitter.

Garde la fenêtre ouverte pendant le vol. Si un rapport ne peut pas être livré (serveur hors ligne), il est conservé et renvoyé au prochain démarrage.

### Fenêtre du pare-feu Windows

Au premier démarrage, le Pare-feu Windows Defender peut demander d'autoriser le programme sur les réseaux. Le pont n'écoute que sur
`127.0.0.1:7878` (ton propre PC, pour le panneau en jeu) et se connecte vers ton serveur. **Annuler, ou « Réseaux privés » seulement,
suffit** : aucun accès entrant depuis d'autres machines n'est nécessaire. Inutile d'autoriser les réseaux publics.

### Le lancer avec MSFS (facultatif)

MSFS peut lancer des add-ons via `EXE.xml`. Place ce fichier dans `%APPDATA%\Microsoft Flight Simulator\EXE.xml` (Steam / autonome) ou
`%LOCALAPPDATA%\Packages\Microsoft.FlightSimulator_8wekyb3d8bbwe\LocalCache\EXE.xml` (Microsoft Store), en ajoutant le bloc
`Launch.Addon` si le fichier existe déjà, avec ton vrai chemin :

```xml
<?xml version="1.0" encoding="Windows-1252"?>
<SimBase.Document Type="Launch" version="1,0">
  <Descr>Launch</Descr>
  <Filename>EXE.xml</Filename>
  <Disabled>False</Disabled>
  <Launch.ManualLoad>False</Launch.ManualLoad>
  <Launch.Addon>
    <Name>OpenPilotCareer bridge</Name>
    <Disabled>False</Disabled>
    <Path>C:\OpenPilotCareer\opc-bridge-win-x64.exe</Path>
    <NewConsole>True</NewConsole>
  </Launch.Addon>
</SimBase.Document>
```

Lance d'abord `setup` à la main. MSFS démarre ensuite le pont dans sa propre fenêtre ; sans argument, il choisit ton vol seul. (Non testé.)

### Panneau en jeu

Copie le dossier `openpilotcareer-panel` dans ton dossier Community (voir [sim/msfs-package/README.md](../sim/msfs-package/README.md)).
Il affiche ce que dit le pont, lu sur `http://127.0.0.1:7878/status`.

### Dépannage

| Message | Sens |
| --- | --- |
| `not set up yet` | Lance d'abord `setup`. |
| `bad key` / `unauthorized` | Clé révoquée ou mal saisie : crées-en une nouvelle et relance `setup`. |
| `cannot reach https://…` | Mauvaise adresse, ou pas de réseau. Teste l'adresse dans un navigateur. |
| `waiting for the simulator` | MSFS ne tourne pas (ou SimConnect est injoignable). Lance le sim. |
| `port 7878 is in use` | Un autre pont tourne déjà (ferme sa fenêtre). |
| `flight N is not among your active flights` | Accepte d'abord le job dans l'appli web. |

`OPC_DEBUG=1` (dans le terminal : `set OPC_DEBUG=1`) affiche les traces d'erreur. Pour tout supprimer : l'exe et
`%APPDATA%\OpenPilotCareer`.

### Le construire soi-même

```
npm ci
npm run build:win -w @opc/bridge       # -> sim/bridge/dist/opc-bridge-win-x64.exe
```

Le script empaquette le TypeScript avec esbuild, télécharge le `node.exe` officiel de la version de Node en cours, le compare au
`SHASUMS256.txt` de nodejs.org, puis injecte le paquet via le support « single executable application » de Node (`node --build-sea`).
Publie le résultat avec `OPC_DOWNLOADS=/chemin/du/dossier` (le serveur n'expose que `opc-bridge-win-x64.exe` et `openpilotcareer-panel.zip`).
