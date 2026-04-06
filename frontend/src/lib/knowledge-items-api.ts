/** 与 PostgREST 错误文案匹配，用于缺表时的提示 */
export function isKnowledgeTableMissingMessage(message: string) {
  return (
    message.includes("knowledge_items") &&
    (message.includes("does not exist") || message.includes("schema cache"))
  );
}
