import { bindDomainRepositories } from '../repositories/domain-repositories.js';
import { withConnection } from '../transaction.js';

function createContext(client) {
  const repositories = bindDomainRepositories(client);

  return {
    client,
    repository: repositories.dashboard,
  };
}

export function createDashboardAdminDbAdapter(pool) {
  return {
    withConnection: (callback) =>
      withConnection(pool, async (client) => callback(createContext(client))),
  };
}
