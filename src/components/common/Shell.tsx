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
          const className = [active ? 'active' : '', step.id === 'admin' ? 'admin-step' : ''].filter(Boolean).join(' ');

          return (
            <button
              key={step.id}
              type="button"
              className={className}
              aria-current={active ? 'step' : undefined}
              disabled={disabled}
              onClick={() => onNavigate(step.id)}
            >
              {step.id === 'admin' ? null : <span>{index}</span>}
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
