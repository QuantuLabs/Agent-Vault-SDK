import { PublicKey } from "@solana/web3.js";
import { SolanaSDK } from "8004-solana";
import { AgentVaultPdas } from "./pda.js";
import type { IdentitySdk, PublicKeyish } from "./types.js";

export class AgentVaultIdentitiesClient {
  constructor(
    private readonly pdas: AgentVaultPdas,
    private readonly identity?: IdentitySdk,
  ) {}

  static create8004Sdk(config: ConstructorParameters<typeof SolanaSDK>[0]): SolanaSDK {
    return new SolanaSDK(config);
  }

  requireIdentitySdk(): IdentitySdk {
    if (!this.identity) {
      throw new Error("8004-solana identity SDK is required for agent registration");
    }
    return this.identity;
  }

  getAgentAccountPda(agentAsset: PublicKeyish): [PublicKey, number] {
    return this.pdas.agentAccount(agentAsset);
  }
}
