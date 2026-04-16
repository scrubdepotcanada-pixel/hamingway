import { getState } from './state';
import {
  stepStartCycle,
  stepGenerateIdeas,
  stepSendApprovalEmail,
  stepCreateContent,
  stepReviewContent,
  stepPublish,
  stepPollApproval,
} from './steps';
import { logActivity } from '../log';

/**
 * Advance the pipeline by one step based on current state. Each call is a
 * single short action so it completes well under the serverless timeout.
 *
 * Called from the pipeline cron, the approvals cron, and the manual trigger
 * endpoint.
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
        return await stepGenerateIdeas();
      case 'IDEAS_READY': {
        // Manual mode (analysis_url present): stop here — the user picks
        // an idea from the dashboard instead of getting an email.
        if (state.analysisUrl) {
          return { ok: true, waiting: true, reason: 'manual mode — pick an idea in the dashboard' };
        }
        // Auto mode: send approval email
        return await stepSendApprovalEmail();
      }
      case 'PENDING_APPROVAL':
        return await stepPollApproval();
      case 'APPROVED':
        return await stepCreateContent();
      case 'CREATING':
        // Legacy transient state — treat as APPROVED and retry.
        return await stepCreateContent();
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
