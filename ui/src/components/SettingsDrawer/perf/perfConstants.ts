 

/** LLM providers whose terms of service forbid NSFW generation. The
 *  provider-switch auto-disable rule and the locked toggle UI both
 *  read from this set so the rule stays consistent across panels. */
export const PUBLIC_PROVIDERS = new Set(['openai', 'anthropic', 'minimax'])
