import express from 'express';
import path from 'path';
import { promises as fs } from 'fs';
import {
  completeDeliveryWorkflow,
  confirmDeliveryWorkflow,
  createDeliveryWorkflow,
  getDeliveryWorkflowForSession,
  getDeliveryWorkflowForUser,
  getDeliveryWorkflowsForProject,
  getWorkflowPreviewDirectory,
  reviseDeliveryWorkflow,
  retryDeliveryWorkflow,
  submitDeliveryWorkflowFeedback,
} from '../services/delivery-orchestrator.js';

const router = express.Router();

function appendTokenToAssetUrl(assetUrl, token) {
  if (!assetUrl || !token || typeof assetUrl !== 'string') {
    return assetUrl;
  }

  const trimmed = assetUrl.trim();
  if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:') || trimmed.startsWith('#')) {
    return assetUrl;
  }

  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)) {
    return assetUrl;
  }

  if (trimmed.includes('token=')) {
    return assetUrl;
  }

  const separator = trimmed.includes('?') ? '&' : '?';
  return `${trimmed}${separator}token=${encodeURIComponent(token)}`;
}

function injectPreviewTokenIntoHtml(html, token) {
  if (!html || !token) {
    return html;
  }

  return html.replace(
    /\b(href|src)=["']([^"']+)["']/gi,
    (match, attribute, assetUrl) => `${attribute}="${appendTokenToAssetUrl(assetUrl, token)}"`,
  );
}

async function sendPreviewFile(req, res, filePath) {
  if (path.extname(filePath).toLowerCase() === '.html' && typeof req.query.token === 'string' && req.query.token.trim()) {
    const html = await fs.readFile(filePath, 'utf8');
    res.type('html');
    return res.send(injectPreviewTokenIntoHtml(html, req.query.token.trim()));
  }

  return res.sendFile(filePath);
}

async function resolvePreviewFile(rootDir, requestedPath = '') {
  const normalizedRoot = path.resolve(rootDir);
  const sanitized = requestedPath.replace(/^\/+/, '');
  const directPath = path.resolve(normalizedRoot, sanitized || 'index.html');

  if (!directPath.startsWith(normalizedRoot)) {
    return null;
  }

  try {
    const stat = await fs.stat(directPath);
    if (stat.isDirectory()) {
      const indexFile = path.join(directPath, 'index.html');
      await fs.access(indexFile);
      return indexFile;
    }

    return directPath;
  } catch {
    const fallbackFile = path.join(normalizedRoot, 'index.html');
    try {
      await fs.access(fallbackFile);
      return fallbackFile;
    } catch {
      return null;
    }
  }
}

