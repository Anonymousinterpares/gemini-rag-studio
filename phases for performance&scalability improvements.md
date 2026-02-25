  Phase 1: Component De-monolithization
  Objective: Transform App.tsx from a logic-heavy orchestrator into a thin "Shell" that merely defines the high-level
  layout.


  Detailed Strategy
   1. Extract `MainLayout.tsx`: Create a layout-only component using react-resizable-panels to manage the relationship
      between FilePanel, ChatPanel, and InvestigationMap.
   2. Business Logic Hooks: Move remaining "glue" logic (keyboard shortcuts, file drop validation, global undo/redo)
      into a specialized useAppOrchestrator hook.
   3. Modal Consolidation: Create a GlobalModalManager that renders EmbeddingCacheModal, SummaryModal, and
      CustomFileExplorer based on a centralized UI store, removing 50+ lines of modal state from App.tsx.


   * Deliverables:
       * src/components/layout/MainLayout.tsx
       * src/hooks/useAppOrchestrator.ts
       * src/store/useUIStore.ts (to manage panel visibility and modal states)
   * Success Criteria: App.tsx should be reduced to < 100 lines of code.
   * Visual Evaluation: No change in current UI, but the "feel" should be snappier as the top-level component stops
     re-rendering on every keystroke.

  ---


  Phase 2: Code Splitting & Suspense
  Objective: Reduce the initial bundle size and "Time to Interactive" (TTI) by loading heavy modules only when needed.


  Detailed Strategy
   1. Lazy Definitions: Wrap InvestigationMapPanel, DossierPanel, CaseFilePanel, and DocViewer in React.lazy().
   2. Skeleton Screens: Design a WorkspaceSkeleton and PanelSkeleton that mimics the layout (using gray blocks) to
      prevent layout shifts during loading.
   3. Pre-fetching: Implement pre-fetching on hover for icons (e.g., pre-fetch Map code when the user hovers over the
      Map icon).


   * Deliverables:
       * Dynamic imports in App.tsx and ChatPanel.tsx.
       * src/components/shared/SkeletonLoader.tsx.
   * Success Criteria: Initial JS bundle size reduced by ~30%; "Investigation Map" loads with a smooth transition
     instead of a stutter.
   * Visual Evaluation: When clicking the "Map" or "Dossier" icon for the first time in a session, you should see a
     subtle skeleton loader followed by a smooth fade-in of the component.

  ---


  Phase 3: State Management Hygiene
  Objective: Eliminate "Prop Drilling" and ensure that component updates are scoped to the smallest possible UI
  fragment.


  Detailed Strategy
   1. Zustand Store Migration: Move the 15+ local useState hooks in App.tsx (e.g., viewMode, docFontSize, isPinned) into
      useUIStore.ts.
   2. Selector Optimization: Update all components to use specific Zustand selectors (e.g., const files = useFileStore(s
      => s.files)) instead of pulling the whole store, preventing unnecessary re-renders.
   3. Command Pattern: Move complex handlers like handleSaveAndRerun and handleDropValidate into the store actions or
      specialized utility files.


   * Deliverables:
       * Refactored useUIStore.ts.
       * Removal of handlers prop object being passed down from App.tsx to ChatPanel.
   * Success Criteria: React DevTools "Highlight Updates" should show that typing in the chat input only highlights the
     input field, not the FilePanel or App container.
   * Visual Evaluation: Use React Profiler to verify that "Commit Time" for simple actions (like toggling a setting)
     stays under 5ms.

  ---

  Phase 4: Virtualization Expansion
  Objective: Ensure the application remains performant even with 10,000+ files or 500+ chat messages.


  Detailed Strategy
   1. Virtual Chat List: Implement react-window in MessageList.tsx. This is critical because LLM responses with
      citations and markdown are computationally expensive to render.
   2. Variable Height Support: Use react-window-dynamic or a custom getItemSize function to handle chat messages of
      varying lengths.
   3. Virtual File Explorer: Refactor FileListView.tsx to use virtualization, as a project with a deep node_modules or
      large dataset can currently freeze the browser.


   * Deliverables:
       * src/components/Chat/VirtualMessageList.tsx.
       * Updated FileListView.tsx and ProjectBrowser.tsx.
   * Success Criteria: Scrolling through a history of 100+ messages is "buttery smooth" (60fps) with no blank frames.
   * Visual Evaluation: Open a project with 1,000+ files. The list should scroll instantly without "jank" or
     browser-level "Not Responding" warnings.

  ---

  Summary Checklist for Visual Judgment



  ┌────────────────┬──────────────────────────────────────────┬────────────────────────────────────────────────────┐
  │ Feature        │ Pass (AAA-Grade)                         │ Fail (Prototype-Grade)                             │
  ├────────────────┼──────────────────────────────────────────┼────────────────────────────────────────────────────┤
  │ Resizing   │ Panels slide smoothly; layout adjusts    │ Panels "jump" or require a refresh to fix layout.  │
  │                │ instantly.                               │                                                    │
  │ Navigation │ Clicking Map/Dossier shows a brief,      │ Clicking Map/Dossier freezes the UI for 500ms.     │
  │                │ clean loader.                            │                                                    │
  │ Typing     │ No delay between keypress and character  │ Noticeable lag when typing in a long chat session. │
  │                │ appearing.                               │                                                    │
  │ Scrolling  │ 1,000 items scroll like 10 items.        │ Scrolling gets progressively slower as data grows. │
  │ Console    │ Zero "Re-render" warnings or "Prop type" │ Flooded with "Warning: Each child in a list..." or │
  │                │ errors.                                  │ re-renders.                                        │
  └────────────────┴──────────────────────────────────────────┴────────────────────────────────────────────────────┘