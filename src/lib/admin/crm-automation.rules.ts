export type AutomationStopRules = {
  stop_on_reply: boolean;
  stop_on_final_stage: boolean;
  avoid_conflicts: boolean;
  on_reply_move_stage_enabled: boolean;
  on_reply_move_stage: string | null;
};

export function defaultStopRules(value?: Record<string, unknown>): AutomationStopRules {
  return {
    stop_on_reply: value?.stop_on_reply !== false,
    stop_on_final_stage: value?.stop_on_final_stage !== false,
    avoid_conflicts: value?.avoid_conflicts !== false,
    on_reply_move_stage_enabled: value?.on_reply_move_stage_enabled === true,
    on_reply_move_stage:
      typeof value?.on_reply_move_stage === "string" && value.on_reply_move_stage
        ? value.on_reply_move_stage
        : null,
  };
}

export function shouldStopForLead(
  rules: AutomationStopRules,
  pipelineStage: string | null | undefined,
  hasNewReply: boolean,
) {
  if (rules.stop_on_final_stage && (pipelineStage === "fechado" || pipelineStage === "descartado"))
    return "final_stage";
  if (rules.stop_on_reply && hasNewReply) return "lead_replied";
  return null;
}
