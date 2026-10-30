import { ChannelCredentials } from "@grpc/grpc-js";
import { GrpcTransport } from "@protobuf-ts/grpc-transport";
import { SuiGrpcClient } from "@mysten/sui/grpc";

export type Network = "mainnet" | "testnet";

export const TATUM_GRPC_HOST: Record<Network, string> = {
  mainnet: "sui-mainnet-grpc.gateway.tatum.io:443",
  testnet: "sui-testnet-grpc.gateway.tatum.io:443",
};

export const TATUM_GRAPHQL_URL: Record<Network, string | null> = {
  mainnet: "https://sui-mainnet.gateway.tatum.io/graphql",
  testnet: "https://sui-testnet.gateway.tatum.io/graphql",
};

export const GRPC_TIMEOUT_MS = 20_000;

export function tatumGrpcClient(network: Network, apiKey: string): SuiGrpcClient {
  const transport = new GrpcTransport({
    host: TATUM_GRPC_HOST[network],
    channelCredentials: ChannelCredentials.createSsl(),
    meta: { "x-api-key": apiKey },
    timeout: GRPC_TIMEOUT_MS,
  });
  return new SuiGrpcClient({ network, transport });
}
