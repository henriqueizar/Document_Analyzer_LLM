import { lookup } from 'dns/promises';
import { isIP } from 'net';

/**
 * Where the services that receive the documents' content are: the LLM (which
 * reads excerpts, questions and answers) and the database (which stores
 * everything). Checked when the backend starts, so a configuration that would
 * send content off the machine cannot go unnoticed.
 *
 *   local    this machine or a container of this installation
 *   private  another machine on the private network (company server)
 *   public   the internet, or a "cloud" model that Ollama forwards to its servers
 */
export type Location = 'local' | 'private' | 'public';

export interface Destination {
  host: string;
  location: Location;
}

const LOCAL_NAMES = new Set(['localhost', 'host.docker.internal']);
const PRIVATE_SUFFIXES = ['.local', '.lan', '.internal', '.home.arpa'];

/** Ollama's "cloud" models (e.g. gpt-oss:120b-cloud) run on ollama.com, not here. */
export function isCloudModel(model: string): boolean {
  return /(^|[-:])cloud$/i.test(model.trim());
}

export function classifyAddress(ip: string): Location {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 127) return 'local';
    if (
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    )
      return 'private';
    if (a === 100 && b >= 64 && b <= 127) return 'private'; // carrier-grade NAT, VPNs
    if (a === 169 && b === 254) return 'private'; // link-local
    return 'public';
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    if (x === '::1') return 'local';
    if (x.startsWith('::ffff:')) return classifyAddress(x.slice(7));
    if (/^f[cd]/.test(x) || /^fe[89ab]/.test(x)) return 'private'; // unique local, link-local
    return 'public';
  }
  return 'public';
}

/**
 * Classifies a host name or address. Single-label names (db, ollama, proxy)
 * are this installation's containers. Other names are resolved: the
 * destination is only private if every address is.
 */
export async function classifyHost(
  host: string,
  resolve: (name: string) => Promise<string[]> = async (name) =>
    (await lookup(name, { all: true })).map((a) => a.address),
): Promise<Location> {
  const name = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (LOCAL_NAMES.has(name)) return 'local';
  if (isIP(name)) return classifyAddress(name);
  if (!name.includes('.')) return 'local';
  if (PRIVATE_SUFFIXES.some((s) => name.endsWith(s))) return 'private';
  try {
    const locations = (await resolve(name)).map(classifyAddress);
    if (locations.length && locations.every((l) => l !== 'public')) {
      return locations.includes('private') ? 'private' : 'local';
    }
  } catch {
    // unresolvable: treated as public, the safe assumption
  }
  return 'public';
}

export interface Destinations {
  llm: Destination;
  database: Destination;
}

let checked: Destinations | null = null;

/** The result of the startup check (for the administrator's panel). */
export function currentDestinations(): Destinations | null {
  return checked;
}

/**
 * Refuses to start when content would go to the internet, unless allowed on
 * purpose (ALLOW_REMOTE_LLM=1, ALLOW_REMOTE_DATABASE=1). Another machine on
 * the private network is allowed, with a warning.
 */
export async function checkDestinations(
  env: NodeJS.ProcessEnv,
  warn: (message: string) => void,
  resolve?: (name: string) => Promise<string[]>,
): Promise<Destinations> {
  const llmUrl = new URL(
    (env.OLLAMA_URL || env.LLM_BASE_URL || 'http://localhost:11434').replace(
      /\/+$/,
      '',
    ),
  );
  const model = env.LLM_MODEL || 'qwen3:8b';
  let llmLocation = await classifyHost(llmUrl.hostname, resolve);
  if (isCloudModel(model)) llmLocation = 'public';
  const llm = {
    host: isCloudModel(model)
      ? `${llmUrl.host} (cloud model ${model}, run by ollama.com)`
      : llmUrl.host,
    location: llmLocation,
  };

  const dbUrl = env.DATABASE_URL ? new URL(env.DATABASE_URL) : null;
  const database = dbUrl
    ? {
        host: dbUrl.host,
        location: await classifyHost(dbUrl.hostname, resolve),
      }
    : { host: '(not configured)', location: 'local' as Location };

  const problems: string[] = [];
  if (llm.location === 'public' && env.ALLOW_REMOTE_LLM !== '1') {
    problems.push(
      `The LLM (${llm.host}) is outside this machine and the private network: document excerpts, questions and answers would be sent there. Set ALLOW_REMOTE_LLM=1 only if this is intended.`,
    );
  }
  if (database.location === 'public' && env.ALLOW_REMOTE_DATABASE !== '1') {
    problems.push(
      `The database (${database.host}) is outside this machine and the private network: all documents would be stored there. Set ALLOW_REMOTE_DATABASE=1 only if this is intended.`,
    );
  }
  if (problems.length)
    throw new Error(`Refusing to start.\n- ${problems.join('\n- ')}`);

  for (const [what, d] of [
    ['LLM', llm],
    ['database', database],
  ] as const) {
    if (d.location !== 'local') {
      warn(
        `The ${what} is NOT on this machine (${d.host}, ${d.location}): document content is sent there.`,
      );
    }
  }
  checked = { llm, database };
  return checked;
}
