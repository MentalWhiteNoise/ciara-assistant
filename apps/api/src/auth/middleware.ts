// Authentication middleware for Fastify.
//
// Fastify uses a "preHandler" hook pattern.
// We register `authenticate` as a decorator on the app instance,
// then attach it to any route that requires auth:
//
//   app.get("/api/transactions", { preHandler: [app.authenticate] }, handler)
//
// How JWT verification works:
//   1. Client sends "Authorization: Bearer <access_token>" header
//   2. @fastify/jwt verifies the token signature and expiry
//   3. If valid, request.user is populated with the token payload
//   4. If invalid/expired, a 401 is returned automatically

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

export function registerAuthMiddleware(app: FastifyInstance) {
  // Decorate the app with an `authenticate` function.
  // "Decorating" means adding a method to Fastify's app/request/reply objects.
  app.decorate(
    "authenticate",
    async function (request: FastifyRequest, reply: FastifyReply) {
      try {
        await request.jwtVerify(); // provided by @fastify/jwt
      } catch (err) {
        reply.send(err); // @fastify/jwt formats the 401 error automatically
      }
    }
  );
}

// TypeScript type augmentation — tells TypeScript that FastifyInstance
// now has an `authenticate` method. Without this, TypeScript would complain.
declare module "fastify" {
  interface FastifyInstance {
    authenticate: (
      request: FastifyRequest,
      reply: FastifyReply
    ) => Promise<void>;
  }
}