router.get('/', (req, res) => {
  try {
    const { projectName } = req.query;
    if (!projectName) {
      return res.status(400).json({ error: 'projectName is required' });
    }

    const workflows = getDeliveryWorkflowsForProject(req.user.id, String(projectName));
    return res.json({ workflows });
  } catch (error) {
    console.error('Failed to list delivery workflows:', error);
    return res.status(500).json({ error: 'Failed to list delivery workflows', details: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { projectName, projectPath, title, requirementText, provider = 'codex' } = req.body;

    if (!projectName || !projectPath || !requirementText) {
      return res.status(400).json({ error: 'projectName, projectPath, and requirementText are required' });
    }

    const workflow = await createDeliveryWorkflow({
      userId: req.user.id,
      projectName,
      projectPath,
      title,
      requirementText,
      provider,
    });

    return res.status(201).json({ workflow });
  } catch (error) {
    console.error('Failed to create delivery workflow:', error);
    return res.status(500).json({ error: 'Failed to create delivery workflow', details: error.message });
  }
});

router.get('/session/:sessionId', (req, res) => {
  try {
    const workflow = getDeliveryWorkflowForSession(req.params.sessionId, req.user.id);
    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found' });
    }
    return res.json({ workflow });
  } catch (error) {
    console.error('Failed to load delivery workflow for session:', error);
    return res.status(500).json({ error: 'Failed to load delivery workflow for session', details: error.message });
  }
});

router.get('/:workflowId/preview/:target', async (req, res) => {
  try {
    const { workflowId, target } = req.params;
    const previewDir = getWorkflowPreviewDirectory(workflowId, target);
    if (!previewDir) {
      return res.status(404).json({ error: 'Preview not found' });
    }

    const filePath = await resolvePreviewFile(previewDir);
    if (!filePath) {
      return res.status(404).json({ error: 'Preview file not found' });
    }

    return sendPreviewFile(req, res, filePath);
  } catch (error) {
    console.error('Failed to serve delivery preview via API:', error);
    return res.status(500).json({ error: 'Failed to serve preview', details: error.message });
  }
});

router.get('/:workflowId/preview/:target/*', async (req, res) => {
  try {
    const { workflowId, target } = req.params;
    const previewDir = getWorkflowPreviewDirectory(workflowId, target);
    if (!previewDir) {
      return res.status(404).json({ error: 'Preview not found' });
    }

    const requestedPath = req.params[0] || '';
    const filePath = await resolvePreviewFile(previewDir, requestedPath);
    if (!filePath) {
      return res.status(404).json({ error: 'Preview file not found' });
    }

    return sendPreviewFile(req, res, filePath);
  } catch (error) {
    console.error('Failed to serve delivery preview asset via API:', error);
    return res.status(500).json({ error: 'Failed to serve preview asset', details: error.message });
  }
});

router.get('/:workflowId', (req, res) => {
  try {
    const workflow = getDeliveryWorkflowForUser(req.params.workflowId, req.user.id);
    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found' });
    }
    return res.json({ workflow });
  } catch (error) {
    console.error('Failed to load delivery workflow:', error);
    return res.status(500).json({ error: 'Failed to load delivery workflow', details: error.message });
  }
});

router.post('/:workflowId/revise', async (req, res) => {
  try {
    const { content } = req.body;
    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'revision content is required' });
    }

    const workflow = await reviseDeliveryWorkflow(req.params.workflowId, req.user.id, content.trim());
    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found' });
    }
    return res.json({ workflow });
  } catch (error) {
    console.error('Failed to submit delivery workflow revision:', error);
    return res.status(400).json({ error: error.message || 'Failed to submit delivery workflow revision' });
  }
});

router.post('/:workflowId/retry', async (req, res) => {
  try {
    const workflow = await retryDeliveryWorkflow(req.params.workflowId, req.user.id);
    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found' });
    }
    return res.json({ workflow });
  } catch (error) {
    console.error('Failed to retry delivery workflow:', error);
    return res.status(400).json({ error: error.message || 'Failed to retry delivery workflow' });
  }
});

router.post('/:workflowId/confirm', async (req, res) => {
  try {
    const workflow = await confirmDeliveryWorkflow(req.params.workflowId, req.user.id);
    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found' });
    }
    return res.json({ workflow });
  } catch (error) {
    console.error('Failed to confirm delivery workflow:', error);
    return res.status(400).json({ error: error.message || 'Failed to confirm delivery workflow' });
  }
});

router.post('/:workflowId/feedback', async (req, res) => {
  try {
    const { content } = req.body;
    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'feedback content is required' });
    }

    const workflow = await submitDeliveryWorkflowFeedback(req.params.workflowId, req.user.id, content.trim());
    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found' });
    }
    return res.json({ workflow });
  } catch (error) {
    console.error('Failed to submit delivery workflow feedback:', error);
    return res.status(400).json({ error: error.message || 'Failed to submit delivery workflow feedback' });
  }
});

router.post('/:workflowId/complete', async (req, res) => {
  try {
    const workflow = await completeDeliveryWorkflow(req.params.workflowId, req.user.id);
    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found' });
    }
    return res.json({ workflow });
  } catch (error) {
    console.error('Failed to complete delivery workflow:', error);
    return res.status(400).json({ error: error.message || 'Failed to complete delivery workflow' });
  }
});

export default router;
