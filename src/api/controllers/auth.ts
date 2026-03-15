import { setBotControlPlaneContext, hasBotControlPlaneAuthToken } from "../../interactor/shared/utils/user-data-dir";
import { apiGet } from "../api-client";

export type ApiAuthContext = {
  tokenId: string;
  tokenPrefix: string;
  actorType: "user" | "worker";
  label: string;
  role: string;
  permissions: string[];
  tenant: {
    id: string;
    slug: string;
    name: string;
  };
  workspace: {
    id: string;
    slug: string;
    name: string;
  };
  user: null | {
    id: string;
    email: string;
    fullName: string;
  };
  expiresAt: string | null;
};

let cachedContext: Promise<ApiAuthContext | null> | null = null;

export const fetchApiAuthContext = async (force = false) => {
  if (!hasBotControlPlaneAuthToken()) {
    return null;
  }

  if (!cachedContext || force) {
    cachedContext = apiGet<ApiAuthContext>("/auth/me")
      .then((context) => {
        setBotControlPlaneContext(context);
        return context;
      })
      .catch((error) => {
        cachedContext = null;
        throw error;
      });
  }

  return cachedContext;
};

export const hydrateControlPlaneContext = async () => {
  try {
    return await fetchApiAuthContext();
  } catch {
    return null;
  }
};
