import http from 'http';
import { spawn } from 'child_process';
import path from 'path';
import fetch from 'node-fetch';

const runtimeProcesses = new Map();

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function allocatePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
    server.on('error', reject);
  });
}

async function waitForHealth(port, healthPath = '/', timeoutMs = 30000) {
  const startedAt = Date.now();
  const url = `http://127.0.0.1:${port}${healthPath.startsWith('/') ? healthPath : `/${healthPath}`}`;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (response.ok || response.status < 500) {
        return;
      }
    } catch {
      // Service may still be booting.
    }
    await wait(1000);
  }

  throw new Error(`Runtime did not become healthy within ${timeoutMs}ms`);
}

function toAbsolutePath(projectPath, cwd) {
  if (!cwd) {
    return projectPath;
  }

  return path.isAbsolute(cwd) ? cwd : path.resolve(projectPath, cwd);
}

export async function startWorkflowRuntime(workflow, runtimeConfig) {
  if (!workflow || !runtimeConfig || runtimeConfig.type !== 'process' || !runtimeConfig.startCommand) {
    return null;
  }

  const existing = runtimeProcesses.get(workflow.id);
  if (existing) {
    await stopWorkflowRuntime(workflow.id);
  }

  const port = Number.isInteger(runtimeConfig.port) ? runtimeConfig.port : await allocatePort();
  const cwd = toAbsolutePath(workflow.projectPath, runtimeConfig.cwd);

  const runtimeProcess = spawn('sh', ['-c', runtimeConfig.startCommand], {
    cwd,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DELIVERY_WORKFLOW_ID: workflow.id,
      DELIVERY_BASE_PATH: `/runtime/${workflow.id}`,
      DELIVERY_WS_PATH: `/runtime-ws/${workflow.id}`,
      DELIVERY_PREVIEW_PATH: `/preview/${workflow.id}/uat/`,
      DELIVERY_PROJECT_PATH: workflow.projectPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdoutBuffer = '';
  let stderrBuffer = '';

  runtimeProcess.stdout?.on('data', (data) => {
    stdoutBuffer += data.toString();
  });

  runtimeProcess.stderr?.on('data', (data) => {
    stderrBuffer += data.toString();
  });

  runtimeProcesses.set(workflow.id, {
    process: runtimeProcess,
    port,
    cwd,
    config: runtimeConfig,
    startedAt: new Date().toISOString(),
    stdout: () => stdoutBuffer,
    stderr: () => stderrBuffer,
  });

  runtimeProcess.on('exit', () => {
    runtimeProcesses.delete(workflow.id);
  });

  try {
    await waitForHealth(port, runtimeConfig.healthPath || '/', runtimeConfig.timeoutMs || 30000);
  } catch (error) {
    await stopWorkflowRuntime(workflow.id);
    throw error;
  }

  return {
    type: 'process',
    port,
    cwd,
    startCommand: runtimeConfig.startCommand,
    healthPath: runtimeConfig.healthPath || '/',
    publicUrl: `/runtime/${workflow.id}/`,
    webSocketUrl: `/runtime-ws/${workflow.id}`,
  };
}

export async function stopWorkflowRuntime(workflowId) {
  const runtime = runtimeProcesses.get(workflowId);
  if (!runtime) {
    return;
  }

  await new Promise((resolve) => {
    const cleanup = () => {
      clearTimeout(forceKillTimer);
      runtimeProcesses.delete(workflowId);
      resolve();
    };

    runtime.process.once('exit', cleanup);
    runtime.process.kill('SIGTERM');

    const forceKillTimer = setTimeout(() => {
      if (runtimeProcesses.has(workflowId)) {
        runtime.process.kill('SIGKILL');
        cleanup();
      }
    }, 5000);
  });
}

export function getWorkflowRuntime(workflowId) {
  const runtime = runtimeProcesses.get(workflowId);
  if (!runtime) {
    return null;
  }

  return {
    port: runtime.port,
    cwd: runtime.cwd,
    config: runtime.config,
    startedAt: runtime.startedAt,
    stdout: runtime.stdout(),
    stderr: runtime.stderr(),
  };
}

export function getWorkflowRuntimePort(workflowId) {
  return runtimeProcesses.get(workflowId)?.port ?? null;
}
