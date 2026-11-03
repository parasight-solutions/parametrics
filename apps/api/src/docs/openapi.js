export const openapiSpec = {
  openapi: "3.0.0",
  info: { title: "Parametrics API", version: "1.0.0" },
  servers: [{ url: "http://localhost:5050" }],
  components: {
    securitySchemes: {
      cookieAuth: { type: "apiKey", in: "cookie", name: "pm_session" }
    }
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
        responses: { 200: { description: "Session cookie set and user returned" }, 401: { description: "Invalid credentials" } }
      }
    },
    "/api/v1/auth/session": {
      get: {
        summary: "Restore the authenticated user",
        security: [{ cookieAuth: [] }],
        responses: { 200: { description: "Current user" }, 401: { description: "Unauthorized" } }
      }
    },
    "/api/v1/auth/logout": {
      post: {
        summary: "Revoke the current session and clear its cookie",
        responses: { 204: { description: "Logged out" } }
      }
    },
    "/api/v1/demo/enqueue/publish": {
      post: {
        summary: "Enqueue post publish",
        security: [{ cookieAuth: [] }],
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
