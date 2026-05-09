import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const outDir = join(process.cwd(), 'analysis-worker', 'testdata');
mkdirSync(outDir, { recursive: true });

const industries = ['Manufacturing', 'Retail', 'SaaS', 'Healthcare', 'Logistics'];
const regions = ['Tokyo', 'Osaka', 'Nagoya', 'Fukuoka', 'Sapporo'];
const leadSources = ['webinar', 'referral', 'web', 'event', 'partner'];
const startDate = new Date('2026-01-01T00:00:00.000Z');

let seed = 20260509;
const random = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

const isoDay = (offsetDays) => {
  const date = new Date(startDate.getTime() + offsetDays * 24 * 60 * 60 * 1000);
  return date.toISOString();
};

const csvEscape = (value) => {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const writeCsv = (filename, rows) => {
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(',')),
  ];
  writeFileSync(join(outDir, filename), `${lines.join('\n')}\n`, 'utf8');
};

const customers = [];
const activities = [];
const sales = [];

for (let index = 1; index <= 120; index += 1) {
  const customerId = `C${String(index).padStart(4, '0')}`;
  const highIntent = index <= 24;
  const slowFollow = index > 24 && index <= 48;
  const growingRevenue = index > 48 && index <= 66;
  const industry = highIntent || slowFollow
    ? 'Manufacturing'
    : industries[Math.floor(random() * industries.length)];
  const employeeCount = highIntent || slowFollow
    ? 8 + Math.floor(random() * 13)
    : 25 + Math.floor(random() * 280);
  const observedAt = isoDay(100);
  const wonFlag = highIntent || (growingRevenue && random() < 0.65) || (random() < 0.08 && industry === 'SaaS') ? 1 : 0;

  customers.push({
    customer_id: customerId,
    industry,
    employee_count: employeeCount,
    region: regions[Math.floor(random() * regions.length)],
    company_age_years: 1 + Math.floor(random() * 40),
    lead_source: leadSources[Math.floor(random() * leadSources.length)],
    observed_at: observedAt,
    won_flag: wonFlag,
  });

  if (highIntent) {
    const emailDay = 18 + Math.floor(random() * 10);
    const visitDay = emailDay + 1 + Math.floor(random() * 2);
    activities.push(
      {
        activity_id: `A${customerId}-001`,
        customer_id: customerId,
        activity_at: isoDay(emailDay),
        activity_type: 'Email',
        reaction_hours: 4 + Math.floor(random() * 18),
        sales_rep_team: 'inside',
      },
      {
        activity_id: `A${customerId}-002`,
        customer_id: customerId,
        activity_at: isoDay(visitDay),
        activity_type: 'Visit',
        reaction_hours: '',
        sales_rep_team: 'field',
      },
      {
        activity_id: `A${customerId}-003`,
        customer_id: customerId,
        activity_at: isoDay(visitDay + 3 + Math.floor(random() * 5)),
        activity_type: 'Proposal',
        reaction_hours: '',
        sales_rep_team: 'field',
      },
    );
  } else if (slowFollow) {
    const emailDay = 18 + Math.floor(random() * 10);
    activities.push(
      {
        activity_id: `A${customerId}-001`,
        customer_id: customerId,
        activity_at: isoDay(emailDay),
        activity_type: 'Email',
        reaction_hours: 48 + Math.floor(random() * 72),
        sales_rep_team: 'inside',
      },
      {
        activity_id: `A${customerId}-002`,
        customer_id: customerId,
        activity_at: isoDay(emailDay + 8 + Math.floor(random() * 15)),
        activity_type: 'Visit',
        reaction_hours: '',
        sales_rep_team: 'field',
      },
    );
  } else {
    const count = 1 + Math.floor(random() * 5);
    for (let activityIndex = 1; activityIndex <= count; activityIndex += 1) {
      const type = ['Call', 'Email', 'WebVisit', 'Meeting'][Math.floor(random() * 4)];
      activities.push({
        activity_id: `A${customerId}-${String(activityIndex).padStart(3, '0')}`,
        customer_id: customerId,
        activity_at: isoDay(10 + Math.floor(random() * 70)),
        activity_type: type,
        reaction_hours: type === 'Email' ? 12 + Math.floor(random() * 96) : '',
        sales_rep_team: random() < 0.65 ? 'inside' : 'field',
      });
    }
  }

  for (let month = 1; month <= 4; month += 1) {
    const baseAmount = highIntent
      ? 95000 + month * 12000 + Math.floor(random() * 25000)
      : growingRevenue
      ? 90000 + month * 28000 + Math.floor(random() * 40000)
      : 70000 + Math.floor(random() * 50000) - month * Math.floor(random() * 6000);
    sales.push({
      sale_id: `S${customerId}-${month}`,
      customer_id: customerId,
      sale_at: isoDay(month * 20),
      product_category: random() < 0.55 ? 'core' : 'addon',
      amount: Math.max(5000, Math.round(baseAmount)),
      discount_rate: highIntent ? 0.05 : Math.round(random() * 30) / 100,
    });
  }
}

