# ⚡ Roblox Web Relay & Remote Chat Bridge

A real-time, two-way communication bridge and web dashboard hosted on **Vercel** (`*.vercel.app`) that connects directly with Roblox games and script executors.

---

## 🌟 Key Features

- **Two-Way Real-time Chat**:
  - Send messages from the Web dashboard directly into Roblox game chat.
  - Read in-game Roblox chat in real-time on the Web dashboard.
- **Remote Command Execution**:
  - Teleport (`/tp <player>` or `/tp x,y,z`), Adjust Speed (`/speed <val>`), High Jump (`/jump <val>`), Kill/Reset (`/kill`), Player List (`/players`).
- **Luau Remote Code Execution**:
  - Run arbitrary Luau scripts in Roblox directly from the web browser and view terminal return values live!
- **Roblox Client Telemetry**:
  - View connected player username, health bar, FPS, ping, PlaceId, and coordinates.
- **Universal Compatibility**:
  - Works on **ALL Roblox Script Executors** (Delta, Synapse, Krnl, Fluxus, Wave, Arceus X, Codex, Hydrogen, etc.)
  - Works in **Roblox Studio & Game Server Scripts** (via standard `HttpService`).
- **Zero Config Vercel Deployment**:
  - Deploys effortlessly to Vercel with serverless API functions.

---

## 🚀 How to Deploy to Vercel (Free in 2 Minutes)

### Method 1: Deploy with GitHub (Easiest)
1. Upload this folder (`message connect v1`) to a new repository on your [GitHub](https://github.com/).
2. Go to [Vercel](https://vercel.com/) and sign in with GitHub.
3. Click **"Add New..."** -> **"Project"** and select your repository.
4. Click **"Deploy"** (Keep all settings default).
5. Vercel will give you a live URL like:
   ```
   https://your-project-name.vercel.app
   ```

### Method 2: Deploy using Vercel CLI
If you have Vercel CLI installed:
```bash
vercel --prod
```

---

## 🎮 How to Connect Roblox

1. Open `roblox_script.lua`.
2. Update the `SERVER_URL` line at the top with your Vercel link:
   ```lua
   SERVER_URL = "https://your-project-name.vercel.app"
   ```
3. Copy the script and execute it in your Roblox executor (or paste into a LocalScript in Roblox Studio).
4. You will see:
   ```
   🚀 [Roblox Relay] Connected to Bridge!
   ```
5. Open your Vercel website in any browser (or on your phone!). You will see your player appear under **Connected Clients** with live health and status!

---

## 💬 Command Cheat Sheet

You can type these into the Web chat box or click the quick command chips on the dashboard:

| Command | Action | Example |
| :--- | :--- | :--- |
| `/say <message>` | Makes your Roblox player speak in game chat | `/say Hello from the web!` |
| `/speed <number>` | Changes player WalkSpeed | `/speed 80` |
| `/jump <number>` | Changes player JumpPower | `/jump 120` |
| `/tp <coordinates>` | Teleports to X, Y, Z | `/tp 0, 50, 0` |
| `/tp <player>` | Teleports to a player in server | `/tp Builderman` |
| `/kill` | Resets/kills your character | `/kill` |
| `/players` | Lists all players currently in the server | `/players` |
| `/pos` | Returns current coordinates (X, Y, Z) | `/pos` |
| `/eval <luau code>` | Executes Luau code in Roblox and prints return value | `/eval return game.PlaceId` |

---

## 📡 REST API Reference

The serverless backend provides standard HTTP endpoints:

### 1. `GET /api/messages?since=<timestamp>&limit=50`
Fetches chat messages. Use `since` to only receive new messages.

### 2. `POST /api/messages`
Sends a message into the chat.
```json
{
  "sender": "web",
  "author": "Web Operator",
  "text": "Hello world!",
  "type": "chat"
}
```

### 3. `GET /api/commands?client=<username>`
Roblox client polls for pending commands.

### 4. `POST /api/commands`
Queues a remote command to be executed in Roblox.
```json
{
  "command": "speed",
  "args": "100"
}
```

### 5. `POST /api/commands/respond`
Roblox reports the execution output back to the web console.

### 6. `POST /api/heartbeat`
Roblox pings active stats (health, position, ping, fps).

### 7. `GET /api/clients`
Returns all active Roblox sessions.

### 8. `POST /api/clear`
Clears chat history.

---

## 🛡️ Optional Password / Secret Key

To protect your relay from unauthorized users:
1. In Vercel Project Settings -> **Environment Variables**, add:
   - Key: `SECRET_KEY`
   - Value: `your_secret_password`
2. In `roblox_script.lua`, set:
   ```lua
   SECRET_KEY = "your_secret_password"
   ```
3. On the Web dashboard, click the ⚙️ **Settings** button and enter your password.
