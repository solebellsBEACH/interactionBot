import type { UserProfile } from "../../interactor/shared/interface/user/user-profile.types";
import { apiDelete, apiGet, apiPost } from "../api-client";

export async function fetchRemoteUserProfile(): Promise<UserProfile | null> {
  return apiGet<UserProfile | null>("/user-profile");
}

export async function saveRemoteUserProfile(
  payload: Partial<UserProfile>
): Promise<UserProfile | null> {
  return apiPost<UserProfile | null>("/user-profile", payload);
}

export async function clearRemoteUserProfile(): Promise<void> {
  await apiDelete("/user-profile");
}
