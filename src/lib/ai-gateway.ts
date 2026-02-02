/**
 * Cloudflare AI Gateway routing for Anthropic and Bedrock
 */

import type { Env, AIProvider, TenantConfig } from './types';

// =============================================================================
// AI Gateway Configuration
// =============================================================================

export interface AIGatewayOptions {
  provider: AIProvider;
  model?: string;
  region?: string;
}

export function getAIGatewayUrl(env: Env, options: AIGatewayOptions): string {
  const baseUrl = `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.AI_GATEWAY_ID}`;

  switch (options.provider) {
    case 'anthropic':
      return `${baseUrl}/anthropic`;
    case 'bedrock':
      // Bedrock routing includes region in path
      const region = options.region || 'us-east-1';
      return `${baseUrl}/aws-bedrock/bedrock-runtime/${region}`;
    default:
      return `${baseUrl}/anthropic`;
  }
}

export function getProviderFromConfig(config: TenantConfig): AIGatewayOptions {
  const ai = config.ai || { provider: 'anthropic' };

  return {
    provider: ai.provider,
    model: ai.bedrock_model,
    region: ai.bedrock_region,
  };
}

// =============================================================================
// Request Transformation
// =============================================================================

export interface ProxyRequestOptions {
  method: string;
  path: string;
  headers: Headers;
  body?: string;
}

export function transformAnthropicRequest(
  request: Request,
  env: Env
): ProxyRequestOptions {
  const requestUrl = new URL(request.url);
  const gatewayUrl = getAIGatewayUrl(env, { provider: 'anthropic' });

  // Extract API path (e.g., /v1/messages -> /v1/messages)
  const apiPath = requestUrl.pathname.replace('/api/anthropic', '');

  const headers = new Headers(request.headers);
  // Cloudflare AI Gateway handles auth, but we pass through for direct calls
  headers.set('cf-aig-skip-cache', 'true');

  return {
    method: request.method,
    path: `${gatewayUrl}${apiPath}`,
    headers,
    body: undefined, // Will be set by caller
  };
}

export function transformBedrockRequest(
  _request: Request,
  config: TenantConfig,
  env: Env
): ProxyRequestOptions {
  const options = getProviderFromConfig(config);
  const gatewayUrl = getAIGatewayUrl(env, options);

  // Transform Anthropic-style request to Bedrock format
  const model = options.model || 'anthropic.claude-3-sonnet-20240229-v1:0';
  const apiPath = `/model/${model}/invoke`;

  const headers = new Headers();
  headers.set('Content-Type', 'application/json');
  headers.set('cf-aig-skip-cache', 'true');

  return {
    method: 'POST',
    path: `${gatewayUrl}${apiPath}`,
    headers,
    body: undefined,
  };
}

// =============================================================================
// Response Transformation
// =============================================================================

export function transformBedrockResponse(
  bedrockResponse: BedrockInvokeResponse
): AnthropicResponse {
  // Transform Bedrock response format to Anthropic format
  return {
    id: `msg_${crypto.randomUUID().replace(/-/g, '')}`,
    type: 'message',
    role: 'assistant',
    content: [
      {
        type: 'text',
        text: bedrockResponse.content?.[0]?.text || '',
      },
    ],
    model: bedrockResponse.model || 'claude-3-sonnet',
    stop_reason: bedrockResponse.stop_reason || 'end_turn',
    usage: {
      input_tokens: bedrockResponse.usage?.input_tokens || 0,
      output_tokens: bedrockResponse.usage?.output_tokens || 0,
    },
  };
}

// =============================================================================
// Proxy Handler
// =============================================================================

export async function proxyToAIGateway(
  request: Request,
  config: TenantConfig,
  env: Env
): Promise<Response> {
  const provider = config.ai?.provider || 'anthropic';

  try {
    if (provider === 'bedrock') {
      return await proxyToBedrock(request, config, env);
    }
    return await proxyToAnthropic(request, env);
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: {
          type: 'api_error',
          message: error instanceof Error ? error.message : 'AI Gateway error',
        },
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

async function proxyToAnthropic(request: Request, env: Env): Promise<Response> {
  const options = transformAnthropicRequest(request, env);
  const body = await request.text();

  const response = await fetch(options.path, {
    method: options.method,
    headers: options.headers,
    body: body || undefined,
  });

  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
}

async function proxyToBedrock(
  request: Request,
  config: TenantConfig,
  env: Env
): Promise<Response> {
  const options = transformBedrockRequest(request, config, env);

  // Transform request body from Anthropic format to Bedrock format
  const anthropicBody = await request.json() as AnthropicRequest;
  const bedrockBody = transformToBedrockFormat(anthropicBody);

  const response = await fetch(options.path, {
    method: 'POST',
    headers: options.headers,
    body: JSON.stringify(bedrockBody),
  });

  if (!response.ok) {
    return response;
  }

  // Transform response back to Anthropic format
  const bedrockResponse = await response.json() as BedrockInvokeResponse;
  const anthropicResponse = transformBedrockResponse(bedrockResponse);

  return new Response(JSON.stringify(anthropicResponse), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function transformToBedrockFormat(anthropicRequest: AnthropicRequest): BedrockInvokeRequest {
  return {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: anthropicRequest.max_tokens || 4096,
    messages: anthropicRequest.messages,
    system: anthropicRequest.system,
    temperature: anthropicRequest.temperature,
    top_p: anthropicRequest.top_p,
  };
}

// =============================================================================
// Types
// =============================================================================

interface AnthropicRequest {
  model: string;
  max_tokens?: number;
  messages: Array<{ role: string; content: string }>;
  system?: string;
  temperature?: number;
  top_p?: number;
}

interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{ type: string; text: string }>;
  model: string;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

interface BedrockInvokeRequest {
  anthropic_version: string;
  max_tokens: number;
  messages: Array<{ role: string; content: string }>;
  system?: string;
  temperature?: number;
  top_p?: number;
}

interface BedrockInvokeResponse {
  content?: Array<{ type: string; text: string }>;
  model?: string;
  stop_reason?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}
