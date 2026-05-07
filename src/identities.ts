import { PublicKey } from "@solana/web3.js";
import { SolanaSDK } from "8004-solana";
import { AgentVaultPdas } from "./pda.js";
import type {
  CreateIdentityParams,
  CreateIdentityResult,
  IdentitySdk,
  PublicKeyish,
  RegisterIdentityOptions,
} from "./types.js";

type RegisterAgent = (uri?: string, options?: Record<string, unknown>) => Promise<unknown>;

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
      throw new Error("8004-solana identity SDK is required for identity creation");
    }
    return this.identity;
  }

  getAgentAccountPda(agentAsset: PublicKeyish): [PublicKey, number] {
    return this.pdas.agentAccount(agentAsset);
  }

  async register(): Promise<CreateIdentityResult>;
  async register(params: CreateIdentityParams): Promise<CreateIdentityResult>;
  async register(uri: string, options?: RegisterIdentityOptions): Promise<CreateIdentityResult>;
  async register(
    paramsOrUri?: string | CreateIdentityParams,
    registerOptions: RegisterIdentityOptions = {},
  ): Promise<CreateIdentityResult> {
    const params = normalizeRegisterParams(paramsOrUri, registerOptions);
    const identity = this.requireIdentitySdk();
    const options: Record<string, unknown> = { ...(params.options ?? {}) };
    assignDefined(options, "atomEnabled", params.atomEnabled);
    assignDefined(options, "collectionPointer", params.collectionPointer);
    assignDefined(options, "collectionLock", params.collectionLock);
    assignDefined(options, "skipSend", params.skipSend);
    assignDefined(options, "signer", params.signer);
    assignDefined(options, "assetPubkey", params.assetPubkey);

    const registerAgent = identity.registerAgent as RegisterAgent;
    const result = await registerAgent.call(identity, params.uri, options);
    if (isFailedRegistration(result)) {
      throw new Error(`8004 identity creation failed: ${result.error}`);
    }
    const agentAsset = extractAgentAsset(result, params.assetPubkey);
    return { agentAsset, result };
  }

  async registerAgent(uri?: string, options?: RegisterIdentityOptions): Promise<CreateIdentityResult> {
    return uri === undefined ? this.register(options ?? {}) : this.register(uri, options);
  }

  async create(params: CreateIdentityParams): Promise<CreateIdentityResult> {
    return this.register(params);
  }
}

function normalizeRegisterParams(
  paramsOrUri: string | CreateIdentityParams | undefined,
  options: RegisterIdentityOptions,
): CreateIdentityParams {
  if (typeof paramsOrUri === "string") {
    return { ...options, uri: paramsOrUri };
  }
  if (paramsOrUri === undefined) {
    return { ...options };
  }
  return paramsOrUri;
}

function assignDefined(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined) {
    target[key] = value;
  }
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
  throw new Error("8004 identity creation did not return an agent asset pubkey");
}

function isFailedRegistration(result: unknown): result is { success: false; error: unknown } {
  return Boolean(result && typeof result === "object" && (result as { success?: unknown }).success === false);
}
