Gemini RAG Studio — Comprehensive Fix Plan
Issues are ordered most critical → least critical and grouped by effort. Each phase is self-contained — fixes within a phase do not depend on other phases.

Phase 1 — Critical Logic Bugs (1–3 file touches each, very high ROI)
Estimated effort: ~1–2 hours total. Every fix here is surgical — one function or a few lines. These must be the first thing fixed.

Fix 1.1 — 
deduplicateSources
 Returns Wrong Array 🔴
Severity: Critical correctness bug
File: 
useMapAI.ts

Effort: 5 minutes (one character change)

Problem: The function builds a unique array (correct), but the return statement returns the original sources array instead of unique. Every caller receives an un-deduplicated list while believing duplicates were removed.

diff
- return { deduplicated: sources, uniqueCount: unique.length };
+ return { deduplicated: unique, uniqueCount: unique.length };
Verification: After the fix, manually trigger a map update twice with the same text. Open DevTools → Application → IndexedDB → fileExplorerDB → investigationMap. Inspect node sources arrays — they should contain no duplicates across repeated map updates.

Fix 1.2 — 
sanitizeHistory
 Mutates Input Array 🔴
Severity: Latent data-corruption bug
File: 
llm-provider.ts

Effort: 10 minutes

Problem: splice() mutates the caller's array. All current callers pass [...messages] which guards against it, but the contract is fragile. Future callers will corrupt their arrays silently.

diff
function sanitizeHistory(messages: ChatMessage[]): { systemPrompt: string | undefined; history: ChatMessage[] } {
-     let systemPrompt: string | undefined = undefined;
+     // Always work on an internal copy — never mutate the caller's array
+     messages = [...messages];
+     let systemPrompt: string | undefined = undefined;
Remove the spread from all call sites (they become redundant but removing them is optional cleanup):

generateContent
: 
sanitizeHistory([...messages])
 → 
sanitizeHistory(messages)
countTokens
: same
Verification: After the fix, add a test in 
src/utils/fileUtils.test.ts
 or a new llm-provider.test.ts that calls 
sanitizeHistory
 with a frozen/const array and asserts the original array was not modified.

Fix 1.3 — Remove All console.log('[DEBUG]...') from 
llm-provider.ts
 🟠
Severity: Data exposure (message content, API keys in responses leak to console)
File: 
llm-provider.ts
 lines 204, 283, 299, 356, 374, 421, 439
Effort: 10 minutes

Problem: Every API call logs the full request and response to the browser console unconditionally.

Changes:

Delete lines containing console.log('[DEBUG] Sending to Google API:')
Delete lines containing console.log('[DEBUG] OpenAI API Response Body:')
Delete lines containing console.log('[DEBUG] OpenRouter API Response Body:')
Delete lines containing console.log('[DEBUG] Sending to Ollama API:')
Delete lines containing console.log('[DEBUG] Ollama API Response Body:')
Also delete the two commented-out // console.log('[DEBUG] History before/after sanitization:') lines at lines 48 and 107
Verification: Run the app, send a message in any mode, open DevTools Console — no [DEBUG] entries should appear.

Fix 1.4 — Remove Debug Mount Log from 
ChatPanel.tsx
 🟢
Severity: Minor data hygiene
File: 
ChatPanel.tsx

Effort: 2 minutes

diff
- useEffect(() => {
-     console.log('[ChatPanel] Mounted, initial scroll check');
-     handleScroll();
- }, [handleScroll]);
+ useEffect(() => {
+     handleScroll();
+ }, [handleScroll]);
Verification: Open the app, check console — no [ChatPanel] Mounted log.

Fix 1.5 — Pin @google/generative-ai to a Specific Version 🟠
Severity: Build stability (breaking change risk)
File: 
package.json

Effort: 5 minutes

Step 1: Check currently installed version:

bash
cmd /c cd /d d:\coding\WEB_APPS\gemini-rag-studio && node -e "console.log(require('./node_modules/@google/generative-ai/package.json').version)"
Step 2: Pin to that version in 
package.json
:

diff
- "@google/generative-ai": "latest",
+ "@google/generative-ai": "^0.24.0",   // use the actual installed version
Step 3: Commit 
package-lock.json
 so the CI/CD lock is preserved.

Verification: Run npm install — no version bump should occur. Run npm list @google/generative-ai to confirm the pinned version.

Phase 1 can be delivered as a single PR. All five fixes are trivial and independent. Total files touched: 
useMapAI.ts
, 
llm-provider.ts
, 
ChatPanel.tsx
, 
package.json
.