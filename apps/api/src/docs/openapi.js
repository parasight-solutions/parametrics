export const openapiSpec = {
  openapi: "3.0.0",
  info: { title: "Parametrics API", version: "1.0.0" },
  servers: [{ url: "http://localhost:5050" }],
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } }
  },
  paths: {
    "/api/v1/health": {
      get: {
        summary: "Health",
        responses: { 200: { description: "OK" } }
      }
    },
    "/api/v1/auth/login": {
      post: {
        summary: "Login",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "password"],
                properties: {
                  email: { type: "string", format: "email" },
                  password: { type: "string" }
                }
              }
            }
          }
        },
        responses: { 200: { description: "JWT issued" }, 401: { description: "Invalid credentials" } }
      }
    },
    "/api/v1/demo/enqueue/publish": {
      post: {
        summary: "Enqueue post publish",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: {
            type: "object",
            required: ["postId"],
            properties: { postId: { type: "string" } }
          }}}
        },
        responses: { 200: { description: "Enqueued" }, 400: { description: "Bad request" }, 401: { description: "Unauthorized" } }
      }
    }
  }
}
