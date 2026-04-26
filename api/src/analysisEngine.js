const { spawn } = require('node:child_process');
const { join, resolve } = require('node:path');

const WORKER_TIMEOUT_MS = Number(process.env.ANALYSIS_WORKER_TIMEOUT_MS || 15 * 60 * 1000);

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

const runWorkerCandidate = (candidate, payload) =>
  new Promise((resolvePromise, rejectPromise) => {
    const scriptPath = resolve(__dirname, '..', '..', 'analysis-worker', 'run_analysis.py');
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
      rejectPromise(Object.assign(new Error('Python analysis worker timed out.'), {
        status: 504,
        code: 'ANALYSIS.WORKER_TIMEOUT'
      }));
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
        rejectPromise(Object.assign(new Error(stderr.trim() || `Python analysis worker exited with code ${code}.`), {
          status: 500,
          code: 'ANALYSIS.WORKER_FAILED'
        }));
        return;
      }

      try {
        resolvePromise(JSON.parse(stdout));
      } catch (err) {
        rejectPromise(Object.assign(new Error(`Python analysis worker returned invalid JSON. ${err.message}`), {
          status: 500,
          code: 'ANALYSIS.WORKER_INVALID_OUTPUT'
        }));
      }
    });

    child.stdin.end(JSON.stringify(payload));
  });

const runPythonAnalysis = async (payload) => {
  const errors = [];
  for (const candidate of pythonCandidates()) {
    try {
      return await runWorkerCandidate(candidate, payload);
    } catch (err) {
      if (err.code === 'ENOENT') {
        errors.push(`${candidate.command}: not found`);
        continue;
      }
      throw err;
    }
  }

  throw Object.assign(new Error(`Python executable was not found. Tried: ${errors.join(', ')}`), {
    status: 500,
    code: 'ANALYSIS.PYTHON_NOT_FOUND'
  });
};

const buildRealAnalysisResult = async ({ connection, req, analysisJobId, runId, mapping, dataset, config }) =>
  runPythonAnalysis({
    analysisJobId,
    runId,
    connection,
    auth: {
      authorization: reqHeader(req, 'authorization')
    },
    mapping,
    dataset,
    config
  });

module.exports = {
  buildRealAnalysisResult
};
