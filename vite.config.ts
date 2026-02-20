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
            
            // Randomized User Agents to avoid simple blocking
            const userAgents = [
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
              'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0'
            ];
            const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];

            let results: { title: string; link: string; snippet: string }[] = [];
            let errorDetails = '';

            try {
              // Try DDG Lite first
              const searchUrl = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
              const response = await fetch(searchUrl, {
                headers: {
                  'User-Agent': randomUA,
                  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                  'Accept-Language': 'en-US,en;q=0.5',
                }
              });

              if (response.ok) {
                const html = await response.text();
                const $ = load(html);
                
                $('a.result-link').each((i, el) => {
                  if (i >= 8) return false;
                  const $el = $(el);
                  const title = $el.text().trim();
                  const link = $el.attr('href');
                  const snippet = $el.closest('tr').next().find('.result-snippet').text().trim();
                  
                  if (title && link) {
                    const fullLink = link.startsWith('http') ? link : (link.startsWith('//') ? `https:${link}` : `https://duckduckgo.com${link}`);
                    results.push({ title, link: fullLink, snippet: snippet || 'No description available.' });
                  }
                });
              } else {
                errorDetails = `DDG Lite responded with ${response.status}`;
              }
            } catch (e) {
              errorDetails = String(e);
            }

            // Fallback to duck-duck-scrape if DDG Lite failed or returned no results
            if (results.length === 0) {
              console.log('[Search Proxy] DDG Lite failed or no results, trying duck-duck-scrape...');
              try {
                const { search } = await import('duck-duck-scrape');
                const ddsResults = await search(query, { safeSearch: 0 });
                if (ddsResults && ddsResults.results) {
                  results = ddsResults.results.slice(0, 8).map(r => ({
                    title: r.title,
                    link: r.url,
                    snippet: r.description
                  }));
                }
              } catch (e) {
                console.error('[Search Proxy] Fallback failed:', e);
                errorDetails += ` | Fallback error: ${String(e)}`;
              }
            }

            if (results.length === 0 && errorDetails) {
              throw new Error(`Search failed: ${errorDetails}`);
            }

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