import { PublicKey } from "@solana/web3.js";
import { buildRegistrationFileJson } from "8004-solana";
import { AgentVaultIdentitiesClient } from "./identities.js";
import { AgentVaultWalletsClient } from "./wallets.js";
import { toPublicKey } from "./codec.js";
import { AGENT_VAULT_PROGRAM_ID, DEVNET_RELEASE_MANIFEST } from "./constants.js";
import type {
  AgentMetadataInput,
  AgentVaultAgentScope,
  AgentVaultClientConfig,
  PublicKeyish,
  RegisterAgentOptions,
  RegisterAgentResult,
} from "./types.js";

type RegisterAgent = (uri?: string, options?: Record<string, unknown>) => Promise<unknown>;

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

  async registerAgent(metadataUri?: string, options?: RegisterAgentOptions): Promise<RegisterAgentResult>;
  async registerAgent(
    metadata: AgentMetadataInput,
    options: RegisterAgentOptions & { uploadJson: NonNullable<RegisterAgentOptions["uploadJson"]> },
  ): Promise<RegisterAgentResult>;
  async registerAgent(
    metadataOrUri?: string | AgentMetadataInput,
    options: RegisterAgentOptions = {},
  ): Promise<RegisterAgentResult> {
    const identity = this.identities.requireIdentitySdk();
    const { metadataUri, metadataJson } = await resolveRegistrationMetadata(metadataOrUri, options);
    const { uploadJson: _uploadJson, metadataJsonOptions: _metadataJsonOptions, ...registerOptions } = options;
    const registerAgent = identity.registerAgent as RegisterAgent;
    const result = await registerAgent.call(identity, metadataUri, registerOptions);
    if (isFailedRegistration(result)) {
      throw new Error(`8004 agent registration failed: ${result.error}`);
    }
    const output: RegisterAgentResult = {
      agentAsset: extractAgentAsset(result, options.assetPubkey),
      result,
    };
    if (metadataUri !== undefined) {
      output.metadataUri = metadataUri;
    }
    if (metadataJson !== undefined) {
      output.metadataJson = metadataJson;
    }
    return output;
  }

  agent(agentAsset: PublicKeyish): AgentVaultAgentScope {
    const asset = toPublicKey(agentAsset);
    return {
      agentAsset: asset,
      wallets: this.wallets.for(asset),
    };
  }

}

export function createAgentVaultClient(config: AgentVaultClientConfig): AgentVaultClient {
  return new AgentVaultClient(config);
}

function extractAgentAsset(result: unknown, fallback?: PublicKey): PublicKey {
  if (fallback) {
    return fallback;
  }
  if (result && typeof result === "object" && "asset" in result) {
    const asset = (result as { asset?: unknown }).asset;
    if (asset instanceof PublicKey) {
      return asset;
    }
    if (typeof asset === "string") {
      return new PublicKey(asset);
    }
  }
  throw new Error("8004 agent registration did not return an agent asset pubkey");
}

function isFailedRegistration(result: unknown): result is { success: false; error: unknown } {
  return Boolean(result && typeof result === "object" && (result as { success?: unknown }).success === false);
}

async function resolveRegistrationMetadata(
  metadataOrUri: string | AgentMetadataInput | undefined,
  options: RegisterAgentOptions,
): Promise<{ metadataUri?: string; metadataJson?: Record<string, unknown> }> {
  if (metadataOrUri === undefined) {
    return {};
  }
  if (typeof metadataOrUri === "string") {
    return { metadataUri: normalizeMetadataUri(metadataOrUri) };
  }

  if (!options.uploadJson) {
    throw new Error("registerAgent(metadata) requires options.uploadJson to create the metadata URI");
  }
  const metadataJson = buildRegistrationFileJson(metadataOrUri, options.metadataJsonOptions);
  const metadataUri = normalizeMetadataUri(await options.uploadJson(metadataJson));
  return { metadataUri, metadataJson };
}

function normalizeMetadataUri(uriOrCid: string): string {
  const value = uriOrCid.trim();
  if (value.length === 0) {
    throw new Error("metadata URI must not be empty");
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    return value;
  }
  return `ipfs://${value}`;
}
