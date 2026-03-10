 Implementation Plan: Investigation Map "AAA" Edge

  Phase 1: The Foundation (Data Schema & Verification UI)
  Goal: Prepare the state management and visual indicators for human-in-the-loop (HITL) verification.


  1.1 Store & Types Update
   * Action: Update MapNode interface in src/types/index.ts and useMapStore.ts.
   * Fields to Add:
       * timestamp: string | null (ISO or custom format)
       * isTimestampVerified: boolean
       * certainty: number (0-100)
       * isCertaintyVerified: boolean
       * mass: number (Calculated field)
       * semanticFactId: string | null (For de-duplication)
   * Deliverable: Redux/Zustand store capable of tracking verification states.


  1.2 The "Beacon" System
   * Action: Create BeaconOverlay.tsx.
   * Logic:
       * Display a Yellow Pulse on the top-right of a node if timestamp && !isTimestampVerified.
       * Display a Shield Icon Pulse if certainty && !isCertaintyVerified.
   * Deliverable: Nodes visually signaling they contain unverified AI data.


  1.3 Success Criteria
   * New properties persist in IndexedDB via persistToDB.
   * Nodes created by AI automatically show the yellow beacons.

  > Manual Verification Point: Create a node manually vs. via AI. Verify the AI node has the yellow beacons while the
  manual one (with null values) does not.

  ---


  Phase 2: The "Steel-Wall" Input & Keyboard Workflow
  Goal: Implement the bulletproof input prevention and ergonomic verification controls.

  2.1 ValidatedDateTimeInput Component
   * Action: Create a segmented input component for DD.MM.YYYY HH:MM:SS.
   * Logic:
       * Use onKeyDown to block all non-numeric keys.
       * Implement "Capping Logic":
           * If Month segment is 02, the Day segment rejects 30+.
           * If Year is not leap, Day segment rejects 29 for Feb.
       * Feedback: 1000ms Red Flash + Tooltip for blocked entries.
   * Deliverable: A highly restrictive input field that makes invalid dates impossible to type.


  2.2 Sequential Enter Confirmation
   * Action: Update NodeDetailsModal.tsx.
   * Logic:
       * Enter Press 1: If !isTimestampVerified, trigger "Green Tick" for Time.
       * Enter Press 2: If !isCertaintyVerified, trigger "Green Tick" for Certainty.
       * Visual "Success" flash (green border) on the field being confirmed.
   * Deliverable: Rapid-fire verification via the keyboard.


  2.3 Success Criteria
   * Attempting to type "31.02" results in "30.02" or a blocked "1", with a red feedback flash.
   * Pressing Enter twice in a modal clears both yellow beacons from the map.


  > Manual Verification Point: Open a node with both unverified fields. Type an invalid date (Feb 30). Confirm the
  block. Press Enter twice and ensure the beacons vanish.

  ---

  Phase 3: Temporal Mapping (The Timeline Ghost)
  Goal: Implement the spatial-temporal filtering system.


  3.1 Timeline Slider
   * Action: Create TimelineSlider.tsx at the bottom of the InvestigationMapCanvas.
   * Logic:
       * Find min/max timestamps of all nodes to set slider range.
       * Add "Key Event" tick marks.
   * Deliverable: A functional time-scrubbing UI.


  3.2 Ghosting Logic
   * Action: Update InvestigationMapCanvas.tsx node rendering.
   * Logic:
       * If Node.timestamp > Slider.currentValue: opacity: 0.1 + filter: grayscale(100%).
       * If Node.timestamp == null: opacity: 1.0 (Timeless nodes are always visible).
   * Deliverable: A map that visually "replays" the investigation history.

  3.3 Success Criteria
   * Moving the slider dynamically fades nodes in/out without UI lag.


  > Manual Verification Point: Set three nodes to 2021, 2022, and 2023. Drag the slider and verify they appear in
  sequence.

  ---

  Phase 4: Semantic Citation & Mass Engine
  Goal: Connect the map to the RAG backend with de-duplication.


  4.1 Structural & Conceptual De-duplication
   * Action: Update src/rag/pipeline.ts and useMapAI.ts.
   * Logic:
       * Structural: Check parentChunkIndex. Merge hits from the same paragraph.
       * Conceptual: Use cos_sim > 0.92 to cluster semantically identical snippets across different documents.
   * Deliverable: A "Unique Citation Count" per node.


  4.2 Mass Calculation
   * Action: Implement calculateNodeMass(node) function.
   * Logic: Mass = (Unique_Citations * 2) + Internal_Edges.
   * Constraint: Only verified certainties/citations contribute to full mass. Unverified = 50% mass penalty.
   * Deliverable: Every node has a calculated "Gravity" value.


  4.3 Success Criteria
   * Two documents saying "The car was red" count as one unique citation if the context is identical.

  > Manual Verification Point: Check a node's detail panel. Verify that 10 mentions of the same fact in one paragraph
  only result in "1 Citation."

  ---


  Phase 5: Analytical Gravity (Physics Layout)
  Goal: Implement the "Live" analytical view.


  5.1 D3-Force Integration
   * Action: Create ForceLayoutEngine.ts.
   * Logic:
       * Use d3-force simulation.
       * forceManyBody().strength() = -Node.mass * 10.
       * forceLink().distance() = Inverse of connection strength.
   * Deliverable: A toggleable "Gravity Mode."


  5.2 Layout Synergy
   * Action: Update toolbar with "Enable Gravity" and "Reset Layout".
   * Logic: "Reset" kills the D3 simulation and calls the ELKjs runLayout function.
   * Deliverable: Seamless switching between "Clean" and "Analytical" views.


  5.3 Success Criteria
   * Enabling Gravity causes heavy (highly cited) nodes to move to the center.
   * Reset Layout snaps everything back to a readable grid.


  > Manual Verification Point: Click "Enable Gravity." Watch the nodes drift. Click "Reset Layout" and verify they snap
  back to the neat ELK grid.

  ---

  Phase 6: Visual Depth & Intelligence (Final Polish)
  Goal: "AAA" aesthetics and high-level summaries.


  6.1 Heatmap MiniMap
   * Action: Custom MiniMap implementation.
   * Logic: Use a Canvas to draw radial blurs (Glows) based on node status (Red/Blue).
   * Deliverable: A MiniMap that shows "Hotspots" of conflict or evidence.


  6.2 2.5D Layering
   * Action: CSS Shadow Injection.
   * Logic:
       * Evidence = box-shadow: 2px 2px 2px rgba(0,0,0,0.1).
       * Conclusion = box-shadow: 15px 15px 30px rgba(0,0,0,0.4).
   * Deliverable: Visual hierarchy where conclusions look "higher" than evidence.


  6.3 AI-Summarized Clusters
   * Action: Lasso Tool + summarizeCluster action.
   * Logic: Send selected node metadata to LLM -> Create GroupNode -> Set parentId for children.
   * Deliverable: Ability to collapse complex maps into summary groups.


  6.4 Success Criteria
   * The map looks "deep" and professional.
   * Summarizing a cluster successfully hides the child nodes and shows one summary node.


  > Manual Verification Point: Zoom out and look at the MiniMap. Verify that areas with many "Disproven" nodes glow red.
  Lasso 5 nodes and click "Summarize" to see them collapse into a group.