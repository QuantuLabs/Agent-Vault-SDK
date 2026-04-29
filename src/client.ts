import { AgentVaultIdentitiesClient } from "./identities.js";
import { AgentVaultWalletsClient } from "./wallets.js";
import { buildTransaction, prepareTransaction } from "./transactions.js";
import { toPublicKey } from "./codec.js";
import { AGENT_VAULT_PROGRAM_ID, DEVNET_RELEASE_MANIFEST } from "./constants.js";
import type { AgentVaultClientConfig, BuildTransactionOptions, PreparedVaultTransaction } from "./types.js";

export class AgentVaultClient {
  readonly identities: AgentVaultIdentitiesClient;
  readonly wallets: AgentVaultWalletsClient;

  constructor(readonly config: AgentVaultClientConfig) {
    const releaseManifest = config.releaseManifest ?? DEVNET_RELEASE_MANIFEST;
    const programId = config.programId ? toPublicKey(config.programId) : AGENT_VAULT_PROGRAM_ID;
    const registryProgram = config.registryProgram
      ? toPublicKey(config.registryProgram)
      : toPublicKey(releaseManifest.expectedGlobalConfig.registryProgram);

    this.wallets = new AgentVaultWalletsClient(config.connection, {
      programId,
      registryProgram,
      releaseManifest,
    });
    this.identities = new AgentVaultIdentitiesClient(this.wallets.pdas, config.identity);
  }

  static devnet(config: Omit<AgentVaultClientConfig, "releaseManifest">): AgentVaultClient {
    return new AgentVaultClient({
      ...config,
      releaseManifest: DEVNET_RELEASE_MANIFEST,
    });
  }

  transaction(options: BuildTransactionOptions) {
    return buildTransaction(options);
  }

  async prepare(options: BuildTransactionOptions): Promise<PreparedVaultTransaction> {
    return prepareTransaction(this.config.connection, options);
  }

  async tx(options: BuildTransactionOptions) {
    const prepared = await this.prepare(options);
    return prepared.transaction;
  }
}

export function createAgentVaultClient(config: AgentVaultClientConfig): AgentVaultClient {
  return new AgentVaultClient(config);
}
