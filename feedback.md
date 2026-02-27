# Application Feedback and Issues

## UI/UX Improvements

1.  **Visual Cues for Document Status:** There is no visual cue indicating that a knowledge document is being created or is under review for modification.
2.  **Visual Cues for Review Connections:** Missing visual cues for review connections.
3.  **Node Context Menu Interaction:**
    *   **Current Behavior:** Right-clicking a node shows both the 'analyze connections' modal (with input) and selectable actions.
    *   **Desired Behavior:** Show only action selection initially. Add a 'review selections with additional comment' option. Clicking this should close the selection menu and open the 'analyze connections' modal with the comment input.
4.  **Graph Layout & Overlap:** Nodes currently overlap in dense graphs. The automatic layout should prevent this by detecting node edges and enforcing a minimum margin.
5.  **Badge Evaluation & Tooltips:**
    *   Badge values are unclear (mostly '1').
    *   Values > 1 should be highlighted (e.g., red/blinking intensity based on value).
    *   Add a tooltip explaining the badge meaning and calculation.
6.  **Network Focus Reset:** It is difficult to track which node is focused in 'focus on network' mode. Add a 'Reset View' button to deactivate all filters/focus modes.
7.  **Map Creation Sources:**
    *   Ensure map creation considers attached and embedded documents, not just chat.
    *   Add a button in the map header (next to review) to "Create Map" from all available context (chat, docs, embedded info) without requiring additional input.
8.  **Chat Input Bug:** Input field sometimes freezes. Workaround: Minimize/Maximize app. This needs a fix.
9.  **Chat Re-initialization:** Re-opening a chat triggers a typewriter effect for history. This should be instant.
10. **Workflow Documentation:** Need clearer guidance on the most effective analysis workflow.

## Feature Requests

11. **File Pre-selection (Autoload):**
    *   Add option to select files in the left panel to be "Autoloaded" on project start.
    *   UI: Button to toggle selection mode (checkboxes appear).
    *   Interactions: Click to select, Drag to multi-select, Shift+Click for range select.
    *   "Select All" / "Unselect All" option.
12. **Case File Presentation:** Generated case files currently only appear in chat. They should be displayed in a dedicated modal or integrated into the Knowledge Base UI.

## Bugs & Technical Issues

13. **Chat Bubble Layout & Embeddings:**
    *   **Layout:** Chat bubbles expand horizontally causing scroll issues. Max-width should be constrained to the window; bubbles should grow vertically.
    *   **Rendering:** Raw embedding IDs and JSON artifacts are sometimes displayed instead of icons/formatted citations.
    *   **Example Artifact:**
        ```text
        All statements within this case file are directly derived from the above‑listed sources; no external material has been introduced.
        <!--searchResults:[{"chunk":"Trans portes Frontera office, Monterrey was interviewed...
        ...
        "similarity":0.8509225369716075,"id":"MEXICO CITY CHRONOLOGY LISTING OF ITEMS CONCERNING THE OSWALDS...
        ```