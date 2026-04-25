import { useMemo, useState } from 'react';
import { FabricConnectionAdminScreen } from './components/admin/FabricConnectionAdminScreen';
import { AnalysisRunScreen } from './components/analysis/AnalysisRunScreen';
import { type AppStep, Shell } from './components/common/Shell';
import { DatasetSelectionScreen } from './components/dataset/DatasetSelectionScreen';
import { MappingScreen } from './components/mapping/MappingScreen';
import { ResultsVisualizationScreen } from './components/results/ResultsVisualizationScreen';
import { SegmentCreationScreen } from './components/segment/SegmentCreationScreen';
import type { SelectedDatasetContext } from './types/dataset';
import type { FabricDataset, SemanticMappingDocument } from './types/mapping';
import type { SelectedSegmentContext } from './types/results';

export default function App() {
  const [currentStep, setCurrentStep] = useState<AppStep>('dataset');
  const [datasetContext, setDatasetContext] = useState<SelectedDatasetContext | null>(null);
  const [mapping, setMapping] = useState<SemanticMappingDocument | null>(null);
  const [fabricDataset, setFabricDataset] = useState<FabricDataset | null>(null);
  const [analysisJobId, setAnalysisJobId] = useState<string | null>(null);
  const [segmentContext, setSegmentContext] = useState<SelectedSegmentContext | null>(null);

  const unlockedSteps = useMemo(() => {
    const steps: AppStep[] = ['admin', 'dataset'];

    if (datasetContext) {
      steps.push('mapping');
    }
    if (mapping) {
      steps.push('analysis');
    }
    if (analysisJobId) {
      steps.push('results');
    }
    if (segmentContext) {
      steps.push('segment');
    }

    return steps;
  }, [analysisJobId, datasetContext, mapping, segmentContext]);

  const navigate = (step: AppStep) => {
    if (unlockedSteps.includes(step)) {
      setCurrentStep(step);
    }
  };

  const renderScreen = () => {
    if (currentStep === 'dataset') {
      return (
        <DatasetSelectionScreen
          onOpenConnectionAdmin={() => setCurrentStep('admin')}
          onSelected={(context) => {
            setDatasetContext(context);
            setMapping(null);
            setFabricDataset(null);
            setAnalysisJobId(null);
            setSegmentContext(null);
            setCurrentStep('mapping');
          }}
        />
      );
    }

    if (currentStep === 'admin') {
      return <FabricConnectionAdminScreen onBack={() => setCurrentStep('dataset')} />;
    }

    if (currentStep === 'mapping' && datasetContext) {
      return (
        <MappingScreen
          datasetContext={datasetContext}
          onBack={() => setCurrentStep('dataset')}
          onCompleted={(nextMapping, nextDataset) => {
            setMapping(nextMapping);
            setFabricDataset(nextDataset);
            setAnalysisJobId(null);
            setSegmentContext(null);
            setCurrentStep('analysis');
          }}
        />
      );
    }

    if (currentStep === 'analysis' && mapping && fabricDataset) {
      return (
        <AnalysisRunScreen
          mapping={mapping}
          fabricDataset={fabricDataset}
          onBack={() => setCurrentStep('mapping')}
          onStarted={(nextAnalysisJobId) => {
            setAnalysisJobId(nextAnalysisJobId);
            setSegmentContext(null);
            setCurrentStep('results');
          }}
        />
      );
    }

    if (currentStep === 'results' && analysisJobId) {
      return (
        <ResultsVisualizationScreen
          analysisJobId={analysisJobId}
          onBack={() => setCurrentStep('analysis')}
          onSegmentsSelected={(context) => {
            setSegmentContext(context);
            setCurrentStep('segment');
          }}
        />
      );
    }

    if (currentStep === 'segment' && segmentContext) {
      return <SegmentCreationScreen context={segmentContext} onBack={() => setCurrentStep('results')} />;
    }

    setCurrentStep('dataset');
    return null;
  };

  return (
    <Shell currentStep={currentStep} unlockedSteps={unlockedSteps} onNavigate={navigate}>
      {renderScreen()}
    </Shell>
  );
}
