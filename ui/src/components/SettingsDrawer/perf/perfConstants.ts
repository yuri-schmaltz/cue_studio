/* eslint-disable react-refresh/only-export-components -- module owns a
 * single constant + type alias used by both the Performance panel
 * (LLM Configuration provider switch) and the Integrations panel
 * (NSFW auto-disable rule). Centralising prevents the two call sites
 * from drifting. */

/** LLM providers whose terms of service forbid NSFW generation. The
 *  provider-switch auto-disable rule and the locked toggle UI both
 *  read from this set so the rule stays consistent across panels. */
export const PUBLIC_PROVIDERS = new Set(['openai', 'anthropic', 'minimax'])
