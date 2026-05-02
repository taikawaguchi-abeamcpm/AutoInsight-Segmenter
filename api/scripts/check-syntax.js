const { readdirSync } = require('node:fs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');

const collect = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return collect(path);
    }

    return entry.isFile() && entry.name.endsWith('.js') ? [path] : [];
  });

const files = [
  ...collect(join(__dirname, '..', 'src')),
  ...collect(join(__dirname, '..', 'httpApi'))
];

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) {
    process.exit(result.status);
  }
}

const pythonFiles = [
  join(__dirname, '..', '..', 'analysis-worker', 'run_analysis.py'),
  join(__dirname, '..', '..', 'analysis-worker', 'autoinsight_analysis', 'worker.py'),
  join(__dirname, '..', '..', 'analysis-function', 'function_app.py')
];
const pythonResult = spawnSync('python', ['-m', 'py_compile', ...pythonFiles], { stdio: 'inherit' });
if (pythonResult.error) {
  console.error(pythonResult.error.message);
  process.exit(1);
}
if (pythonResult.status !== 0) {
  process.exit(pythonResult.status);
}
