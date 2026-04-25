const json = (body, status = 200) => ({
  status,
  jsonBody: body,
  headers: {
    'Cache-Control': 'no-store'
  }
});

const nowIso = () => new Date().toISOString();

const correlationId = () => `corr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const apiError = (code, message, status = 400, targetPath) => ({
  status,
  jsonBody: {
    code,
    message,
    severity: 'error',
    retryable: status >= 500,
    targetPath,
    correlationId: correlationId()
  },
  headers: {
    'Cache-Control': 'no-store'
  }
});

const handle = async (context, work) => {
  try {
    return await work();
  } catch (error) {
    context.error(error);
    return apiError(
      error.code || 'SERVER.ERROR',
      error.message || 'API request failed.',
      error.status || error.statusCode || 500
    );
  }
};

const requireJson = async (request) => {
  try {
    return await request.json();
  } catch {
    throw Object.assign(new Error('JSON body is required.'), {
      status: 400,
      code: 'VALIDATION.JSON_REQUIRED'
    });
  }
};

const makeHash = (value) => {
  const source = JSON.stringify(value);
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash << 5) - hash + source.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
};

module.exports = {
  apiError,
  correlationId,
  handle,
  json,
  makeHash,
  nowIso,
  requireJson
};
