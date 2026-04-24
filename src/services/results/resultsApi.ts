import { delay, type RequestOptions } from '../client';
import { mockResult } from '../mockData';
import type { AnalysisResultDocument, SelectedSegmentContext } from '../../types/results';

export const resultsApi = {
  async getResult(analysisJobId: string, options: RequestOptions = {}): Promise<AnalysisResultDocument> {
    await delay(undefined, options.signal);

    return {
      ...mockResult,
      analysisJobId
    };
  },

  async prepareSegments(context: SelectedSegmentContext, options: RequestOptions = {}): Promise<SelectedSegmentContext> {
    await delay(120, options.signal);
    return context;
  }
};
