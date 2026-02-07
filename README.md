# NiteVelour (Cloudflare Pages Direct Upload)

This project is designed for **Wrangler Direct Upload**. You build `dist/` locally, then deploy with Wrangler.

## Critical requirement (why cards sometimes “don’t load”)

Your live grid uses **Pages Functions**:
- `/api/live`
- `/api/performer`

When you deploy, you must deploy from a folder that contains **both**:
- `dist/` (static output)
- `functions/` (Pages Functions)

If you run `wrangler pages deploy dist` from a different folder that only has `dist/`, your site becomes static-only and `/api/live` will 404.

## Quick start

### 1) Install dependencies (once)
```powershell
npm install
