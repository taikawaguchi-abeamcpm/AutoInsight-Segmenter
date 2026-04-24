import { Activity, Database, GitBranch, LineChart, PlayCircle, Settings, Users } from 'lucide-react';
import type { ReactNode } from 'react';

export type AppStep = 'admin' | 'dataset' | 'mapping' | 'analysis' | 'results' | 'segment';

const steps: Array<{ id: AppStep; label: string; icon: typeof Database }> = [
  { id: 'admin', label: '接続管理', icon: Settings },
  { id: 'dataset', label: 'データセット', icon: Database },
  { id: 'mapping', label: '意味付け', icon: GitBranch },
  { id: 'analysis', label: '分析開始', icon: PlayCircle },
  { id: 'results', label: '結果', icon: LineChart },
  { id: 'segment', label: 'セグメント', icon: Users }
];

export const Shell = ({
  currentStep,
  unlockedSteps,
  onNavigate,
  children
}: {
  currentStep: AppStep;
  unlockedSteps: AppStep[];
  onNavigate: (step: AppStep) => void;
  children: ReactNode;
}) => (
  <div className="app-shell">
    <aside className="sidebar">
      <div className="brand">
        <Activity aria-hidden="true" />
        <div>
          <strong>AutoInsight</strong>
          <span>Segmenter</span>
        </div>
      </div>
      <nav className="step-nav" aria-label="ワークフロー">
        {steps.map((step, index) => {
          const Icon = step.icon;
          const disabled = !unlockedSteps.includes(step.id);
          const active = step.id === currentStep;

          return (
            <button
              key={step.id}
              type="button"
              className={active ? 'active' : ''}
              aria-current={active ? 'step' : undefined}
              disabled={disabled}
              onClick={() => onNavigate(step.id)}
            >
              <span>{step.id === 'admin' ? 'A' : index}</span>
              <Icon aria-hidden="true" />
              {step.label}
            </button>
          );
        })}
      </nav>
    </aside>
    <main className="main-content">{children}</main>
  </div>
);
