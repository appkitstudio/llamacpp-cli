/**
 * OpenAPI 3.0 specification for llamacpp-cli Admin API
 */
export const openApiSpec = {
  openapi: '3.0.0',
  info: {
    title: 'llamacpp-cli Admin API',
    version: '2.0.0',
    description: `
Remote management API for llamacpp-cli servers.

## Authentication

All endpoints (except \`/health\`) require Bearer token authentication.

\`\`\`
Authorization: Bearer YOUR_API_KEY
\`\`\`

The API key is auto-generated on first start and stored in \`~/.llamacpp/admin.json\`.
    `,
  },
  servers: [
    {
      url: 'http://localhost:9200',
      description: 'Local Admin API (default)',
    },
  ],
  tags: [
    {
      name: 'Servers',
      description: 'Server lifecycle management (CRUD operations)',
    },
    {
      name: 'Models',
      description: 'Model management and HuggingFace downloads',
    },
    {
      name: 'Router',
      description: 'Unified routing service management',
    },
    {
      name: 'System',
      description: 'Health checks and system status',
    },
    {
      name: 'Jobs',
      description: 'Background download job management',
    },
  ],
  paths: {
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Health check',
        description: 'Check API health status (no authentication required)',
        responses: {
          200: {
            description: 'Service is healthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'healthy' },
                    uptime: { type: 'number', example: 3600.5 },
                    timestamp: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/status': {
      get: {
        tags: ['System'],
        summary: 'System status',
        description: 'Get comprehensive system status including all services',
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: 'System status retrieved',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    servers: {
                      type: 'object',
                      properties: {
                        total: { type: 'number' },
                        running: { type: 'number' },
                        stopped: { type: 'number' },
                      },
                    },
                    router: {
                      type: 'object',
                      properties: {
                        running: { type: 'boolean' },
                        port: { type: 'number' },
                      },
                    },
                    models: {
                      type: 'object',
                      properties: {
                        total: { type: 'number' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/servers': {
      get: {
        tags: ['Servers'],
        summary: 'List all servers',
        description: 'Get list of all configured servers with their current status',
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: 'Servers list retrieved',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    servers: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/Server' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Servers'],
        summary: 'Create new server',
        description: 'Create and start a new llama-server instance',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['model'],
                properties: {
                  model: { type: 'string', example: 'llama-3.2-3b-instruct-q4_k_m.gguf' },
                  port: { type: 'number', example: 9001 },
                  host: { type: 'string', example: '127.0.0.1' },
                  threads: { type: 'number', example: 8 },
                  ctxSize: { type: 'number', example: 8192 },
                  gpuLayers: { type: 'number', example: 60 },
                  verbose: { type: 'boolean', example: false },
                  alias: { type: 'string', example: 'thinking' },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Server created successfully',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Server' },
              },
            },
          },
        },
      },
    },
    '/api/servers/{id}': {
      get: {
        tags: ['Servers'],
        summary: 'Get server details',
        description: 'Get detailed information about a specific server',
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'Server ID, alias, port, or model name',
            schema: { type: 'string' },
            example: 'llama-3-2-3b',
          },
        ],
        responses: {
          200: {
            description: 'Server details retrieved',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    server: { $ref: '#/components/schemas/Server' },
                  },
                },
              },
            },
          },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
      patch: {
        tags: ['Servers'],
        summary: 'Update server configuration',
        description: 'Update server settings (requires restart to apply changes)',
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  model: { type: 'string' },
                  host: { type: 'string' },
                  threads: { type: 'number' },
                  ctxSize: { type: 'number' },
                  gpuLayers: { type: 'number' },
                  verbose: { type: 'boolean' },
                  alias: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Server updated successfully',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Server' },
              },
            },
          },
        },
      },
      delete: {
        tags: ['Servers'],
        summary: 'Delete server',
        description: 'Remove server configuration and stop service',
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: 'Server deleted successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    message: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/servers/{id}/start': {
      post: {
        tags: ['Servers'],
        summary: 'Start server',
        description: 'Start a stopped server',
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: 'Server started successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    status: { type: 'string', example: 'running' },
                    pid: { type: 'number' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/servers/{id}/stop': {
      post: {
        tags: ['Servers'],
        summary: 'Stop server',
        description: 'Stop a running server',
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: 'Server stopped successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    message: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/servers/{id}/restart': {
      post: {
        tags: ['Servers'],
        summary: 'Restart server',
        description: 'Restart a server (stop then start)',
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: 'Server restarted successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    message: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/servers/{id}/logs': {
      get: {
        tags: ['Servers'],
        summary: 'Get server logs',
        description: `
Retrieve server logs with flexible filtering.

**Log Types:**
- \`activity\`: HTTP request/response logs (default)
- \`system\`: System diagnostic logs (stderr + stdout)
        `,
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
          {
            name: 'type',
            in: 'query',
            description: 'Log type to retrieve',
            schema: {
              type: 'string',
              enum: ['activity', 'system'],
              default: 'activity',
            },
          },
          {
            name: 'lines',
            in: 'query',
            description: 'Number of lines to return',
            schema: {
              type: 'integer',
              default: 100,
              minimum: 1,
              maximum: 10000,
            },
          },
        ],
        responses: {
          200: {
            description: 'Logs retrieved successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    http: { type: 'string', description: 'HTTP activity logs' },
                    stdout: { type: 'string', description: 'Standard output' },
                    stderr: { type: 'string', description: 'Standard error' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/models': {
      get: {
        tags: ['Models'],
        summary: 'List models',
        description: 'Get list of all available GGUF models',
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: 'Models list retrieved',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    models: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/Model' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/models/{name}': {
      get: {
        tags: ['Models'],
        summary: 'Get model details',
        description: 'Get detailed information about a specific model',
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'name',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            example: 'llama-3.2-3b-instruct-q4_k_m.gguf',
          },
        ],
        responses: {
          200: {
            description: 'Model details retrieved',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    model: { $ref: '#/components/schemas/Model' },
                  },
                },
              },
            },
          },
        },
      },
      delete: {
        tags: ['Models'],
        summary: 'Delete model',
        description: 'Delete a model file from disk (optionally cascade delete servers)',
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'name',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
          {
            name: 'cascade',
            in: 'query',
            description: 'Also delete servers using this model',
            schema: { type: 'boolean', default: false },
          },
        ],
        responses: {
          200: {
            description: 'Model deleted successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    deletedServers: {
                      type: 'array',
                      items: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/models/search': {
      get: {
        tags: ['Models'],
        summary: 'Search HuggingFace',
        description: 'Search for GGUF models on HuggingFace',
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'q',
            in: 'query',
            required: true,
            description: 'Search query',
            schema: { type: 'string' },
            example: 'llama 3b',
          },
          {
            name: 'limit',
            in: 'query',
            description: 'Max results',
            schema: { type: 'integer', default: 20, maximum: 100 },
          },
        ],
        responses: {
          200: {
            description: 'Search results retrieved',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    results: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          name: { type: 'string' },
                          downloads: { type: 'number' },
                          likes: { type: 'number' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/models/download': {
      post: {
        tags: ['Models'],
        summary: 'Download model',
        description: 'Start downloading a model from HuggingFace (returns job ID)',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['repo', 'filename'],
                properties: {
                  repo: { type: 'string', example: 'bartowski/Llama-3.2-3B-Instruct-GGUF' },
                  filename: { type: 'string', example: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Download started',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    jobId: { type: 'string' },
                    status: { type: 'string', example: 'downloading' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/jobs': {
      get: {
        tags: ['Jobs'],
        summary: 'List download jobs',
        description: 'Get all download jobs (active and completed)',
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: 'Jobs list retrieved',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    jobs: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/DownloadJob' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/jobs/{jobId}': {
      get: {
        tags: ['Jobs'],
        summary: 'Get job status',
        description: 'Get detailed status of a download job',
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'jobId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: 'Job status retrieved',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    job: { $ref: '#/components/schemas/DownloadJob' },
                  },
                },
              },
            },
          },
        },
      },
      delete: {
        tags: ['Jobs'],
        summary: 'Cancel download',
        description: 'Cancel an active download job',
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'jobId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: 'Job cancelled',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    message: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/router': {
      get: {
        tags: ['Router'],
        summary: 'Get router status',
        description: 'Get router service status and configuration',
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: 'Router status retrieved',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/RouterInfo' },
              },
            },
          },
        },
      },
      patch: {
        tags: ['Router'],
        summary: 'Update router config',
        description: 'Update router configuration (requires restart)',
        security: [{ BearerAuth: [] }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  port: { type: 'number' },
                  host: { type: 'string' },
                  verbose: { type: 'boolean' },
                  requestTimeout: { type: 'number' },
                  healthCheckInterval: { type: 'number' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Router config updated',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/RouterInfo' },
              },
            },
          },
        },
      },
    },
    '/api/router/start': {
      post: {
        tags: ['Router'],
        summary: 'Start router',
        description: 'Start the router service',
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: 'Router started',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    status: { type: 'string' },
                    pid: { type: 'number' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/router/stop': {
      post: {
        tags: ['Router'],
        summary: 'Stop router',
        description: 'Stop the router service',
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: 'Router stopped',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    message: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/router/restart': {
      post: {
        tags: ['Router'],
        summary: 'Restart router',
        description: 'Restart the router service',
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: 'Router restarted',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    message: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/router/logs': {
      get: {
        tags: ['Router'],
        summary: 'Get router logs',
        description: `
Retrieve router logs with flexible filtering.

**Log Types:**
- \`activity\`: Router request logs (stdout)
- \`system\`: System diagnostic logs (stderr)
- \`both\`: Both activity and system logs
        `,
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'type',
            in: 'query',
            description: 'Log type to retrieve',
            schema: {
              type: 'string',
              enum: ['activity', 'system', 'both'],
              default: 'both',
            },
          },
          {
            name: 'lines',
            in: 'query',
            description: 'Number of lines to return',
            schema: {
              type: 'integer',
              default: 100,
              minimum: 1,
              maximum: 10000,
            },
          },
        ],
        responses: {
          200: {
            description: 'Logs retrieved successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    stdout: { type: 'string', description: 'Activity logs' },
                    stderr: { type: 'string', description: 'System logs' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'API key from ~/.llamacpp/admin.json',
      },
    },
    responses: {
      NotFound: {
        description: 'Resource not found',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                error: { type: 'string' },
                message: { type: 'string' },
                code: { type: 'string' },
              },
            },
          },
        },
      },
      Unauthorized: {
        description: 'Unauthorized - invalid or missing API key',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                error: { type: 'string', example: 'Unauthorized' },
                message: { type: 'string', example: 'Invalid or missing API key' },
                code: { type: 'string', example: 'UNAUTHORIZED' },
              },
            },
          },
        },
      },
    },
    schemas: {
      Server: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'llama-3-2-3b' },
          modelName: { type: 'string', example: 'llama-3.2-3b-instruct-q4_k_m.gguf' },
          modelPath: { type: 'string' },
          port: { type: 'number', example: 9001 },
          host: { type: 'string', example: '127.0.0.1' },
          threads: { type: 'number', example: 8 },
          ctxSize: { type: 'number', example: 8192 },
          gpuLayers: { type: 'number', example: 60 },
          verbose: { type: 'boolean', example: false },
          alias: { type: 'string', example: 'thinking', nullable: true },
          status: {
            type: 'string',
            enum: ['running', 'stopped', 'starting', 'error'],
            example: 'running',
          },
          pid: { type: 'number', example: 12345, nullable: true },
          healthy: { type: 'boolean', example: true, nullable: true },
          httpLogPath: { type: 'string' },
          stderrPath: { type: 'string' },
          stdoutPath: { type: 'string' },
        },
      },
      Model: {
        type: 'object',
        properties: {
          filename: { type: 'string', example: 'llama-3.2-3b-instruct-q4_k_m.gguf' },
          path: { type: 'string' },
          size: { type: 'number', example: 2147483648 },
          sizeFormatted: { type: 'string', example: '2.00 GB' },
          modified: { type: 'string', format: 'date-time' },
          isSharded: { type: 'boolean', example: false },
          shardPaths: { type: 'array', items: { type: 'string' }, nullable: true },
          serversUsing: { type: 'number', example: 2 },
          serverIds: { type: 'array', items: { type: 'string' } },
        },
      },
      RouterInfo: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['running', 'stopped'] },
          pid: { type: 'number', nullable: true },
          config: {
            type: 'object',
            properties: {
              port: { type: 'number', example: 9100 },
              host: { type: 'string', example: '127.0.0.1' },
              verbose: { type: 'boolean' },
              requestTimeout: { type: 'number' },
              healthCheckInterval: { type: 'number' },
            },
          },
        },
      },
      DownloadJob: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          repo: { type: 'string' },
          filename: { type: 'string' },
          status: {
            type: 'string',
            enum: ['downloading', 'completed', 'failed', 'cancelled'],
          },
          progress: { type: 'number', minimum: 0, maximum: 100 },
          downloadedBytes: { type: 'number' },
          totalBytes: { type: 'number' },
          startTime: { type: 'string', format: 'date-time' },
          endTime: { type: 'string', format: 'date-time', nullable: true },
          error: { type: 'string', nullable: true },
        },
      },
    },
  },
};
