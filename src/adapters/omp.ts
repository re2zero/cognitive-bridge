/**
 * omp 适配器：将 CognitiveBridge 接入 omp 的 MCP 服务器。
 * 
 * omp 使用 MCP 协议，插件作为 MCP 服务器运行。
 * 参考：~/.config/omp/config.json
 */
import type { MCPMessage, MCPResponse } from '../types.js';
import { CognitiveBridge } from '../core.js';

// ── 适配器实现 ──

export function createOmpMcpServer(bridge: CognitiveBridge): {
  handleMessage(msg: MCPMessage): MCPResponse;
} {
  const LOG_TAG = '[cognitive-bridge:omp]';

  return {
    handleMessage(msg: MCPMessage): MCPResponse {
      switch (msg.method) {
        case 'initialize':
          return {
            result: {
              protocolVersion: '2024-11-05',
              capabilities: {},
              serverInfo: {
                name: 'cognitive-bridge',
                version: '0.1.0'
              }
            },
            id: msg.id
          };

        case 'tools/list':
          return {
            result: {
              tools: [
                {
                  name: 'get_cognitive_state',
                  description: '获取当前认知状态（情绪、激活度、轮次）',
                  inputSchema: {
                    type: 'object',
                    properties: {}
                  }
                },
                {
                  name: 'get_narrative',
                  description: '获取当前叙事锚点',
                  inputSchema: {
                    type: 'object',
                    properties: {}
                  }
                }
              ]
            },
            id: msg.id
          };

        case 'tools/call': {
          const toolName = msg.params?.name;
          if (toolName === 'get_cognitive_state') {
            return {
              result: {
                content: [{
                  type: 'text',
                  text: JSON.stringify(bridge.currentState, null, 2)
                }]
              },
              id: msg.id
            };
          }
          if (toolName === 'get_narrative') {
            const narrative = bridge.generateNarrative();
            return {
              result: {
                content: [{
                  type: 'text',
                  text: narrative
                }]
              },
              id: msg.id
            };
          }
          return {
            error: { code: -32601, message: `Unknown tool: ${toolName}` },
            id: msg.id
          };
        }

        default:
          return {
            error: { code: -32601, message: `Method not found: ${msg.method}` },
            id: msg.id
          };
      }
    }
  };
}
