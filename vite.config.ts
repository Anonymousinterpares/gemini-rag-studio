import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { load } from 'cheerio'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'search-middleware',
      configureServer(server) {
        server.middlewares.use('/api/search', async (req, res, next) => {
          if (req.method !== 'GET') {
            next();
            return;
          }

          try {
            const url = new URL(req.url || '', `http://${req.headers.host}`);
            const query = url.searchParams.get('q');
            
            if (!query) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Missing query parameter "q"' }));
              return;
            }

            console.log(`[Search Proxy] Searching for: ${query}`);
            
            // Try DDG Lite with GET - usually more reliable than POST for basic searches
            const searchUrl = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
            
            const response = await fetch(searchUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
              }
            });

            if (!response.ok) {
              throw new Error(`DDG Lite responded with ${response.status} ${response.statusText}`);
            }

            const html = await response.text();
            const $ = load(html);
            const results: { title: string; link: string; snippet: string }[] = [];

            // DuckDuckGo Lite structure:
            // Results are in tables. Each result usually has:
            // 1. A link with class 'result-link'
            // 2. A snippet in a div with class 'result-snippet'
            
            $('a.result-link').each((i, el) => {
              if (i >= 8) return false; // Limit to 8 results
              
              const $el = $(el);
              const title = $el.text().trim();
              const link = $el.attr('href');
              
              // Find the snippet - it's usually in the next row or a nearby div
              const snippet = $el.closest('tr').next().find('.result-snippet').text().trim();
              
              if (title && link) {
                // Handle relative links if any
                const fullLink = link.startsWith('http') ? link : `https:${link}`;
                results.push({ title, link: fullLink, snippet: snippet || 'No description available.' });
              }
            });

            console.log(`[Search Proxy] Found ${results.length} results`);
            
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ results }));
          } catch (error) {
            console.error('[Search Proxy] Error:', error);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ 
              error: 'Search failed', 
              details: error instanceof Error ? error.message : String(error)
            }));
          }
        });
      },
    },
  ],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
})