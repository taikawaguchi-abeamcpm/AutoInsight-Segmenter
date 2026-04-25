import { apiRequest, delay, type RequestOptions } from '../client';
import { buildSegmentDraft, nowIso } from '../mockData';
import type { SelectedSegmentContext } from '../../types/results';
import type { SegmentDraft, SegmentPreviewSummary, SegmentSaveResult } from '../../types/segment';

export const segmentApi = {
  async bootstrap(context: SelectedSegmentContext, options: RequestOptions = {}): Promise<SegmentDraft> {
    await delay(undefined, options.signal);
    return buildSegmentDraft(context.analysisJobId, context.segments);
  },

  async preview(draft: SegmentDraft, options: RequestOptions = {}): Promise<SegmentPreviewSummary> {
    await delay(160, options.signal);
    const base = draft.previewSummary?.estimatedAudienceSize ?? 10000;
    const adjusted = Math.max(0, base - Math.max(0, draft.ruleTree.conditions.length - 2) * 1200);

    return {
      estimatedAudienceSize: adjusted,
      audienceRate: adjusted / 184000,
      deltaFromPreviousPreview: adjusted - base,
      topConstrainingConditions: draft.ruleTree.conditions.map((condition) => condition.fieldLabel),
      warnings:
        adjusted === 0
          ? [{ code: 'ZERO_AUDIENCE', severity: 'error', message: '現在の条件では対象者が 0 件です。' }]
          : draft.outputConfig.outputs.length === 0
            ? [{ code: 'MISSING_OUTPUT_TARGET', severity: 'error', message: '出力方法を選択してください。' }]
            : [],
      sampleRows: draft.previewSummary?.sampleRows ?? []
    };
  },

  async save(draft: SegmentDraft, options: RequestOptions = {}): Promise<SegmentSaveResult> {
    const response = await apiRequest<SegmentSaveResult>('/segments/save', {
      method: 'POST',
      body: JSON.stringify({ draft }),
      signal: options.signal
    });
    if (response) {
      return response;
    }

    await delay(220, options.signal);

    return {
      segmentId: 'segment-demo-001',
      segmentExecutionId: draft.outputConfig.executionTiming === 'now' ? 'segment-exec-demo-001' : undefined,
      status: draft.outputConfig.executionTiming === 'now' ? 'queued' : 'saved',
      outputTypes: draft.outputConfig.outputs,
      outputLocation: 'segment_outputs.high_value_active',
      affectedRowCount: draft.previewSummary?.estimatedAudienceSize,
      executedBy: 'demo.user',
      savedAt: nowIso()
    };
  }
};
