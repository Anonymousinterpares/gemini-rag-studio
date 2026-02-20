import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'search-middleware',
      configureServer(server) {
        server.middlewares.use('/api/search', async (req, res, next) => {
          // Check if it's a GET request
          if (req.method !== 'GET') {
            next();
            return;
          }

          try {
            // Dynamically import cheerio for HTML parsing
            const { load } = await import('cheerio');

            // Manually parse query parameters
            const url = new URL(req.url || '', `http://${req.headers.host}`);
            const query = url.searchParams.get('q');
            
            if (!query) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Missing query parameter "q"' }));
              return;
            }

            console.log(`[Search Proxy] Searching for: ${query}`);
            
            // Use DuckDuckGo Lite - robust and free
            const searchUrl = 'https://lite.duckduckgo.com/lite/';
            const form = new URLSearchParams();
            form.append('q', query);

            const response = await fetch(searchUrl, {
              method: 'POST',
              body: form,
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Origin': 'https://lite.duckduckgo.com',
                'Referer': 'https://lite.duckduckgo.com/'
              }
            });

            if (!response.ok) {
              throw new Error(`DDG Lite responded with ${response.status}`);
            }

            const html = await response.text();
            const $ = load(html);
            const results: { title: string; link: string; snippet: string }[] = [];

            // Robust parsing: Find all result links, then get the associated snippet
            const links = $('a.result-link').toArray();

            for (const element of links) {
              const linkAnchor = $(element);
              const title = linkAnchor.text().trim();
              const link = linkAnchor.attr('href');
              
              // Navigate to the snippet: current a -> td -> tr -> next tr -> .result-snippet
              const linkRow = linkAnchor.closest('tr');
              const snippetRow = linkRow.next();
              const snippet = snippetRow.find('.result-snippet').text().trim();

              if (title && link) {
                results.push({ title, link, snippet });
              }
            }
            
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ results: results.slice(0, 5) })); // Return top 5 results
          } catch (error) {
            console.error('[Search Proxy] Error:', error);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Search failed', details: String(error) }));
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