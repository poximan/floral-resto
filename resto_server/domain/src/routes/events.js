import { subscribeDomainEvents } from '../services/domain-event-service.js';

const streamKeepaliveMs = 15_000;

export async function eventRoutes(app) {
  app.get('/internal/events/stream', async (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });

    reply.raw.write(': connected\n\n');

    const unsubscribe = subscribeDomainEvents((message) => {
      reply.raw.write(`event: domain\ndata: ${message}\n\n`);
    });

    const keepaliveId = setInterval(() => {
      reply.raw.write(': keepalive\n\n');
    }, streamKeepaliveMs);

    const cleanup = () => {
      clearInterval(keepaliveId);
      unsubscribe();
    };

    request.raw.on('close', cleanup);
    request.raw.on('error', cleanup);
  });
}
