## 5. 🔴 PLAUSIBLE-LOOKING CODE HIDING DEEPER FLAWS

### 5.1 `persistToDB` Called on Every `patchNodes`/`patchEdges` — No Debounce

**File:** [useMapStore.ts](file:///d:/coding/WEB_APPS/gemini-rag-studio/src/store/useMapStore.ts#L207), [L236](file:///d:/coding/WEB_APPS/gemini-rag-studio/src/store/useMapStore.ts#L236), [L251](file:///d:/coding/WEB_APPS/gemini-rag-studio/src/store/useMapStore.ts#L251), [L266](file:///d:/coding/WEB_APPS/gemini-rag-studio/src/store/useMapStore.ts#L266)

```typescript
patchNodes: (...) => {
    set(...); // synchronous
    get().persistToDB(); // async write to IndexedDB
},
```
When the AI job adds 20 nodes + 30 edges in rapid succession, each `patchNodes`/`patchEdges` call fires a separate `persistToDB()`. This means 50 parallel IndexedDB write transactions to the same key. While IndexedDB serializes writes internally, this is still wasteful and can cause write amplification. A debounce (e.g., 500ms) should be used.

Additionally, after `applyToolCalls` in `useMapAI.ts`, a manual `useMapStore.setState()` is called directly (bypassing `patchNodes` and its undo-checkpoint logic):
```typescript
useMapStore.setState({ nodes: autoLayout(finalNodes, finalEdges, 'LR') }); // ← bypasses checkpoint
```
This means the auto-layout step is not undoable and doesn't trigger persistence through the store's mechanism, requiring a manual `persistToDB()` call afterward.

---

### 5.2 Map Lock Acquired but Released in `finally` — No Timeout Guard

**File:** [useMapAI.ts](file:///d:/coding/WEB_APPS/gemini-rag-studio/src/hooks/useMapAI.ts#L690-L784)

```typescript
if (!mapStore.acquireLock()) {
    addToast('Map update already in progress. Please wait.', 'warning');
    return;
}
// ... await multiple LLM calls, web searches, RAG searches (can take minutes)
} finally {
    mapStore.releaseLock();
}
```
If the LLM calls hang or a network error causes a strange promise behavior (not a thrown `Error`), the lock could theoretically never release (though `finally` is robust). More critically, there is **no timeout** on the lock. If the user loses connectivity mid-operation, the map stays locked until the browser tab is refreshed. A `setTimeout` guard (e.g., 5 minutes) should release the lock automatically.

---

### 5.3 Token Counter Effect Runs on Every Keystroke with 1s Debounce

**File:** [useChat.ts](file:///d:/coding/WEB_APPS/gemini-rag-studio/src/hooks/useChat.ts#L221-L238)

```typescript
useEffect(() => {
    const calculateContextTokens = async () => {
        // Calls Google API countTokens() on every change
        const tokens = await countTokens(selectedModel, apiKey, messages);
        setCurrentContextTokens(tokens);
    };
    const timeoutId = setTimeout(calculateContextTokens, 1000);
    return () => clearTimeout(timeoutId);
}, [chatHistory, userInput, files, summaries, selectedModel, apiKeys, ...]);
```
**Debt Risk:** `countTokens` makes a **real Google API call** per keystroke (after 1s debounce). For Google provider, this is billable. For long chat histories + large context, this hits the API for every character typed. The debounce is necessary but the fallback heuristic should be used for non-Google providers, and for Google, a much longer debounce (3–5s) or a user-triggered "calculate" button is preferable.

---

### 5.4 `sanitizeHistory` Mutates the Input Array

**File:** [llm-provider.ts](file:///d:/coding/WEB_APPS/gemini-rag-studio/src/api/llm-provider.ts#L44-L56)

```typescript
function sanitizeHistory(messages: ChatMessage[]): ... {
    const systemMsgIndex = messages.findIndex(m => m.role === 'system');
    if (systemMsgIndex !== -1) {
        systemPrompt = messages.splice(systemMsgIndex, 1)[0].content || undefined; // ← mutates input
    }
    // ...
    messages = messages.slice(firstUserIndex); // ← rebinds local variable, original still mutated
}
```
The function uses `splice()` which mutates the passed array. All callers pass `[...messages]` (a spread copy), which guards against it — but this is fragile. If any future caller forgets the spread, it will corrupt their message array. `sanitizeHistory` should work on an internal copy.
