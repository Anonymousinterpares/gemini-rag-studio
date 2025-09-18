# API Recovery System - User Guide

## Overview

The API recovery system provides robust error handling for all LLM API calls, preventing research processes from being completely lost due to temporary API issues like overloading or network problems.

## Features

✅ **Automatic Retry with Exponential Backoff**
- Automatically retries failed API calls with increasing delays
- Smart error classification (overload, network, auth, unknown)

✅ **State Preservation**
- Saves research progress to localStorage
- Survives browser refreshes
- Tracks completed steps to avoid re-doing work

✅ **User Interaction for Recovery**
- Shows recovery dialog when max retries are reached
- Allows users to choose next action (retry, switch model, resume, abort)
- Provides context-aware suggestions

✅ **Model Switching**
- Easy model/provider switching during recovery
- Preserves all gathered data when switching
- API key updating support

✅ **Process Resumption**
- Can skip failed steps if possible
- Continues with available data
- Graceful degradation

## How It Works

### 1. Automatic Retry Phase
When an API call fails, the system:
1. Classifies the error type (503 overload, network, auth, etc.)
2. Retries automatically with exponential backoff
3. Saves failure state after each attempt

### 2. User Interaction Phase
If automatic retries fail, a dialog appears showing:
- Current progress (X/Y steps completed)
- Error details and suggested actions
- Model switching options
- Recovery choices

### 3. Recovery Actions
Users can choose:
- **Retry**: Try the same call again with current settings
- **Switch & Retry**: Change model/provider and retry
- **Resume**: Skip the failed step and continue (may affect quality)
- **Abort**: Stop the process entirely

## Integration Points

### Deep Analysis
The deep analysis agent now uses the recovery system for all LLM calls:
- Planner calls
- Intent interpretation
- Claims extraction
- Query expansion
- Final composition

### Regular Chat (Future)
Chat operations can use the `generateContentWithRecovery` wrapper:
```typescript
import { generateContentWithRecovery } from '../utils/chat-recovery-wrapper';

const response = await generateContentWithRecovery(
  model, 
  apiKey, 
  messages, 
  'rag_query', 
  'user_query'
);
```

## Error Types and Responses

### API Overload (503)
- **Typical Error**: "The model is overloaded. Please try again later."
- **Auto Retry**: Yes, with longer delays
- **Suggestions**: Wait and retry, switch provider
- **User Action**: Often resolves by waiting

### Network Errors
- **Typical Error**: "fetch failed", "network error"  
- **Auto Retry**: Yes, with standard delays
- **Suggestions**: Check connection, try different provider
- **User Action**: Verify network connection

### Authentication Errors (401)
- **Typical Error**: "unauthorized", "invalid API key"
- **Auto Retry**: Limited (usually a config issue)
- **Suggestions**: Update API key, switch provider
- **User Action**: Verify API key and quota

### Unknown Errors
- **Auto Retry**: Yes, with caution
- **Suggestions**: Try different model, check logs
- **User Action**: Review error details

## Best Practices

### For Users
1. **Keep API keys updated** - prevents auth failures
2. **Have backup providers** - allows quick switching
3. **Don't abort immediately** - API issues often resolve quickly
4. **Use resume option carefully** - may affect result quality

### For Developers
1. **Use descriptive step names** - helps users understand progress
2. **Set appropriate total steps** - gives accurate progress indication
3. **Handle null results from resumed steps** - graceful degradation
4. **Clean up recovery state** - call `finalizeRecovery()` when done

## Configuration Options

The recovery system accepts these options:
```typescript
{
  maxRetries: 5,           // Max automatic retries
  baseDelay: 2000,         // Starting delay (ms)
  maxDelay: 30000,         // Maximum delay (ms)
  enableUserInteraction: true,  // Show dialog on failure
  autoSwitchModels: false  // Auto-switch (not implemented)
}
```

## Recovery State Structure

The system tracks:
```typescript
{
  id: string,                    // Unique process ID
  processType: string,           // 'deep_analysis', 'rag_query', etc.
  startTime: number,             // Process start timestamp
  currentStep: string,           // Current operation
  totalSteps: number,            // Expected total operations
  completedSteps: string[],      // Successfully completed steps
  preservedData: any,            // Process-specific data
  failureCount: number,          // Number of failures
  lastError: {
    message: string,
    type: 'api_overload' | 'network_error' | 'auth_error' | 'unknown',
    timestamp: number
  }
}
```

## Testing the Recovery System

### Simulating API Overload
1. Start a deep analysis research process
2. If using a real API, wait for potential overload errors
3. Or modify the `generateContent` function temporarily to throw 503 errors

### Testing Model Switching
1. Trigger a recovery dialog
2. Select a different model from the dropdown
3. Enter a new API key if needed
4. Click "Switch & Retry"
5. Verify the process continues with new model

### Testing Resume Functionality
1. Let a process fail multiple times
2. Click "Resume" instead of retry
3. Verify the process continues but may have reduced quality

## Troubleshooting

### Recovery Dialog Not Appearing
- Check that `enableUserInteraction` is true
- Verify the RecoveryDialogContainer is rendered in App.tsx
- Check browser console for event listener errors

### State Not Persisting
- Check localStorage permissions
- Verify `recovery_state_*` entries in localStorage
- Check for JSON serialization errors

### Models Not Switching
- Verify model list is properly passed to RecoveryDialogContainer
- Check that `onModelChange` callback is working
- Ensure API keys are updated when switching

## Future Enhancements

Planned improvements:
- [ ] Auto model switching based on error patterns
- [ ] Smart retry scheduling based on provider status
- [ ] Recovery from partial failures in batch operations
- [ ] Integration with rate limiting systems
- [ ] Recovery analytics and success rates

This system ensures that long-running research processes are resilient to temporary API issues, providing a much better user experience during peak usage times or network instability.
