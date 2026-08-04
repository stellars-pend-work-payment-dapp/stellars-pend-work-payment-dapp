import { SoroswapSDK, SupportedNetworks } from "@soroswap/sdk";
import type { Token } from "../../../types/soroswapTypes";
import { getCurrentNetwork, getAvailableTokens, getTokens } from "./tokens";

const SOROSWAP_API_URL = "https://api.soroswap.finance";
/** Internal Next.js proxy route — keeps the server-side API key off the client. */
const SOROSWAP_PROXY_URL = "/api/soroswap-proxy";
const DEFAULT_TIMEOUT = 50000;

export const getApiKey = (): string | null => {
  if (typeof window === "undefined") return null;
  const localKey = localStorage.getItem("soroswap_api_key");
  if (localKey && localKey.trim() !== "") {
    return localKey.trim();
  }
  return null;
};

export const setApiKey = (apiKey: string): void => {
  if (typeof window === "undefined") return;
  localStorage.setItem("soroswap_api_key", apiKey);
};

export const hasApiKey = (): boolean => {
  return getApiKey() !== null;
};

export const getSDKNetwork = (): SupportedNetworks => {
  const network = getCurrentNetwork();
  const networkLower = network.toLowerCase();

  if (networkLower === "mainnet" || networkLower === "public") {
    return SupportedNetworks.MAINNET;
  }
  return SupportedNetworks.TESTNET;
};

let sdkInstance: SoroswapSDK | null = null;
let sdkNetwork: SupportedNetworks | null = null;

export const invalidateSoroswapSDK = (): void => {
  sdkInstance = null;
  sdkNetwork = null;
};

export const getSoroswapSDK = (): SoroswapSDK => {
  const currentNetwork = getSDKNetwork();

  if (sdkInstance && sdkNetwork === currentNetwork) {
    return sdkInstance;
  }

  const apiKey = getApiKey();

  // When the user has their own key in localStorage, hit the SoroSwap API
  // directly. Otherwise route through the server-side proxy so the
  // organisation's shared key stays off the client bundle.
  const useProxy = !apiKey;

  sdkInstance = new SoroswapSDK({
    apiKey: apiKey ?? "proxy-dummy-key",
    baseUrl: useProxy ? SOROSWAP_PROXY_URL : SOROSWAP_API_URL,
    defaultNetwork: currentNetwork,
    timeout: DEFAULT_TIMEOUT,
  });

  sdkNetwork = currentNetwork;

  return sdkInstance;
};

export const makeAPIRequest = async <T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> => {
  const apiKey = getApiKey();

  // When the user has their own key, hit SoroSwap directly.
  // Otherwise route through the server-side proxy.
  if (!apiKey) {
    const proxyRes = await fetch(SOROSWAP_PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: endpoint,
        method: options.method ?? "GET",
        body: options.body ? JSON.parse(options.body as string) : undefined,
      }),
    });

    if (!proxyRes.ok) {
      const errorData = await proxyRes.json().catch(() => ({}));
      throw new Error(
        `API request failed: ${proxyRes.status}. ${JSON.stringify(errorData)}`
      );
    }

    return (await proxyRes.json()) as T;
  }

  const url = `${SOROSWAP_API_URL}${endpoint}`;

  const headers: HeadersInit = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    ...options.headers,
  };

  try {
    const response = await fetch(url, { ...options, headers });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        `API request failed: ${response.status} ${response.statusText}. ${JSON.stringify(errorData)}`
      );
    }

    const jsonData = await response.json();
    return jsonData as T;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("Unknown error occurred during API request");
  }
};

export const isValidContractAddress = (address: string): boolean => {
  return address.startsWith("C") && address.length === 56;
};

export const getTokenExplorerUrl = (
  contractAddress: string,
  network: string = "testnet"
): string => {
  const networkParam = network === "mainnet" ? "" : `/${network}`;
  return `https://stellar.expert/explorer${networkParam}/contract/${contractAddress}`;
};

export const formatTokenForAPI = (token: Token | string): string => {
  if (typeof token === "string") {
    return token;
  }

  if (token.type === "native") {
    const tokens = getTokens();
    return tokens.XLM ?? getAvailableTokens().XLM?.contract ?? "";
  }

  if (token.contract) {
    if (!token.contract.startsWith("C")) {
      throw new Error(
        `Invalid contract address format: ${token.contract}. Contract addresses should start with 'C'.`
      );
    }
    return token.contract;
  }

  if (token.code && token.issuer) {
    throw new Error(
      "Classic assets (code+issuer) not supported. Use contract addresses instead."
    );
  }

  throw new Error(
    "Invalid token format: must be string address or Token with contract"
  );
};
