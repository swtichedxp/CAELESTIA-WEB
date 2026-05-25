# Caelestia Frontend — Web Pairer

Static frontend for the Caelestia WhatsApp pairing panel.
Deploy to **Cloudflare Workers** (or any static host).

## Deploy with Wrangler

```bash
npx wrangler deploy
```

The included `wrangler.jsonc` configures SPA routing automatically.
No build step needed — it's pure HTML/CSS/JS.

## Configure Servers

Edit `servers.json` to point at your bot backends:

```json
{ "id": "s1", "name": "Server 1", "url": "http://your-vps:3000", "tier": "high", "maxUsers": 20 }
```

Tiers: `high` (20 users) · `mid` (16) · `low` (5)

## Admin Panel

Click **Admin** in the navbar. Password: **`zedxandromeda`**

Tabs: Servers · Announcements · Changelogs · Polls · Channels

## Credits
Dev: **ҲЄƝ** | Lord broken, Ddex-tech, Nuell | 𝐇𝐄𝐗-𝐀𝐆⎋𝐍ᵀᴹ━⎋, Charmaine, 501-takeoff
