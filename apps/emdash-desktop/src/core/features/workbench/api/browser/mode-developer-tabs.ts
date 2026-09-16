import type { TabViewContext } from '@core/primitives/workbench-shell/browser/tabs/core/tab-provider';
import type { AnyTabProvider } from '@core/primitives/workbench-shell/browser/tabs/core/tab-provider-registry';
import { developerSurfacesSnapshot } from './mode-developer-surfaces';

/**
 * Wraps a tab provider so it refuses to open while non-developer mode is on.
 *
 * The provider stays registered on purpose: a saved pane layout may still name
 * its kind, and the registry throws on an unknown kind. Only the open is
 * refused, which is what `onBeforeOpen` returning null means to the engine.
 */
function refuseWhileNonDeveloper(provider: AnyTabProvider): AnyTabProvider {
  const openTab = provider.onBeforeOpen?.bind(provider);
  return {
    ...provider,
    onBeforeOpen(args: unknown, ctx: TabViewContext): unknown {
      if (!developerSurfacesSnapshot().showSourceControl) return null;
      // The engine strips its routing flags before this call, so raw args are
      // the initial state when the provider has no onBeforeOpen of its own.
      return openTab ? openTab(args, ctx) : args;
    },
  };
}

/**
 * Same tuple, each provider gated. The cast keeps the literal provider types
 * the tab registry infers its kinds from; the wrapper changes behaviour, never
 * shape.
 */
export function developerOnlyTabProviders<const P extends readonly AnyTabProvider[]>(
  providers: P
): P {
  return providers.map(refuseWhileNonDeveloper) as unknown as P;
}