const dataset = {
  id: 'analysis-test-dataset',
  workspaceId: 'local-fixture',
  name: 'analysis_test_dataset',
  displayName: 'Analysis Test Dataset',
  lastSyncedAt: new Date().toISOString(),
  tables: [
    {
      id: 'tbl-customers',
      name: 'customers',
      displayName: 'Customers',
      rowCount: customers.length,
      columns: [
        ['col-customer-id', 'customer_id', 'Customer ID', 'string', true, false],
        ['col-industry', 'industry', 'Industry', 'string', false, false],
        ['col-employee-count', 'employee_count', 'Employee Count', 'integer', false, false],
        ['col-region', 'region', 'Region', 'string', false, false],
        ['col-company-age', 'company_age_years', 'Company Age Years', 'integer', false, false],
        ['col-lead-source', 'lead_source', 'Lead Source', 'string', false, false],
        ['col-observed-at', 'observed_at', 'Observed At', 'datetime', false, false],
        ['col-won-flag', 'won_flag', 'Won Flag', 'boolean', false, false],
      ].map(([id, name, displayName, dataType, isPrimaryKey, isForeignKey]) => ({
        id,
        tableId: 'tbl-customers',
        name,
        displayName,
        dataType,
        nullable: false,
        isPrimaryKey,
        isForeignKey,
      })),
    },
    {
      id: 'tbl-activities',
      name: 'activities',
      displayName: 'Activities',
      rowCount: activities.length,
      columns: [
        ['col-activity-id', 'activity_id', 'Activity ID', 'string', true, false],
        ['col-activity-customer-id', 'customer_id', 'Customer ID', 'string', false, true],
        ['col-activity-at', 'activity_at', 'Activity At', 'datetime', false, false],
        ['col-activity-type', 'activity_type', 'Activity Type', 'string', false, false],
        ['col-reaction-hours', 'reaction_hours', 'Reaction Hours', 'float', false, false],
        ['col-sales-rep-team', 'sales_rep_team', 'Sales Rep Team', 'string', false, false],
      ].map(([id, name, displayName, dataType, isPrimaryKey, isForeignKey]) => ({
        id,
        tableId: 'tbl-activities',
        name,
        displayName,
        dataType,
        nullable: true,
        isPrimaryKey,
        isForeignKey,
      })),
    },
    {
      id: 'tbl-sales',
      name: 'sales',
      displayName: 'Sales',
      rowCount: sales.length,
      columns: [
        ['col-sale-id', 'sale_id', 'Sale ID', 'string', true, false],
        ['col-sale-customer-id', 'customer_id', 'Customer ID', 'string', false, true],
        ['col-sale-at', 'sale_at', 'Sale At', 'datetime', false, false],
        ['col-product-category', 'product_category', 'Product Category', 'string', false, false],
        ['col-amount', 'amount', 'Amount', 'float', false, false],
        ['col-discount-rate', 'discount_rate', 'Discount Rate', 'float', false, false],
      ].map(([id, name, displayName, dataType, isPrimaryKey, isForeignKey]) => ({
        id,
        tableId: 'tbl-sales',
        name,
        displayName,
        dataType,
        nullable: true,
        isPrimaryKey,
        isForeignKey,
      })),
    },
  ],
};

const columnMapping = (columnId, tableId, columnRole, featureConfig, targetConfig) => ({
  columnId,
  tableId,
  columnRole,
  businessName: columnId,
  source: 'manual',
  status: 'mapped',
  featureConfig,
  targetConfig,
});

const featureConfig = (featureKey, label, dataType, valueType, aggregation = 'latest') => ({
  featureKey,
  label,
  dataType,
  valueType,
  aggregation,
  missingValuePolicy: valueType === 'categorical' ? 'unknown_category' : 'zero_fill',
  enabled: true,
});

