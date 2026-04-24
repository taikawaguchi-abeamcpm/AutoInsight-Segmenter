import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export const Button = ({
  children,
  variant = 'primary',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) => (
  <button className={`button button-${variant}`} {...props}>
    {children}
  </button>
);

export const Badge = ({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) => (
  <span className={`badge badge-${tone}`}>{children}</span>
);

export const Card = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <section className={`panel ${className}`}>{children}</section>
);

export const Metric = ({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) => (
  <div className="metric">
    <span>{label}</span>
    <strong>{value}</strong>
    {hint ? <small>{hint}</small> : null}
  </div>
);

export const Field = ({
  label,
  children,
  help
}: {
  label: string;
  children: ReactNode;
  help?: string;
}) => (
  <label className="field">
    <span>{label}</span>
    {children}
    {help ? <small>{help}</small> : null}
  </label>
);

export const FieldGroup = ({
  label,
  children,
  help
}: {
  label: string;
  children: ReactNode;
  help?: string;
}) => (
  <fieldset className="field field-group">
    <legend>{label}</legend>
    {children}
    {help ? <small>{help}</small> : null}
  </fieldset>
);

export const EmptyState = ({ title, description }: { title: string; description: string }) => (
  <div className="empty-state">
    <strong>{title}</strong>
    <p>{description}</p>
  </div>
);

export const formatNumber = (value?: number) => (typeof value === 'number' ? new Intl.NumberFormat('ja-JP').format(value) : '-');

export const formatPercent = (value?: number) =>
  typeof value === 'number' ? `${(value * 100).toFixed(1)}%` : '-';

export const formatDateTime = (value?: string) =>
  value
    ? new Intl.DateTimeFormat('ja-JP', {
        dateStyle: 'medium',
        timeStyle: 'short'
      }).format(new Date(value))
    : '-';
