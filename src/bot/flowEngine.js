export function buildFlowState(flow, stageIndex = 0) {
  return {
    flowId: flow?.id || null,
    flowName: flow?.name || "",
    stageIndex
  };
}

export function nextFlowStage(flow, state) {
  if (!flow || !Array.isArray(flow.stages)) return null;
  const nextIndex = (state?.stageIndex ?? -1) + 1;
  if (nextIndex >= flow.stages.length) return null;
  const stage = flow.stages[nextIndex];
  const message = typeof stage === "string" ? stage : stage?.message;
  return { nextIndex, message };
}
