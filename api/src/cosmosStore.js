const { CosmosClient } = require('@azure/cosmos');
const { DefaultAzureCredential } = require('@azure/identity');

const databaseId = process.env.COSMOS_DATABASE_NAME || process.env.COSMOS_DATABASE || 'autoinsight';

const containerNames = {
  fabricConnections: process.env.COSMOS_CONNECTIONS_CONTAINER || 'fabricConnections',
  semanticMappings: process.env.COSMOS_MAPPINGS_CONTAINER || 'semanticMappings',
  analysisRuns: process.env.COSMOS_ANALYSIS_RUNS_CONTAINER || 'analysisRuns',
  analysisResults: process.env.COSMOS_ANALYSIS_RESULTS_CONTAINER || 'analysisResults',
  segments: process.env.COSMOS_SEGMENTS_CONTAINER || 'segments',
  auditLogs: process.env.COSMOS_AUDIT_CONTAINER || 'auditLogs'
};

let client;
const containers = new Map();

const createClient = () => {
  if (client) {
    return client;
  }

  const connectionString = process.env.COSMOS_CONNECTION_STRING;
  const endpoint = process.env.COSMOS_ENDPOINT;
  const key = process.env.COSMOS_KEY;

  if (connectionString) {
    client = new CosmosClient(connectionString);
    return client;
  }

  if (!endpoint) {
    throw Object.assign(new Error('COSMOS_ENDPOINT or COSMOS_CONNECTION_STRING is required.'), { status: 500 });
  }

  client = key
    ? new CosmosClient({ endpoint, key })
    : new CosmosClient({ endpoint, aadCredentials: new DefaultAzureCredential() });

  return client;
};

const readPartitionPath = async (container) => {
  const { resource } = await container.read();
  return resource?.partitionKey?.paths?.[0] || '/partitionKey';
};

const pickPartitionValue = (document, partitionPath) => {
  const key = partitionPath.replace(/^\//, '');
  return document[key] ?? document.partitionKey ?? document.tenantId ?? 'default';
};

const ensureContainer = async (name) => {
  if (containers.has(name)) {
    return containers.get(name);
  }

  const cosmos = createClient();
  const { database } = await cosmos.databases.createIfNotExists({ id: databaseId });
  const { container } = await database.containers.createIfNotExists({
    id: name,
    partitionKey: { paths: ['/partitionKey'] }
  });

  const partitionPath = await readPartitionPath(container);
  const value = { container, partitionPath };
  containers.set(name, value);
  return value;
};

const containerFor = (logicalName) => {
  const name = containerNames[logicalName];
  if (!name) {
    throw Object.assign(new Error(`Unknown Cosmos container: ${logicalName}`), { status: 500 });
  }

  return ensureContainer(name);
};

const queryAll = async (logicalName, querySpec) => {
  const { container } = await containerFor(logicalName);
  const { resources } = await container.items.query(querySpec).fetchAll();
  return resources;
};

const upsert = async (logicalName, document) => {
  const { container, partitionPath } = await containerFor(logicalName);
  const now = new Date().toISOString();
  const next = {
    ...document,
    partitionKey: document.partitionKey ?? document.tenantId ?? 'default',
    tenantId: document.tenantId ?? 'default',
    updatedAt: document.updatedAt ?? now
  };

  const { resource } = await container.items.upsert(next);
  return resource;
};

const removeById = async (logicalName, id) => {
  const matches = await queryAll(logicalName, {
    query: 'SELECT * FROM c WHERE c.id = @id',
    parameters: [{ name: '@id', value: id }]
  });
  const target = matches[0];
  if (!target) {
    return false;
  }

  const { container, partitionPath } = await containerFor(logicalName);
  await container.item(id, pickPartitionValue(target, partitionPath)).delete();
  return true;
};

module.exports = {
  containerNames,
  containerFor,
  queryAll,
  upsert,
  removeById
};
