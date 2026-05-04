export interface FeatureFlags {
  lfg: boolean;
  marketplace: boolean;
  tickets: boolean;
  blocklist: boolean;
  timedRoles: boolean;
  adminUi: boolean;
}

export const ALL_FEATURES_ENABLED: FeatureFlags = {
  lfg: true,
  marketplace: true,
  tickets: true,
  blocklist: true,
  timedRoles: true,
  adminUi: true,
};

function isDisabled(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

export function parseFeatureFlags(env: {
  DISABLE_LFG?: string;
  DISABLE_MARKETPLACE?: string;
  DISABLE_TICKETS?: string;
  DISABLE_BLOCKLIST?: string;
  DISABLE_TIMED_ROLES?: string;
  DISABLE_ADMIN_UI?: string;
}): FeatureFlags {
  return {
    lfg: !isDisabled(env.DISABLE_LFG),
    marketplace: !isDisabled(env.DISABLE_MARKETPLACE),
    tickets: !isDisabled(env.DISABLE_TICKETS),
    blocklist: !isDisabled(env.DISABLE_BLOCKLIST),
    timedRoles: !isDisabled(env.DISABLE_TIMED_ROLES),
    adminUi: !isDisabled(env.DISABLE_ADMIN_UI),
  };
}
