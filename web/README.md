# llamacpp-cli Web UI

A React-based admin web interface for managing llama.cpp servers through the Admin REST API.

## Overview

The Web UI provides a clean, modern interface for managing your llama.cpp servers remotely. It's inspired by the Llama website design and built with:

- **React 19** - Modern React with concurrent features
- **Vite 7** - Fast build tooling and dev server
- **TypeScript 5.9** - Type-safe development
- **Tailwind CSS 4** - Utility-first styling with dark mode support
- **React Query** - Server state management with auto-refetch
- **React Router** - Client-side routing for SPA
- **Lucide React** - Beautiful icon library

## Architecture

### File Structure

```
web/
├── src/
│   ├── components/
│   │   └── Nav.tsx                 # Navigation component with gradient logo
│   ├── pages/
│   │   ├── Dashboard.tsx          # System overview and stats
│   │   ├── Servers.tsx            # Server management (CRUD operations)
│   │   └── Models.tsx             # Model management
│   ├── hooks/
│   │   └── useApi.ts              # React Query hooks for all API operations
│   ├── lib/
│   │   └── api.ts                 # API client class with methods for all endpoints
│   ├── types/
│   │   └── api.ts                 # TypeScript types mirroring backend API
│   ├── App.tsx                    # Root component with routing
│   ├── main.tsx                   # Entry point with React Query provider
│   └── index.css                  # Global styles with dark theme
├── vite.config.ts                 # Vite configuration with API proxy
├── tailwind.config.js             # Tailwind CSS configuration
├── postcss.config.js              # PostCSS with Tailwind and Autoprefixer
├── package.json                   # Dependencies and scripts
└── README.md                      # This file
```

### API Client

The API client (`src/lib/api.ts`) provides a full-featured client for the Admin API:

```typescript
class ApiClient {
  // Server operations
  async listServers(): Promise<{ servers: Server[] }>
  async getServer(id: string): Promise<Server>
  async createServer(data: CreateServerRequest): Promise<Server>
  async updateServer(id: string, data: UpdateServerRequest): Promise<Server>
  async deleteServer(id: string): Promise<void>
  async startServer(id: string): Promise<Server>
  async stopServer(id: string): Promise<Server>
  async restartServer(id: string): Promise<Server>

  // Model operations
  async listModels(): Promise<{ models: Model[] }>
  async getModel(name: string): Promise<Model>
  async deleteModel(name: string, cascade?: boolean): Promise<void>

  // System operations
  async getHealth(): Promise<{ status: string }>
  async getSystemStatus(): Promise<SystemStatus>
}
```

**Authentication:**
- API key stored in localStorage as `llama_admin_api_key`
- Sent as `Bearer` token in Authorization header
- Set via UI prompt on first load

### React Query Integration

All API operations are wrapped in React Query hooks (`src/hooks/useApi.ts`) for:

- **Auto-refetch:** Servers/status every 5s, models every 10s
- **Cache invalidation:** Mutations automatically invalidate relevant queries
- **Loading states:** Built-in loading/error states for all operations
- **Optimistic updates:** UI updates immediately on mutations

Example usage:

```typescript
function Servers() {
  const { data, isLoading } = useServers();
  const startServer = useStartServer();

  const handleStart = async (id: string) => {
    await startServer.mutateAsync(id);
    // Query automatically refetches servers list
  };
}
```

### Pages

#### Dashboard (`/dashboard`)

**Features:**
- 4 stat cards: Total Servers, Running, Stopped, Models
- Running servers list with details (port, threads, context)
- Auto-refresh every 5 seconds
- Clean gradient design

#### Servers (`/servers`)

**Features:**
- Table of all servers with status badges
- Per-server actions: Start/Stop/Restart/Delete
- Configuration display: threads, context size, GPU layers
- PID and uptime for running servers
- Confirmation dialogs for destructive actions
- Loading states for async operations

#### Models (`/models`)

**Features:**
- Table of all models with size and modified date
- Shows server usage count per model
- Delete with cascade option (also deletes associated servers)
- Formatted file sizes and dates
- Protection against deleting models in use

## Development

### Prerequisites

- Node.js 18+ (24.3.0 recommended)
- npm 9+ (11.4.2 recommended)
- Running Admin API server on `localhost:9200`

### Installation

```bash
cd web
npm install
```

### Development Server

```bash
npm run dev
```

This starts Vite dev server on `http://localhost:5173` with:
- Hot Module Replacement (HMR)
- API proxy to `localhost:9200` for `/api` and `/health`
- Fast refresh for instant updates

### Vite Proxy Configuration

The dev server proxies API requests to avoid CORS issues:

```typescript
// vite.config.ts
server: {
  proxy: {
    '/api': {
      target: 'http://localhost:9200',
      changeOrigin: true,
    },
    '/health': {
      target: 'http://localhost:9200',
      changeOrigin: true,
    },
  },
}
```

## Production Build

### Build Static Assets

```bash
npm run build
```

Output: `web/dist/` directory with:
- `index.html` - Entry point
- `assets/*.js` - Bundled JavaScript (code-split)
- `assets/*.css` - Bundled CSS

