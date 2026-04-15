import { getState } from './state';
import {
  stepStartCycle,
  stepCreateContent,
  stepReviewContent,
  stepPublish,
  stepPollApproval,
} from './steps';
import { logActivity } from '../log';

/**
 * Advance the pipeline by one step based on current state. Each call is a
 * single action with a tight time budget so it completes well under 10s.
 *
 * This is called from the pipeline cron, the approvals cron, and the manual
 * trigger endpoint.
 */
export async function advanceOnce() {
  const state = await getState();

  try {
    switch (state.currentStep) {
      case 'IDLE':
      case 'COMPLETE':
      case 'EXPIRED':
      case 'FAILED':
        return await stepStartCycle();
      case 'GENERATING':
        // GENERATING is a transient state within stepStartCycle. If we land
        // here it means the prior run crashed mid-step — restart the cycle.
        return { ok: false, reason: 'stuck in GENERATING — manual reset required', step: state.currentStep };
      case 'PENDING_APPROVAL':
        return await stepPollApproval();
      case 'APPROVED':
        return await stepCreateContent();
      case 'CREATING':
        return { ok: false, reason: 'stuck in CREATING — manual reset required' };
      case 'REVIEWING':
        return await stepReviewContent();
      case 'PUBLISHING':
        return await stepPublish();
      default:
        return { ok: false, reason: `unknown step: ${state.currentStep}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logActivity({
      action: 'pipeline_error',
      cycleId: state.currentCycleId ?? null,
      projectId: state.currentProjectId ?? null,
      details: { step: state.currentStep, message },
    });
    return { ok: false, error: message, step: state.currentStep };
  }
}
