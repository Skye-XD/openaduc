// SPDX-License-Identifier: BUSL-1.1
import fp from 'fastify-plugin';
import { v4 as uuid } from 'uuid';

declare module 'fastify' {
  interface FastifyRequest {
    correlationId: string;
  }
}

export default fp(async (app) => {
  app.addHook('onRequest', async (req, reply) => {
    const incoming = req.headers['x-correlation-id'];
    // Taken from the client only when it looks like an id: it is stored in every audit row.
    const id =
      typeof incoming === 'string' && /^[A-Za-z0-9._:-]{1,100}$/.test(incoming) ? incoming : uuid();
    req.correlationId = id;
    reply.header('x-correlation-id', id);
  });
});
