import express from 'express';
import {
  completeDeliveryWorkflow,
  confirmDeliveryWorkflow,
  createDeliveryWorkflow,
  getDeliveryWorkflowForUser,
  getDeliveryWorkflowsForProject,
  submitDeliveryWorkflowFeedback,
} from '../services/delivery-orchestrator.js';

const router = express.Router();

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
