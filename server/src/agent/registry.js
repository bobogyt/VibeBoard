const tools = new Map()

export function registerTool(tool) {
  tools.set(tool.name, tool)
}

export function getTool(name) {
  return tools.get(name) ?? null
}

/** 汇总为 OpenAI 兼容 tools 数组,发给 GLM */
export function listSchemas() {
  return [...tools.values()].map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }))
}
