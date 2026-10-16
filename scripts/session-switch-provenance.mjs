import { execFileSync } from 'node:child_process';

export function sessionSwitchProvenance(buildInfo) {
  let checkoutCommit = null;
  try {
    checkoutCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    // Packaged-only local runs may not have Git; do not invent a commit.
  }
  const env = process.env;
  return {
    baselineCommit: 'f424091846431c82eec936e74c8607e189ed66d5',
    baselineTree: '11d10551481dbd2aa044ccf81d69b7655bab5223',
    testCommit: env.GITHUB_SHA || checkoutCommit,
    checkoutCommit,
    githubRunId: env.GITHUB_RUN_ID ?? null,
    githubRunAttempt: env.GITHUB_RUN_ATTEMPT ?? null,
    imageOS: env.ImageOS ?? null,
    imageVersion: env.ImageVersion ?? null,
    runnerOS: env.RUNNER_OS ?? null,
    runnerArchitecture: env.RUNNER_ARCH ?? null,
    nodeVersion: process.version,
    buildInfo: buildInfo ?? null,
    plannedOrder: env.PI_SESSION_SWITCH_BLOCK_ORDER ?? null,
    blockPosition: env.PI_SESSION_SWITCH_BLOCK_POSITION ?? null,
    fixture:
      'Original real-Pi local-provider fixture: A/B history and drafts, 12 alternating switches (2 warmup + 10 formal), PID reuse, idle-exit/reconnect, unrelated-banner and page-error checks. Fresh fixture and process each block; IDs vary.',
  };
}
