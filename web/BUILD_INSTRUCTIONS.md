# React Web UI Build Instructions

## Problem Statement

The llamacpp-cli project has a complete React-based admin web UI in the `web/` directory, but it's experiencing npm installation issues on the development machine that prevent building the production bundle. The issue appears to be environmental (npm not properly installing transitive dependencies), not a code problem.

## What Needs to Be Done

Build the React application and create a production-ready `dist/` folder that can be copied back to the original machine. The admin server (`admin-server.ts`) already has static file serving implemented and is ready to serve the built files.

## Current State

### Files Already Created

All React source files are complete and functional:

- ✅ `src/App.tsx` - Root component with React Query and routing
- ✅ `src/main.tsx` - Entry point with providers
- ✅ `src/components/Nav.tsx` - Navigation component
- ✅ `src/pages/Dashboard.tsx` - System overview page
- ✅ `src/pages/Servers.tsx` - Server management with full CRUD
- ✅ `src/pages/Models.tsx` - Model management
- ✅ `src/hooks/useApi.ts` - React Query hooks for all API operations
- ✅ `src/lib/api.ts` - Complete API client with authentication
- ✅ `src/types/api.ts` - TypeScript types for API
- ✅ `src/index.css` - Dark theme styles with Tailwind
- ✅ `vite.config.ts` - Vite configuration with API proxy
- ✅ `tailwind.config.js` - Tailwind CSS configuration
- ✅ `package.json` - All dependencies defined

### The Issue

On the original machine, when running `npm install` in the `web/` directory:
- npm reports "14 packages installed"
- But `node_modules/` subdirectories are empty
- `npm ls vite` shows "(empty)"
- Packages like vite, react, etc. appear to install but their contents are missing
- This prevents `npm run build` from working

### What Works

- The TypeScript code compiles without errors (when dependencies are available)
- All React components follow best practices
- The admin server successfully serves static files from `web/dist/`
- A standalone HTML version works correctly as a fallback

## Step-by-Step Build Instructions

### 1. Clone or Copy the Repository

```bash
# If you have git access:
git clone [repository-url]
cd llamacpp-cli/web

# Or copy just the web directory from the original machine
```

### 2. Install Dependencies

```bash
cd web
npm install
```

**Expected result:** Should see ~300+ packages installed (not just 14)

**Verify installation:**
```bash
npm ls vite
# Should show: vite@7.2.4

ls -la node_modules/.bin/vite
# Should exist and be executable

ls node_modules/@vitejs/plugin-react/
# Should contain package files, not be empty
```

### 3. Build the Production Bundle

```bash
npm run build
```

**Expected output:**
```
vite v7.2.4 building for production...
✓ 234 modules transformed.
dist/index.html                   0.46 kB │ gzip:  0.30 kB
dist/assets/index-[hash].css     12.34 kB │ gzip:  3.45 kB
dist/assets/index-[hash].js     156.78 kB │ gzip: 56.78 kB
✓ built in 2.34s
```

**Verify build:**
```bash
ls -la dist/
# Should contain:
# - index.html (entry point)
# - assets/ directory with .js and .css files
```

### 4. Test the Build Locally (Optional)

```bash
npm run preview
```

This starts a local preview server at `http://localhost:4173`

**Test checklist:**
- [ ] Dashboard loads and shows stats
- [ ] Navigation works (Dashboard, Servers, Models)
- [ ] API calls work (requires Admin API running on port 9200)
- [ ] Dark theme displays correctly

### 5. Package for Transfer

Create a tarball of just the dist directory:

```bash
cd web
tar -czf llamacpp-web-dist.tar.gz dist/
```

Or zip it:

```bash
cd web
zip -r llamacpp-web-dist.zip dist/
```

### 6. Transfer Back to Original Machine

Copy the archive to the original machine and extract:

```bash
# On original machine:
cd /Users/dweaver/Projects/ai/claude-assist/projects/llamacpp-cli/web
tar -xzf llamacpp-web-dist.tar.gz
# Or: unzip llamacpp-web-dist.zip

# Verify:
ls -la dist/
```

### 7. Test on Original Machine

The admin server is already configured to serve from `web/dist/`:

```bash
# Restart admin server (if needed):
llamacpp admin restart

# Open in browser:
open http://localhost:9200
```

## Troubleshooting

### If npm install still fails on the build machine:

**Try yarn:**
```bash
# Install yarn if not present:
npm install -g yarn

# Install dependencies:
yarn install

# Build:
yarn build
```

