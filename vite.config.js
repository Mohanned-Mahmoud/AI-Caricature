import { defineConfig, loadEnv } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

/**
 * Dev-only plugin: serves /api/caricature locally by running the very same
 * handler file that Vercel runs in production. Server env (GEMINI_API_KEY)
 * is loaded into process.env here and never reaches the client bundle
 * (only VITE_* variables are exposed to the browser).
 */
function localApi(env) {
  return {
    name: 'local-api',
    configureServer(server) {
      Object.assign(process.env, env);
      server.middlewares.use(async (req, res, next) => {
        const path = req.url.split('?')[0];
        if (!path.startsWith('/api/')) return next();
        const routeName = path.replace(/^\/api\//, '');
        const validRoutes = ['caricature', 'upload'];
        if (!validRoutes.includes(routeName)) return next();

        try {
          const chunks = [];
          for await (const c of req) chunks.push(c);
          const raw = Buffer.concat(chunks).toString('utf8');
          try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = undefined; }
          // Minimal Vercel-style response helpers
          res.status = (code) => { res.statusCode = code; return res; };
          res.json = (obj) => {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(obj));
          };
          const mod = await server.ssrLoadModule(`/api/${routeName}.js`);
          await mod.default(req, res);
        } catch (e) {
          console.error(`[local-api] ${routeName}:`, e);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'server_error' }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [basicSsl(), localApi(env)],
    server: {
      port: 5173,
      host: true,
      https: true
    }
  };
});

