import { existsSync } from 'fs';
import os from 'os';
import path from 'path';

const DEFAULT_WORKSPACES_ROOT_CANDIDATES = [
  'workspace',
  'Workspace',
  'Projects',
  'Development',
  'Dev',
  'Code',
].map((dirName) => path.join(os.homedir(), dirName));

export function getDefaultWorkspacesRoot() {
  const existingCandidate = DEFAULT_WORKSPACES_ROOT_CANDIDATES.find((candidate) => existsSync(candidate));
  return existingCandidate || DEFAULT_WORKSPACES_ROOT_CANDIDATES[0];
}

export function getConfiguredWorkspacesRoot() {
  return process.env.WORKSPACES_ROOT || getDefaultWorkspacesRoot();
}

export function getLegacyWorkspaceRootForUserId(userId, workspacesRoot = getConfiguredWorkspacesRoot()) {
  const normalizedUserId = String(userId ?? '').trim();
  if (!normalizedUserId) {
    throw new Error('A valid user ID is required to resolve the legacy workspace root');
  }

  return path.join(workspacesRoot, 'users', normalizedUserId, 'workspaces');
}

export function getWorkspaceRootForPublicId(publicId, workspacesRoot = getConfiguredWorkspacesRoot()) {
  const normalizedPublicId = String(publicId ?? '').trim();
  if (!normalizedPublicId) {
    throw new Error('A valid public workspace identifier is required to resolve the workspace root');
  }

  return path.join(workspacesRoot, 'users', normalizedPublicId, 'workspaces');
}

export function normalizeLegacyWorkspacePath(projectPath, legacyRoot, workspaceRoot) {
  if (!projectPath || typeof projectPath !== 'string' || !legacyRoot || !workspaceRoot || legacyRoot === workspaceRoot) {
    return projectPath;
  }

  if (projectPath === legacyRoot || projectPath.startsWith(`${legacyRoot}${path.sep}`)) {
    return path.join(workspaceRoot, projectPath.slice(legacyRoot.length).replace(/^[/\\]+/, ''));
  }

  return projectPath;
}
