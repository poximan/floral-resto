import { bindDomainRepositories } from '../repositories/domain-repositories.js';
import { withConnection, withTransaction } from '../transaction.js';

function createContext(client) {
  const repositories = bindDomainRepositories(client);

  return {
    client,
    repository: repositories.mesaAdmin,
  };
}

export function createMesaAdminDbAdapter(pool) {
  return {
    withConnection: (callback) =>
      withConnection(pool, async (client) => callback(createContext(client))),
    withTransaction: (callback) =>
      withTransaction(pool, async (client) => callback(createContext(client))),
  };
}
