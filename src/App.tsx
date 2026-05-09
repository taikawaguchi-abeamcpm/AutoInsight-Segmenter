import { useMemo, useState } from 'react';
import { AuthGate } from './components/auth/AuthGate';
import { FabricConnectionAdminScreen } from './components/admin/FabricConnectionAdminScreen';
import { AnalysisRunScreen } from './components/analysis/AnalysisRunScreen';
import { type AppStep, Shell } from './components/common/Shell';
import { DatasetSelectionScreen } from './components/dataset/DatasetSelectionScreen';
import { MappingScreen } from './components/mapping/MappingScreen';
import { ResultsVisualizationScreen } from './components/results/ResultsVisualizationScreen';
import { SavedResultsScreen } from './components/results/SavedResultsScreen';
import type { SelectedDatasetContext } from './types/dataset';
import type { FabricDataset, SemanticMappingDocument } from './types/mapping';

export default function App() {
  const [currentStep, setCurrentStep] = useState<AppStep>('dataset');
  const [datasetContext, setDatasetContext] = useState<SelectedDatasetContext | null>(null);
  const [mapping, setMapping] = useState<SemanticMappingDocument | null>(null);
  const [fabricDataset, setFabricDataset] = useState<FabricDataset | null>(null);
  const [analysisJobId, setAnalysisJobId] = useState<string | null>(null);

  const unlockedSteps = useMemo(() => {
    const steps: AppStep[] = ['admin', 'dataset', 'results'];

    if (datasetContext) {
      steps.push('mapping');
    }
    if (mapping) {
      steps.push('analysis');
    }

    return steps;
  }, [datasetContext, mapping]);

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
            setCurrentStep('results');
          }}
        />
      );
    }

    if (currentStep === 'results') {
      if (!analysisJobId) {
        return (
          <SavedResultsScreen
            onBackToDataset={() => setCurrentStep('dataset')}
            onOpenResult={(nextAnalysisJobId) => {
              setAnalysisJobId(nextAnalysisJobId);
              setCurrentStep('results');
            }}
          />
        );
      }

      return (
        <ResultsVisualizationScreen
          analysisJobId={analysisJobId}
          onBack={() => {
            if (mapping && fabricDataset) {
              setCurrentStep('analysis');
              return;
            }

            setAnalysisJobId(null);
            setCurrentStep('results');
          }}
        />
      );
    }

    setCurrentStep('dataset');
    return null;
  };

  return (
    <AuthGate>
      <Shell currentStep={currentStep} unlockedSteps={unlockedSteps} onNavigate={navigate}>
        {renderScreen()}
      </Shell>
    </AuthGate>
  );
}
