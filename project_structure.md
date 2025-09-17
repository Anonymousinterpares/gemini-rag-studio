.
├── .env.local
├── .eslintignore
├── .eslintrc.cjs
├── .gitignore
├── .prettierrc
├── ARCHITECTURE.md
├── checklist.md
├── index.html
├── LOCAL_LLM_PLAN.md
├── log.md
├── mcp-server.log
├── metadata.json
├── package-lock.json
├── package.json
├── README.md
├── start-app.bat
├── start.js
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
└── src/
    ├── App.tsx
    ├── config.ts
    ├── idea_for_text_previewer.md
    ├── index.tsx
    ├── Modal.css
    ├── Modal.tsx
    ├── models.json
    ├── progress-bar.css
    ├── style.css
    ├── vite-env.d.ts
    ├── agents/
    │   ├── deep_analysis.ts
    │   └── router_v2.ts
    ├── api/
    │   └── llm-provider.ts
    ├── cache/
    │   ├── embeddingCache.ts
    │   └── summaryCache.ts
    ├── components/
    │   ├── CustomFileExplorer.tsx
    │   ├── DocViewer.tsx
    │   ├── EmbeddingCacheModal.tsx
    │   ├── FileListView.tsx
    │   ├── FileTreeView.tsx
    │   ├── FolderReviewModal.css
    │   ├── FolderReviewModal.tsx
    │   ├── Settings.tsx
    │   ├── SummaryModal.tsx
    │   └── Monster/
    │       ├── DigestParticles.tsx
    │       ├── FloatingArrows.tsx
    │       ├── index.ts
    │       ├── RejectionBubble.tsx
    │       └── SpeechBubble.tsx
    ├── compute/
    │   ├── coordinator.ts
    │   ├── ml.worker.ts
    │   ├── types.ts
    │   └── worker.ts
    ├── hooks/
    │   ├── useChat.ts
    │   ├── useCompute.ts
    │   ├── useFileState.ts
    │   ├── useLayoutManager.ts
    │   └── useSettingsState.ts
    ├── rag/
    │   ├── hierarchical-splitter.ts
    │   ├── pipeline.ts
    │   └── worker.ts
    ├── types/
    │   ├── global.d.ts
    │   └── index.ts
    └── utils/
        ├── db.ts
        ├── fileExplorer.ts
        ├── fileTree.ts
        ├── fileUtils.ts
        ├── gitignoreParser.ts
        └── taskFactory.ts