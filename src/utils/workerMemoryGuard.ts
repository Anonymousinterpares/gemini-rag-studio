/**
 * workerMemoryGuard.ts
 *
 * Computes a safe ML worker count cap based on:
 *  1. Actual ONNX model file sizes (via HEAD requests — no download cost)
 *  2. navigator.deviceMemory for absolute system RAM in GB
 *
 * This runs once before the coordinator is created so worker spawning never
 * exceeds what the machine can safely hold in WASM/WebGPU heap.
 */

/**
 * Steady-state WASM heap per worker after initialization completes.
 * Lower than peak because maxConcurrentInitializations = 3 staggers the
 * expensive load phase, so not all workers hit peak simultaneously.
 */
const STEADY_STATE_OVERHEAD = 1.2;

/**
 * Flat MB reserve for OS + browser/Electron internals + dev tooling.
 * Only used for genuinely low-memory machines (≤4 GB reported).
 */
const OS_RESERVE_MB = 1536;

/**
 * Probes a list of local model ONNX file URLs via HTTP HEAD requests.
 * Returns the total file size in MB. Returns 0 if none were found.
 */
async function probeModelFilesMB(candidateUrls: string[]): Promise<number> {
  let totalMB = 0;

  await Promise.all(
    candidateUrls.map(async (url) => {
      try {
        const res = await fetch(url, { method: 'HEAD' });
        if (res.ok) {
          const bytes = parseInt(res.headers.get('content-length') || '0', 10);
          if (bytes > 0) {
            totalMB += bytes / 1024 / 1024;
          }
        }
      } catch {
        // Model not cached or network unavailable — skip silently
      }
    })
  );

  return totalMB;
}

/**
 * Resolves the best-guess ONNX file URL for a model by probing dtype
 * variants in priority order (smallest/fastest first).
 * Returns the URL of the first file found, or null.
 */
async function resolveModelUrl(modelId: string, dtypePriority: string[]): Promise<string | null> {
  for (const dtype of dtypePriority) {
    const url = `/models/${modelId}/onnx/${dtype}`;
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (res.ok && parseInt(res.headers.get('content-length') || '0', 10) > 0) {
        return url;
      }
    } catch {
      // continue to next dtype
    }
  }
  return null;
}

/**
 * Computes the maximum number of ML workers that can safely be spawned given
 * current system memory and the actual sizes of the ONNX model files.
 *
 * @param modelIds - HuggingFace-style model IDs as used in env.localModelPath
 * @returns safe worker count cap, or Infinity if detection is not possible
 */
export async function computeSafeWorkerCap(modelIds: string[]): Promise<number> {
  // ── Step 1: Detect system RAM ────────────────────────────────────────────
  // navigator.deviceMemory is a standard Web API returning 1 | 2 | 4 | 8 (capped at 8 for privacy).
  // 16 GB and 64 GB machines both report 8 — that's fine, since those machines
  // will compute a safe count well above any realistic worker setting.
  const deviceMemoryGB: number =
    typeof navigator !== 'undefined' && 'deviceMemory' in navigator
      ? (navigator as Navigator & { deviceMemory: number }).deviceMemory ?? 8
      : 8;
  const systemRamMB = deviceMemoryGB * 1024;

  // ── Step 2: Probe model ONNX file sizes ──────────────────────────────────
  // We check dtype variants in priority order: fp16 → fp32 → quantized
  const dtypeVariants: Record<string, string[]> = {
    'Xenova/all-MiniLM-L6-v2': ['model_fp16.onnx', 'model.onnx', 'model_quantized.onnx'],
    'Xenova/bge-reranker-base': ['model_quantized.onnx', 'model.onnx'],
  };

  // Gather one URL per model (the first file found for each)
  const resolvedUrls: string[] = [];
  await Promise.all(
    modelIds.map(async (modelId) => {
      const variants = dtypeVariants[modelId] ?? ['model_quantized.onnx', 'model.onnx'];
      const url = await resolveModelUrl(modelId, variants);
      if (url) resolvedUrls.push(url);
    })
  );

  const totalModelFileSizeMB = await probeModelFilesMB(resolvedUrls);

  // ── Step 3: Calculate safe worker count ──────────────────────────────────
  // KEY INSIGHT: navigator.deviceMemory privacy-caps at 8 GB.
  // A machine reporting 8 could actually be 8, 16, 32, or 64 GB.
  // We have no way to distinguish — so we NEVER cap these machines.
  // Capping only makes sense for confirmed low-memory machines (≤4 GB reported).
  if (deviceMemoryGB >= 8) {
    console.log(
      `[workerMemoryGuard] deviceMemory=${deviceMemoryGB} GB (≥8 — could be 8, 16, 32+ GB). ` +
      `Cap not applied; trusting user setting.`
    );
    return Infinity;
  }

  if (totalModelFileSizeMB <= 0) {
    // Models not found locally yet (first run before caching) — no cap
    console.log('[workerMemoryGuard] Could not probe model sizes. No worker cap applied.');
    return Infinity;
  }

  // For confirmed low-memory machines (4 GB or less), apply a cap.
  // Use STEADY_STATE_OVERHEAD (1.2×) not peak (2.5×): workers initialize
  // at most 3 at a time via maxConcurrentInitializations, so peak memory
  // is bounded and transient — we plan for steady state, not burst.
  const perWorkerSteadyStateMB = totalModelFileSizeMB * STEADY_STATE_OVERHEAD;
  const availableMB = Math.max(0, systemRamMB - OS_RESERVE_MB);
  const safeCount = Math.max(1, Math.floor(availableMB / perWorkerSteadyStateMB));

  console.log(
    `[workerMemoryGuard] Low-memory machine detected: deviceMemory=${deviceMemoryGB} GB | ` +
    `Model files: ${totalModelFileSizeMB.toFixed(1)} MB | ` +
    `Per-worker steady-state est: ${perWorkerSteadyStateMB.toFixed(1)} MB | ` +
    `Safe worker cap: ${safeCount}`
  );

  return safeCount;
}
