# Specification: RAG Studio "AAA" Investigation Map Features

## 1. Executive Summary
The "AAA" Edge upgrade transforms the Investigation Map from a static visualization tool into a dynamic, physics-aware analytical workspace. By integrating temporal scrubbing, semantic de-duplication, and human-verified AI hypotheses, the system provides a high-fidelity environment for complex sense-making. The core philosophy is **AI-Proposed, Human-Verified**: every analytical insight (time, certainty, grouping) requires an explicit investigator "sign-off" before it influences the map’s core logic.

---

## 2. Temporal Mapping: The Verified Timeline

### 2.1 Conceptual Goal
Investigations are 4-dimensional. The Timeline Ghost allows users to "scrub" through history using a slider, seeing the investigation unfold as nodes fade in and out based on their timestamps.

### 2.2 Data Integrity: "Steel-Wall" Input Prevention
To ensure chronological accuracy, the timestamp input utilizes a **Masked Segmented Controller** rather than free-form text.
*   **Format:** `[DD] . [MM] . [YYYY]  [HH] : [MM] : [SS]` (24h format).
*   **Prevention Logic:**
    *   **Character Blocking:** The field physically rejects any non-digit input (excluding control keys like Backspace/Arrows).
    *   **Contextual Capping:** 
        *   **Days:** Strictly capped based on the month (e.g., February 29 is only allowed if the Year segment is a leap year; 31 is blocked for months 04, 06, 09, 11).
        *   **Time:** Hours capped at 23, Minutes/Seconds at 59.
*   **Feedback:** If a user attempts an invalid entry (e.g., typing '3' for the first digit of February), the segment flashes red with a 1000ms tooltip: *"Feb has 28/29 days"*. The invalid digit is never rendered.

### 2.3 The "Unverified" Lifecycle (HITL)
*   **AI Proposal:** The LLM agent is instructed to extract timestamps only when explicit. If unsure, it leaves the field empty.
*   **Yellow Beacon (Clock Icon):** Any AI-generated timestamp triggers a pulsing yellow light on the node.
*   **Verification Panel:** Double-clicking a node opens the details modal.
    *   **Green Tick:** Confirms the AI value.
    *   **Red Cross (X):** Clears the field to null (making the node "timeless").
    *   **Keyboard Ergonomics:** The first `Enter` keypress in the modal targets the highest unverified field (Timestamp). A second `Enter` targets the next (Certainty).

---

## 3. Evidence Force Fields: Analytical Gravity

### 3.1 Defining "Mass"
Nodes exert "Gravity" on the layout based on their verified importance.
1.  **Citations (External):** Unique semantic referral points from project documents and knowledge base.
2.  **Connections (Internal):** The number of edges linking to the node.
3.  **Calculation:** `Node_Mass = (Unique_Citations * 2) + Internal_Connections`.

### 3.2 The Reference Pipeline & Semantic De-duplication
To prevent "False Gravity" from repetitive text, the system utilizes a multi-stage de-duplication engine.
*   **Structural Detection:** Uses `parentChunkIndex` from the hierarchical splitter. If two snippets share the same document ID and parent index, they are merged as a single paragraph citation.
*   **Conceptual Detection (Semantic Identity):**
    *   **Vector Clustering:** Snippets are analyzed using Embedding Vectors (Cosine Similarity > 0.92).
    *   **Centroid Selection:** If two snippets are semantically identical (e.g., "The red car" vs. "The crimson vehicle"), they are clustered. Only the most representative "Semantic Anchor" is counted as a unique citation.
*   **Vector Store Integration:** Uses app settings for `relevanceThreshold` and `numInitialCandidates`. A new "Investigation Analytics" setting allows users to tweak `Citation Sensitivity` and `Deduplication Aggression`.

### 3.3 Certainty Validation
*   **Hypothesis State:** AI-assigned certainty (High/Med/Low) is marked with a **Shield Icon (Yellow Beacon)**.
*   **Verification:** Users must "Lock" the certainty via the Green Tick.
*   **Impact:** Only User-Verified mass affects the physics simulation. Unverified nodes are treated as weightless "Neutral Mass."

### 3.4 Layout Synergy: ELK vs. D3-Physics
*   **Static Mode (ELKjs):** The "Reset Layout" button forces a clean, hierarchical grid.
*   **Gravity Mode (D3-Force):** A toggle that "unlocks" nodes, allowing them to drift into positions determined by their gravity and relational tension.
*   **Safety:** Clicking "Reset Layout" while Gravity is ON automatically disables the physics engine and snaps nodes back to the grid.

---

## 4. Analytical Visualization

### 4.1 Heatmap Mini-Map
*   **Density Mapping:** Instead of grey boxes, the MiniMap renders a color-coded "Density Glow."
*   **Logic:** High concentrations of "Disproven" nodes glow Red; "New Evidence" glows Blue.
*   **Implementation:** A hidden `<canvas>` mirrored to the map's coordinates generates radial gradients for each node status, which is then scaled as the MiniMap background.

### 4.2 AI-Summarized Clusters
*   **Lasso Selection:** Users can select a cluster of nodes to trigger the "Synthesize" action.
*   **Group Nodes:** The LLM generates a conceptual summary, collapsing the selection into a single "Group Node" while retaining child references for "drill-down" analysis.

### 4.3 2.5D Layering (Simulated Depth)
*   **Shadow Casting:** Visual depth is achieved via `z-index` and `box-shadow` rather than perspective transforms (to preserve mouse accuracy).
    *   **Evidence:** Level 0 (Flat).
    *   **Events:** Level 2 (Medium shadow, appears elevated).
    *   **Conclusions:** Level 3 (Large shadow + Glow).
*   **Parallax Backgrounds:** Multiple grid layers moving at varying speeds during panning to create a sense of environmental depth.

---

## 5. Technical Implementation Roadmap

### 5.1 Store & Schema Updates (`useMapStore.ts`)
*   Add `isTimestampVerified`, `isCertaintyVerified`, `mass`, and `parentId` to `MapNode` interface.
*   Implement `toggleGravity(on: boolean)` and `verifyField(nodeId, fieldType)`.

### 5.2 Component Development
*   `ValidatedDateTimeInput.tsx`: The segmented, masked input component.
*   `BeaconOverlay.tsx`: The pulsing Yellow Dot system for Unverified states.
*   `ForceSimulationEngine.ts`: The D3-force implementation for Gravity mode.

### 5.3 Agent System Prompt Updates
*   Append strict instructions for `DD.MM.YYYY HH:MM:SS` extraction.
*   Instruct agent to leave unsure fields empty to avoid triggering unnecessary verification tasks for the human user.
