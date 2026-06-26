export enum FeatureFlag {
  ENABLE_DISCOVERY = 'enable_discovery',
  ENABLE_EXTRACTION = 'enable_extraction',
  ENABLE_NORMALIZATION = 'enable_normalization',
  ENABLE_STORAGE = 'enable_storage',
  ENABLE_DEBUG_MODE = 'enable_debug_mode',
}

class FeatureFlagsRegistry {
  private flags: Map<FeatureFlag, boolean> = new Map();

  constructor() {
    // Default config for Sprint 2 vertical slice
    this.flags.set(FeatureFlag.ENABLE_DISCOVERY, true);
    this.flags.set(FeatureFlag.ENABLE_EXTRACTION, true);
    this.flags.set(FeatureFlag.ENABLE_NORMALIZATION, true);
    this.flags.set(FeatureFlag.ENABLE_STORAGE, true);
    this.flags.set(FeatureFlag.ENABLE_DEBUG_MODE, true);
  }

  public isEnabled(flag: FeatureFlag): boolean {
    return this.flags.get(flag) ?? false;
  }

  public enable(flag: FeatureFlag): void {
    this.flags.set(flag, true);
  }

  public disable(flag: FeatureFlag): void {
    this.flags.set(flag, false);
  }
}

export const featureFlags = new FeatureFlagsRegistry();
