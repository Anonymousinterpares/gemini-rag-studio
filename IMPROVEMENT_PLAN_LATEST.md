1. read improvement_plan.md and verify if all is already impleemnted -- Full AUDIT!

2. FEATURE EXPANSION:
    # 2.1. Build Case file funcitonality
        - applicaiton engine should be able to compose an extensive document, with paragraphs, chapters, sections, introduction, summary, analysis, hypothesis or any other sections relevant to given topic -- all of that based on the current Chat context -> app engine should NOT take into account any context which was part of internal calls, warning messages - ONLY what user can see himself in the UI
        - the purpose is to improve ability of LLM to compose very extensive reports which are consistent, without hallucination, duplication, redundancy on given topic.
        - for that functionality, it would be helpful if after initial analysis step (very brief) LLM would have a chance to ask user what exactly should be analysed for the case file -> this is to make it more robust in case there are many different aspects or topics within the chat
    # 2.2. Create story plot analysis and summary. Critical features:
        - applicaiton engine should be able to see chronology without mixups (know what part of analysed document e.g. a book, is earlier and which is later in the book) -- written chronology
        - app. should be able to analyse content to see if written chronology fully aligns with actual chronology, e.g. in a book, there can be parts (chapters, paragraphs, sections) which relate to the past compared with current chain of events -- engine & workflow needed to detect it
        - standard RAG searcjh would NOT suffice to detect full plot without missing any information -- anakysis/brainstorm on how to maximize accuracy without pushing whole book context to LLM #4f46e5
    # 2.3. rebuild/expand the applciation to enable it beeing an enterprise grade RAG system which would be able to handle tens, hundreds or even thousands of documents. Critical features:
        - robustness
        - ability to cope with even extremally large datasets
        - ability to provide links to documents and render preview on clicking on links provided as data sources for given claims (as currently!)
        - ability to store preprocessed data locally so that it would be ready on next app instance, even after full reboot


    ## 2.4
    important improvelment -> i need the chat bubbles to manage to have comments  to their content. Content on each bubble should have delimiters recognizable by apps engine (not sure if LLM should be forced to use it or if the standard deliminters could be coded so that app could recognize them without too much influence on LLM). Each section of the output recognized by the engine should have a "+" icon appearing to it's right (right side of the chat bubble) when user hoovers over that setion. if user clicks on "+", it would open an overlayed text input in that place to add a comment. user could click "cancel" to cancel this action or "add comment" which upon clicking, woudl take a non empty content of the text input as comment to that specific section -> this should properly be injected into the context of the chat so that LLM would notice it. The comment shoub be shown in added text box to te right of the chat bubble, next to the given section which was commented on. that text should have two buttons - one with trash icon to delete it (upon cinfirmation by user) and the other with pencil, to edit the content. once clicked on edit, a text input box should appear the same as when user was entering the commnet initially, with the text which is already there, and being able to edit it freely and then save. comments should be possible to be added ONLY to the latest output bubble. if any comments are added to the given output bubble, there should be an additional (new) button appearing at the bottom of that output bubble "resend with comments" -> if user clicks on that, LLM should get that very output WITH the added comments and additonal system prompt telling LLM that user has addtional remarks that should be addressed, each of them. BY DEFAULT, llm should be able to redact that output bu using diffs, instead of rewriting whole output from scratch, unless user states otwerwise -> rewriting should be a special action that llm should request and if llm choses it, user should be informed and either confirm or reject that. otherwise, llm's output should be able to edit that commented output accordingly. the edited parts hsould be highlighted in yellow and user should be able to confirm each of the edits individually (new buttopns "confirm" & 'reject" next to each highlighted new inputted content) or alternatively, confirm all edits -> addtional buttons "confirm all" & "reject all" at the very bottom of the edited chat bubble with the output (IMPORTANT IS TO make sure that not duplicated same output will be created in new chat bubble but instead, as mentioned, the same chat bubble is EDITED). ---DONE

    ## 2.5 
    investigation for case file -> created map in MERMAID -> EDITABLE BY LLM TO ADD MORE CONNECTIONS AND MAKE THEM MORE VISAALIZED, FILTERING SPECIFIC CONNECTIONS, THREADS, BRANCHES ETC.

    ## 2.6

    analysis required for IMPROVEMENT REQUEST FOR chat mode --> when building a case file, I want that file to be a completely separate from the main chat output area. the should be two new buttons added to the left panel: 'load case file' -> upon clicking, it shoudl allow user to select a case file by navigating in standard windows explorer window ; 'open case file' --> upon clicking, user should see an overlayed panel with the content of the case file. IMPORTANT --> commenting should be available in that file the same as in any standard chat bubbles.  ALSO, when commenting, LLM should have availabilty to the current chat content & the content of the case file and it should also have access to the internet with limitations set in the UI (the same ones as for the entire chat mode). The goal is to enable the case file to be expanded upon gradually, e.g. LLM created a case file tat touches several topics. Then user should be able to dig further in standard chat for more data and then, once user is satisfied, open the section with the case file, select desired section and ask llm to expand on that topic taking into account data already found and saved in the chat. BUT also, user should be able to request LLM to dig/expand on a topic even though it might be completely missing in the chat --> here is where the search option is necessary -> basically this should allow llm to do same research while writing comments and place big sections there. // additonal important think -> it should NOT be possible to remove selected part of text while leaving a comment requesting to make adjustments - if replacement is NOT successfull, the failed content that was suposed to replace selected one should be appended to the main CHAT so that new data would NOT be lost and old data would not be deleted. //addtionally, I need "undo" button at the bottom of the UI with a proper tooltip describing its functionality whic should be reversing the last action - e.g. if a comment was requested and data was replaced or failed data was appended to the chat, all of that since the last user input should be reversed by that button. there should be also a "redo" button specific for that functionality, next to undo button -> it should bring back what was undone --> this is to make applicaiton more robust and allow users to fix their potential errors easily. I need you to brainstorm hard on these and then, prepare a very detailed and very robust plan tacking each and every aspect of it


    ## 3 UI/UX Architecture: The "Fluid Workspace"
  Enterprise users require flexibility. The current fixed-width panel system (35% for files, 65% for chat) feels
  restrictive on large monitors.
   * Resizable Split Panes: Replace fixed CSS layouts with a library like react-resizable-panels to allow users to
     customize their view.
   * Collapsible Sidebars: Implement a "drawer" or "dock" system where panels can be collapsed into icons to maximize
     focus during deep analysis.
   * Design Tokens: Transition from basic CSS variables to a structured Design Token system. This ensures that spacing,
     typography, and color semantic values (e.g., brand-primary, bg-subtle, border-muted) are consistent across all
     custom components.


    ## 4 Design System & Aesthetics
  To achieve an "AAA" look, the app needs higher visual depth and consistent micro-interactions.
   * Typography Overhaul: Implement a professional font stack (e.g., Inter for UI, JetBrains Mono for code) with a
     strict modular scale for hierarchy.
   * Elevation & Layering: Use shadows and semi-transparent backgrounds (glassmorphism) more effectively to distinguish
     between the background, functional panels, and floating popovers.
   * Standardized Iconography: Ensure all icons (currently using Lucide) use consistent stroke weights (e.g., 1.5px or
     2px) and are aligned to a 20px or 24px grid.
   * "Monster" vs. "Enterprise" Themes: Formalize the "Monster" theme as a creative flavor while providing a clean,
     distraction-free "Standard Enterprise" light/dark theme by default.


    ## 5 Interaction Design & Polish
   * Skeleton Loaders: Replace the pulse animations in DocViewer and FilePanel with skeleton loaders that mimic the
     actual layout of the data about to arrive.
   * Command Palette (Ctrl + K): Add a global command palette for power users to quickly switch models, search projects,
     or toggle settings without leaving the keyboard.
   * Contextual Feedback: Improve the "Knowledge base updated" notifications. Instead of adding messages to the chat
     history, use "Toast" notifications or a dedicated "System Status" bar at the bottom.
   * Optimistic UI: When a user deletes a file or adds a comment, update the UI immediately before the backend/DB
     confirms the action, making the app feel instantaneous.


    ## 6 Performance & Scalability (Engineering)
   * Component De-monolithization: App.tsx is currently a 400+ line monolith. Logic should be extracted into specialized
     layout components (e.g., MainLayout, WorkspaceArea) and custom hooks.
   * Code Splitting: Use React.lazy() and Suspense for heavy components like the InvestigationMapPanel, DossierPanel,
     and DocViewer to reduce initial load time.
   * State Management Hygiene: Move complex state logic out of App.tsx and into specialized Zustand stores or focused
     useReducer hooks to prevent unnecessary re-renders of the entire app.
   * Virtualization Expansion: Ensure every list (not just the DocViewer) uses react-window or virtuoso to handle
     thousands of items (files, chat history, project logs) without lag.


    ## 7 Enterprise-Grade Features
   * Global Search: Implement a "Spotlight" search that finds text across all uploaded documents, not just the active
     one.
   * Accessibility (A11y): Perform a full ARIA audit. Ensure the app is fully keyboard-navigable and compatible with
     screen readers (crucial for enterprise compliance/WCAG).
   * Internationalization (i18n): Wrap hardcoded strings in a library like i18next to support global deployment.
   * Audit & Telemetry: Add a dedicated "Developer/Debug Console" within the UI to monitor LLM token usage, RAG
     retrieval latency, and embedding progress in real-time.


    ## 8. Code Quality & Maintenance
   * Schema Validation: Use Zod for validating settings and project files retrieved from IndexedDB/Storage to prevent
     "state corruption" bugs.
   * Component Documentation: Introduce Storybook to document Atoms (buttons, inputs) and Molecules (message items, file
     rows) in isolation.
   * Error Boundaries: Wrap major panels in React Error Boundaries to ensure that a crash in the Map functionality
     doesn't take down the entire File and Chat interface.

