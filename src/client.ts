import { AgentVaultIdentitiesClient } from "./identities.js";
import { AgentVaultWalletsClient } from "./wallets.js";
import { toPublicKey } from "./codec.js";
import { AGENT_VAULT_PROGRAM_ID, DEVNET_RELEASE_MANIFEST } from "./constants.js";
import type { AgentVaultClientConfig } from "./types.js";

export class AgentVaultClient {
  readonly identities: AgentVaultIdentitiesClient;
  readonly wallets: AgentVaultWalletsClient;

  constructor(readonly config: AgentVaultClientConfig) {
    const releaseManifest = config.releaseManifest ?? DEVNET_RELEASE_MANIFEST;
    const programId = config.programId ? toPublicKey(config.programId) : AGENT_VAULT_PROGRAM_ID;
    const registryProgram = config.registryProgram
      ? toPublicKey(config.registryProgram)
      : toPublicKey(releaseManifest.expectedGlobalConfig.registryProgram);

    const walletParams: ConstructorParameters<typeof AgentVaultWalletsClient>[1] = {
      programId,
      registryProgram,
      releaseManifest,
    };
    if (config.signer !== undefined) {
      walletParams.signer = config.signer;
    }
    if (config.allowUnverifiedDeployment !== undefined) {
      walletParams.allowUnverifiedDeployment = config.allowUnverifiedDeployment;
    }

    this.wallets = new AgentVaultWalletsClient(config.connection, walletParams);
    this.identities = new AgentVaultIdentitiesClient(this.wallets.pdas, config.identity);
  }

  static devnet(config: Omit<AgentVaultClientConfig, "releaseManifest">): AgentVaultClient {
    return new AgentVaultClient({
      ...config,
      releaseManifest: DEVNET_RELEASE_MANIFEST,
    });
  }

}

export function createAgentVaultClient(config: AgentVaultClientConfig): AgentVaultClient {
  return new AgentVaultClient(config);
}