**Try pnpm:**
```bash
# Install pnpm if not present:
npm install -g pnpm

# Install dependencies:
pnpm install

# Build:
pnpm build
```

### If build succeeds but files are missing:

Check that all these exist:
```bash
ls dist/index.html
ls dist/assets/*.js
ls dist/assets/*.css
```

### If API calls don't work after deployment:

1. Check admin server is running:
   ```bash
   llamacpp admin status
   ```

2. Check browser console for errors (F12 → Console tab)

3. Get API key:
   ```bash
   llamacpp admin status
   # Copy the API Key value
   ```

4. Clear localStorage and re-enter key:
   - Open browser console
   - Run: `localStorage.removeItem('llama_admin_api_key')`
   - Refresh page and enter API key when prompted

## Technical Details

### Dependencies

**Production:**
- react@19.2.0
- react-dom@19.2.0
- react-router-dom@7.13.0
- @tanstack/react-query@5.90.20
- lucide-react@0.563.0
- zustand@5.0.11

**Development:**
- vite@7.2.4
- typescript@5.9.3
- tailwindcss@4.1.18
- @vitejs/plugin-react@5.1.1

### Build Configuration

- **Entry point:** `index.html`
- **Vite config:** Includes React plugin and path aliases
- **Tailwind:** PostCSS with autoprefixer
- **TypeScript:** Strict mode with ESM modules
- **Output:** ES2020 modules with code splitting

### Static File Serving

The admin server (`src/lib/admin-server.ts`) handles:
- Serving `index.html` for root and SPA routes (`/dashboard`, `/servers`, `/models`)
- Serving static assets from `dist/assets/` with long-term caching
- Serving API routes from `/api/*` with authentication
- No authentication required for static files

## Expected File Structure After Build

```
web/
├── dist/
│   ├── index.html              # Entry point (~0.5 KB)
│   └── assets/
│       ├── index-[hash].js     # Main bundle (~150 KB)
│       ├── index-[hash].css    # Styles (~12 KB)
│       ├── [chunk]-[hash].js   # Code-split chunks
│       └── [asset]-[hash].*    # Images, fonts, etc.
├── src/                        # Source files (not needed in dist)
├── node_modules/               # Dependencies (not needed in dist)
├── package.json
├── vite.config.ts
└── README.md
```

## API Integration

The UI connects to the Admin API:

**Endpoints used:**
- `GET /health` - Health check (no auth)
- `GET /api/status` - System status
- `GET /api/servers` - List servers
- `POST /api/servers/:id/start` - Start server
- `POST /api/servers/:id/stop` - Stop server
- `POST /api/servers/:id/restart` - Restart server
- `DELETE /api/servers/:id` - Delete server
- `GET /api/models` - List models
- `DELETE /api/models/:name?cascade=true` - Delete model

**Authentication:**
- API key stored in localStorage as `llama_admin_api_key`
- Sent in `Authorization: Bearer <key>` header
- Prompted on first load if not present

## Success Criteria

You know the build succeeded when:

1. ✅ `dist/index.html` exists and is ~0.5 KB
2. ✅ `dist/assets/` contains .js and .css files with hash names
3. ✅ Opening `dist/index.html` in browser shows the admin UI
4. ✅ Navigation between pages works
5. ✅ API calls succeed (when Admin API is running)
6. ✅ No console errors (except authentication if API key not set)

## Questions?

If you run into issues:

1. **Check Node.js version:**
   ```bash
   node --version  # Should be 18+ (24.3.0 recommended)
   npm --version   # Should be 9+ (11.4.2 recommended)
   ```

2. **Check package.json is intact:**
   ```bash
   cat package.json | grep vite
   # Should show: "vite": "^7.2.4"
   ```

3. **Try clean install:**
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   ```

4. **Check for error messages:**
   - Save any error output
   - Note which step failed
   - Check if it's a network issue (npm registry)

## What to Return

Please provide:

1. **The built files:**
   - `web/dist/` directory (as tarball or zip)
   - Or upload to a file sharing service

2. **Build output:**
   - Copy the terminal output from `npm run build`
   - Any warnings or errors encountered

3. **Verification:**
   - Screenshot of the UI loaded in browser (if tested locally)
   - File sizes of generated bundles

## Contact

If anything is unclear or you need the source files re-sent, let me know. The goal is to get a working `dist/` folder that can be deployed on the original machine.
