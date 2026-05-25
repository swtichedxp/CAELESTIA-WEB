# Caelestia Frontend — Web Pairer

Static frontend for the Caelestia WhatsApp pairing panel.  
Deploy to **Cloudflare Pages** (or any static host).

---

## Cloudflare Pages Setup

1. Push this folder to a GitHub/GitLab repo
2. Connect the repo to Cloudflare Pages
3. Set build command: *(none — it's pure static)*
4. Set output directory: `/` (root)
5. Deploy!

---

## Configure Servers

Edit `servers.json` to add your bot backend servers:

```json
{
  "servers": [
    {
      "id": "s1",
      "name": "Server 1",
      "url": "http://1.prexzyvilla.site:2040",
      "tier": "high",
      "maxUsers": 20,
      "label": "Alpha"
    }
  ]
}
```

### Tier Capacity Logic
| Tier | Max Users |
|---|---|
| `high` | 20 |
| `mid`  | 16 |
| `low`  | 5  |

The frontend automatically selects the best available server  
(highest tier with most free slots). Users can also manually pick.

---

## Admin Panel

Click **Admin** in the navbar.  
Password: **`zedxandromeda`** (stored in localStorage for auto-login).

### Admin Tabs
| Tab | Description |
|---|---|
| **Servers** | Add/remove backend URLs, view live capacity/tier stats |
| **Announcements** | Post server announcements shown on user panel |
| **Changelogs** | Post version changelogs |
| **Polls** | Create polls with vote counting |
| **Channels** | Manage the channel gate links users must follow |

Admin data is stored on the selected bot backend server.

---

## Architecture

```
Cloudflare Pages (this repo)
    │
    ├── servers.json     — list of bot backend URLs
    ├── index.html       — full UI
    ├── style.css        — Vanish UI dark theme (lime-green accent)
    └── app.js           — all frontend + admin logic
         │
         └──► HTTP/SSE ──► Bot Backend(s)
                            e.g. http://1.prexzyvilla.site:2040/api/...
```

---

## Credits
Dev: **ҲЄƝ** | Bot: **Caelestia**  
Lord broken, Ddex-tech, Nuell | 𝐇𝐄𝐗-𝐀𝐆⎋𝐍ᵀᴹ━⎋, Charmaine, 501-takeoff
