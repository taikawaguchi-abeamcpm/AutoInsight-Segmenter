const { app } = require('@azure/functions');
const { containerFor, containerNames } = require('../cosmosStore');
const { handle, json } = require('../http');

app.http('cosmosHealth', {
  route: 'cosmos/health',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (_request, context) => handle(context, async () => {
    const checked = [];

    for (const logicalName of Object.keys(containerNames)) {
      const { partitionPath } = await containerFor(logicalName);
      checked.push({
        logicalName,
        containerName: containerNames[logicalName],
        partitionPath
      });
    }

    return json({
      status: 'ok',
      checkedAt: new Date().toISOString(),
      containers: checked
    });
  })
});
