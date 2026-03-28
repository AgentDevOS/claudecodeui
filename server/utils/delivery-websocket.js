let deliveryWebSocketServer = null;

export function setDeliveryWebSocketServer(wss) {
  deliveryWebSocketServer = wss;
}

export function broadcastDeliveryWorkflowUpdate(workflow, extra = {}) {
  if (!deliveryWebSocketServer || !workflow) {
    return;
  }

  const message = {
    type: 'delivery-workflow-updated',
    workflowId: workflow.id,
    projectName: workflow.projectName,
    stage: workflow.stage,
    status: workflow.status,
    updatedAt: workflow.updatedAt,
    summary: workflow.latestSummary,
    ...extra,
    timestamp: new Date().toISOString(),
  };

  deliveryWebSocketServer.clients.forEach((client) => {
    if (client.readyState === 1) {
      try {
        client.send(JSON.stringify(message));
      } catch (error) {
        console.error('Error sending delivery workflow update:', error);
      }
    }
  });
}
