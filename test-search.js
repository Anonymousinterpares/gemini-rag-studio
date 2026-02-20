import { search } from 'duck-duck-scrape';

try {
  console.log('Testing search import...');
  const results = await search('test query', { safeSearch: 0 });
  console.log('Search successful:', results.results.length > 0);
} catch (error) {
  console.error('Search failed:', error);
  process.exit(1);
}