const mapping = {
  id: 'analysis-test-mapping',
  datasetId: dataset.id,
  version: 1,
  status: 'ready',
  tableMappings: [
    {
      tableId: 'tbl-customers',
      entityRole: 'customer_master',
      businessName: 'Customers',
      primaryKeyColumnId: 'col-customer-id',
      customerJoinColumnId: 'col-customer-id',
      source: 'manual',
      status: 'mapped',
    },
    {
      tableId: 'tbl-activities',
      entityRole: 'event_log',
      businessName: 'Activities',
      customerJoinColumnId: 'col-activity-customer-id',
      source: 'manual',
      status: 'mapped',
    },
    {
      tableId: 'tbl-sales',
      entityRole: 'transaction_fact',
      businessName: 'Sales',
      customerJoinColumnId: 'col-sale-customer-id',
      source: 'manual',
      status: 'mapped',
    },
  ],
  columnMappings: [
    columnMapping('col-customer-id', 'tbl-customers', 'customer_id'),
    columnMapping('col-industry', 'tbl-customers', 'feature', featureConfig('industry', 'Industry', 'string', 'categorical', 'none')),
    columnMapping('col-employee-count', 'tbl-customers', 'feature', featureConfig('employee_count', 'Employee Count', 'integer', 'numeric')),
    columnMapping('col-region', 'tbl-customers', 'feature', featureConfig('region', 'Region', 'string', 'categorical', 'none')),
    columnMapping('col-company-age', 'tbl-customers', 'feature', featureConfig('company_age_years', 'Company Age Years', 'integer', 'numeric')),
    columnMapping('col-lead-source', 'tbl-customers', 'feature', featureConfig('lead_source', 'Lead Source', 'string', 'categorical', 'none')),
    columnMapping('col-observed-at', 'tbl-customers', 'event_time'),
    columnMapping('col-won-flag', 'tbl-customers', 'target', undefined, {
      targetKey: 'won_flag',
      label: 'Won Flag',
      positiveValue: '1',
      negativeValue: '0',
      eventTimeColumnId: 'col-observed-at',
    }),
    columnMapping('col-activity-id', 'tbl-activities', 'excluded'),
    columnMapping('col-activity-customer-id', 'tbl-activities', 'customer_id'),
    columnMapping('col-activity-at', 'tbl-activities', 'event_time'),
    columnMapping('col-activity-type', 'tbl-activities', 'feature', featureConfig('activity_type', 'Activity Type', 'string', 'categorical')),
    columnMapping('col-reaction-hours', 'tbl-activities', 'feature', featureConfig('reaction_hours', 'Reaction Hours', 'float', 'numeric', 'avg')),
    columnMapping('col-sales-rep-team', 'tbl-activities', 'feature', featureConfig('sales_rep_team', 'Sales Rep Team', 'string', 'categorical')),
    columnMapping('col-sale-id', 'tbl-sales', 'excluded'),
    columnMapping('col-sale-customer-id', 'tbl-sales', 'customer_id'),
    columnMapping('col-sale-at', 'tbl-sales', 'event_time'),
    columnMapping('col-product-category', 'tbl-sales', 'feature', featureConfig('product_category', 'Product Category', 'string', 'categorical')),
    columnMapping('col-amount', 'tbl-sales', 'feature', featureConfig('amount', 'Amount', 'float', 'numeric', 'sum')),
    columnMapping('col-discount-rate', 'tbl-sales', 'feature', featureConfig('discount_rate', 'Discount Rate', 'float', 'numeric', 'avg')),
  ],
  joinDefinitions: [
    {
      id: 'join-activities-customers',
      fromTableId: 'tbl-activities',
      fromColumnIds: ['col-activity-customer-id'],
      toTableId: 'tbl-customers',
      toColumnIds: ['col-customer-id'],
      joinType: 'left',
      cardinality: 'many_to_one',
      source: 'manual',
    },
    {
      id: 'join-sales-customers',
      fromTableId: 'tbl-sales',
      fromColumnIds: ['col-sale-customer-id'],
      toTableId: 'tbl-customers',
      toColumnIds: ['col-customer-id'],
      joinType: 'left',
      cardinality: 'many_to_one',
      source: 'manual',
    },
  ],
  validationIssues: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  updatedBy: 'fixture',
};

const payload = {
  analysisJobId: 'analysis-test-job',
  runId: 'analysis-test-run',
  connection: { endpointUrl: 'local-fixture' },
  auth: {},
  mapping,
  dataset,
  config: {
    mode: 'autopilot',
    candidateFeatureLimit: 200,
    allowGeneratedFeatures: true,
    businessPriority: 'segmentability',
    excludeHighMissingColumns: true,
    excludeHighCardinalityColumns: true,
    blockedColumnKeys: [],
    segmentObjective: 'unconverted_targeting',
    patternCount: 12,
    maxFeatureCount: 50,
    importanceMethod: 'hybrid',
  },
};

writeCsv('customers.csv', customers);
writeCsv('activities.csv', activities);
writeCsv('sales.csv', sales);
writeFileSync(join(outDir, 'dataset.json'), `${JSON.stringify(dataset, null, 2)}\n`, 'utf8');
writeFileSync(join(outDir, 'mapping.json'), `${JSON.stringify(mapping, null, 2)}\n`, 'utf8');
writeFileSync(join(outDir, 'payload.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

console.log(`Wrote ${customers.length} customers, ${activities.length} activities, ${sales.length} sales rows to ${outDir}`);