### Serving Static Files

The Admin API server automatically serves static files from `web/dist/`:

1. **Build the web UI:**
   ```bash
   cd web
   npm install
   npm run build
   ```

2. **Start Admin API:**
   ```bash
   llamacpp admin start
   ```

3. **Access UI:**
   Open `http://localhost:9200` in your browser

**SPA Routing:**
- Non-API routes (`/dashboard`, `/servers`, `/models`) serve `index.html`
- API routes (`/api/*`) handled by REST API
- Static assets (`/assets/*`) served with long-term caching

**Error Handling:**
- If `web/dist` doesn't exist, returns helpful error:
  ```json
  {
    "error": "Not Found",
    "details": "Static files not built. Run: cd web && npm install && npm run build"
  }
  ```

## Environment Configuration

### API Endpoint

By default, the UI connects to the Admin API on the same host. To configure:

**Development:**
- Edit `vite.config.ts` proxy target

**Production:**
- API calls are relative (`/api/*`)
- Served from same origin as UI

### API Key

- Prompted on first load
- Stored in localStorage
- Can be cleared to re-prompt

## Styling

### Dark Theme

The UI uses a dark theme by default:

```css
:root {
  color-scheme: dark;
  background-color: #0a0a0a;
}
```

### Tailwind CSS

Utility-first styling with responsive design:

```tsx
<div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800">
  <h1 className="text-3xl font-semibold text-gray-900 dark:text-white">
    Title
  </h1>
</div>
```

### Component Patterns

- Consistent spacing: `px-6 py-8` for containers
- Borders: `border border-gray-200 dark:border-gray-800`
- Rounded corners: `rounded-lg` for cards
- Hover states: `hover:bg-gray-50 dark:hover:bg-gray-800/50`
- Status badges: Color-coded pills for server/model status

## API Integration

### Authentication

The UI handles API key authentication:

```typescript
// On mount, check localStorage for API key
useEffect(() => {
  let key = localStorage.getItem('llama_admin_api_key');
  if (!key) {
    key = prompt('Enter Admin API Key:');
    if (key) {
      localStorage.setItem('llama_admin_api_key', key);
    }
  }
  api.setApiKey(key);
}, []);
```

### Error Handling

All API calls handle errors gracefully:

```typescript
try {
  await startServer.mutateAsync(id);
} catch (error) {
  console.error('Failed to start server:', error);
  // React Query shows error state in UI
}
```

### Loading States

React Query provides loading states:

```typescript
const { data, isLoading, error } = useServers();

if (isLoading) {
  return <div>Loading...</div>;
}

if (error) {
  return <div>Error: {error.message}</div>;
}
```

## Testing

### Manual Testing Checklist

**Dashboard:**
- [ ] Stats display correctly
- [ ] Running servers list populates
- [ ] Auto-refresh updates data every 5s

**Servers:**
- [ ] Table shows all servers
- [ ] Start button works on stopped servers
- [ ] Stop button works on running servers
- [ ] Restart button works on running servers
- [ ] Delete shows confirmation dialog
- [ ] Status badges show correct colors
- [ ] PID and uptime display for running servers

**Models:**
- [ ] Table shows all models
- [ ] Sizes formatted correctly (GB/MB)
- [ ] Server usage count shows
- [ ] Delete asks for cascade confirmation
- [ ] Delete protected if servers use model

**Navigation:**
- [ ] Nav links work
- [ ] Active page highlighted
- [ ] Logo gradient displays

**Authentication:**
- [ ] API key prompt on first load
- [ ] API key persists in localStorage
- [ ] 401 errors handled

## Troubleshooting

### UI not loading

1. Check Admin API is running:
   ```bash
   llamacpp admin status
   ```

2. Check static files built:
   ```bash
   ls -la web/dist/
   ```

3. Rebuild if needed:
   ```bash
   cd web && npm run build
   ```

### API calls failing

1. Check API key is correct:
   ```bash
   llamacpp admin status  # Shows current API key
   ```

2. Clear localStorage and re-enter key:
   ```javascript
   localStorage.removeItem('llama_admin_api_key');
   ```

3. Check browser console for errors

### Development server not starting

1. Check port 5173 is available
2. Check node_modules installed:
   ```bash
   ls -la node_modules/
   ```
3. Try reinstalling:
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   ```

## Future Enhancements

Potential features for future versions:

- [ ] Server configuration editing from UI
- [ ] Model search and download from HuggingFace
- [ ] Real-time logs viewer (WebSocket)
- [ ] Performance graphs (CPU, memory, GPU over time)
- [ ] Dark/light theme toggle
- [ ] Server templates for quick creation
- [ ] Bulk operations (start/stop multiple servers)
- [ ] User preferences (polling interval, theme, etc.)

## Contributing

When adding new features:

1. Update types in `src/types/api.ts`
2. Add API methods to `src/lib/api.ts`
3. Add React Query hooks to `src/hooks/useApi.ts`
4. Create/update page components in `src/pages/`
5. Update this README

## License

Same license as llamacpp-cli project.
