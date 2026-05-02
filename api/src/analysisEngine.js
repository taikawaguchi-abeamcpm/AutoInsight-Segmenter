const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { join, resolve } = require('node:path');

const WORKER_TIMEOUT_MS = Number(process.env.ANALYSIS_WORKER_TIMEOUT_MS || 15 * 60 * 1000);
const WORKER_URL = process.env.ANALYSIS_WORKER_URL;
const WORKER_KEY = process.env.ANALYSIS_WORKER_KEY;

const reqHeader = (req, name) =>
  req.headers?.[name] || req.headers?.[name.toLowerCase()] || req.headers?.[name.toUpperCase()];

const pythonCandidates = () => {
  if (process.env.PYTHON_EXECUTABLE) {
    return [{ command: process.env.PYTHON_EXECUTABLE, args: [] }];
  }

  return [
    { command: 'python', args: [] },
    { command: 'python3', args: [] },
    { command: 'py', args: ['-3'] }
  ];
};

const analysisError = (message, code, status = 500) =>
  Object.assign(new Error(message), { code, status });

const workerUrlSummary = () => {
  try {
    const url = new URL(WORKER_URL);
    return `${url.origin}${url.pathname}`;
  } catch {
    return 'invalid ANALYSIS_WORKER_URL';
  }
};

const workerHealthUrl = () => {
  const url = new URL(WORKER_URL);
  if (url.pathname.endsWith('/analysis/run')) {
    url.pathname = url.pathname.replace(/\/analysis\/run$/, '/analysis/health');
  } else {
    url.pathname = `${url.pathname.replace(/\/$/, '')}/health`;
  }
  url.search = '';
  return url.toString();
};

const getAnalysisWorkerStatus = async () => {
  if (!WORKER_URL) {
    return {
      configured: false,
      reachable: false,
      hasKey: Boolean(WORKER_KEY),
      message: 'ANALYSIS_WORKER_URL is not configured.'
    };
  }

  let summary;
  let healthUrl;
  try {
    summary = workerUrlSummary();
    healthUrl = workerHealthUrl();
  } catch (err) {
    return {
      configured: true,
      reachable: false,
      hasKey: Boolean(WORKER_KEY),
      workerUrl: WORKER_URL,
      message: `ANALYSIS_WORKER_URL is invalid. ${err.message}`
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(healthUrl, { method: 'GET', signal: controller.signal });
    const contentType = response.headers.get('content-type') || '';
    const body = contentType.includes('application/json')
      ? await response.json().catch(() => null)
      : await response.text().catch(() => '');
    return {
      configured: true,
      reachable: response.ok,
      hasKey: Boolean(WORKER_KEY),
      workerUrl: summary,
      healthUrl,
      status: response.status,
      body
    };
  } catch (err) {
    return {
      configured: true,
      reachable: false,
      hasKey: Boolean(WORKER_KEY),
      workerUrl: summary,
      healthUrl,
      message: err.name === 'AbortError' ? 'Health check timed out.' : err.message
    };
  } finally {
    clearTimeout(timeout);
  }
};

const runRemotePythonWorker = async (payload) => {
  if (!WORKER_URL) {
    throw analysisError(
      'ANALYSIS_WORKER_URL is not configured. Deploy the Python analysis Function App and set this value in the Node API app settings.',
      'ANALYSIS.WORKER_URL_NOT_CONFIGURED'
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WORKER_TIMEOUT_MS);

  try {
    const response = await fetch(WORKER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(WORKER_KEY ? { 'x-functions-key': WORKER_KEY } : {})
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const contentType = response.headers.get('content-type') || '';
    const body = contentType.includes('application/json')
      ? await response.json().catch(() => null)
      : await response.text().catch(() => '');

    if (!response.ok) {
      const message = body?.message || body?.error || body || response.statusText || 'Python analysis worker request failed.';
      throw analysisError(message, 'ANALYSIS.WORKER_HTTP_FAILED', response.status || 502);
    }

    if (!body || typeof body !== 'object') {
      throw analysisError('Python analysis worker returned invalid JSON.', 'ANALYSIS.WORKER_INVALID_OUTPUT');
    }

    return body;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw analysisError('Python analysis worker timed out.', 'ANALYSIS.WORKER_TIMEOUT', 504);
    }
    if (!err.code || !err.code.startsWith?.('ANALYSIS.')) {
      throw analysisError(
        `Python analysis worker is unreachable at ${workerUrlSummary()}. ${err.message}`,
        'ANALYSIS.WORKER_UNREACHABLE',
        502
      );
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
};

const runLocalPythonWorkerCandidate = (candidate, payload) =>
  new Promise((resolvePromise, rejectPromise) => {
    const scriptPath = resolve(__dirname, '..', '..', 'analysis-worker', 'run_analysis.py');
    if (!existsSync(scriptPath)) {
      rejectPromise(analysisError(
        `Python analysis worker was not found at ${scriptPath}.`,
        'ANALYSIS.WORKER_NOT_DEPLOYED'
      ));
      return;
    }

    const child = spawn(candidate.command, [...candidate.args, scriptPath], {
      cwd: join(__dirname, '..', '..'),
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8'
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      rejectPromise(analysisError('Python analysis worker timed out.', 'ANALYSIS.WORKER_TIMEOUT', 504));
    }, WORKER_TIMEOUT_MS);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (err) => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;
      rejectPromise(err);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;

      if (code !== 0) {
        rejectPromise(analysisError(
          stderr.trim() || `Python analysis worker exited with code ${code}.`,
          'ANALYSIS.WORKER_FAILED'
        ));
        return;
      }

      try {
        resolvePromise(JSON.parse(stdout));
      } catch (err) {
        rejectPromise(analysisError(
          `Python analysis worker returned invalid JSON. ${err.message}`,
          'ANALYSIS.WORKER_INVALID_OUTPUT'
        ));
      }
    });

    child.stdin.end(JSON.stringify(payload));
  });

const runLocalPythonWorker = async (payload) => {
  const errors = [];
  for (const candidate of pythonCandidates()) {
    try {
      return await runLocalPythonWorkerCandidate(candidate, payload);
    } catch (err) {
      if (err.code === 'ENOENT') {
        errors.push(`${candidate.command}: not found`);
        continue;
      }
      throw err;
    }
  }

  throw analysisError(
    `Python executable was not found. Tried: ${errors.join(', ')}`,
    'ANALYSIS.PYTHON_NOT_FOUND'
  );
};

const buildRealAnalysisResult = async ({ connection, req, analysisJobId, runId, mapping, dataset, config }) => {
  const payload = {
    analysisJobId,
    runId,
    connection,
    auth: {
      authorization: reqHeader(req, 'authorization')
    },
    mapping,
    dataset,
    config
  };

  return WORKER_URL ? runRemotePythonWorker(payload) : runLocalPythonWorker(payload);
};

module.exports = {
  buildRealAnalysisResult,
  getAnalysisWorkerStatus
};
